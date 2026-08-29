import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthedGmail, listUserConnections } from "./gmailClient";
import { prisma } from "@/lib/prisma";
import { encryptConnectionSecrets, readConnectionSecret } from "@/lib/security/emailConnectionSecrets";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailConnection: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/security/emailConnectionSecrets", () => ({
  readConnectionSecret: vi.fn((_owner: string, _field: string, stored: string | null) =>
    stored ? `plain:${stored}` : null,
  ),
  encryptConnectionSecrets: vi.fn((_owner: string, secrets: Record<string, string>) => secrets),
}));

// A hand-rolled emitter rather than node:events: vi.mock factories are hoisted
// above every import, so nothing imported at the top is in scope here.
vi.mock("googleapis", () => {
  class FakeOAuth2 {
    credentials: Record<string, unknown> = {};
    listeners: Record<string, ((payload: unknown) => void)[]> = {};
    setCredentials(credentials: Record<string, unknown>) {
      this.credentials = credentials;
    }
    on(event: string, handler: (payload: unknown) => void) {
      (this.listeners[event] ??= []).push(handler);
      return this;
    }
    emit(event: string, payload: unknown) {
      for (const handler of this.listeners[event] ?? []) handler(payload);
      return true;
    }
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      gmail: vi.fn(() => ({ users: { messages: {} } })),
    },
  };
});

// Two mailboxes owned by one person. "conn-a" is the older row, so any code
// that still reaches for "the owner's connection" lands on it.
const connA = {
  id: "conn-a",
  userId: "user-1",
  provider: "GMAIL",
  emailAddress: "first@gmail.com",
  accessToken: "enc-a-access",
  refreshToken: "enc-a-refresh",
  expiry: new Date("2099-01-01T00:00:00.000Z"),
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  scanMode: "ALL",
  lastScanAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};
const connB = { ...connA, id: "conn-b", emailAddress: "second@gmail.com", accessToken: "enc-b-access", refreshToken: "enc-b-refresh", createdAt: new Date("2026-02-01T00:00:00.000Z") };

describe("getAuthedGmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.emailConnection.findUnique).mockImplementation((async ({ where }: { where: { id?: string } }) =>
      [connA, connB].find((c) => c.id === where.id) ?? null) as never);
  });

  it("authenticates the named connection, not the owner's first", async () => {
    const result = await getAuthedGmail("conn-b");

    expect(result?.conn.id).toBe("conn-b");
    expect(prisma.emailConnection.findUnique).toHaveBeenCalledWith({ where: { id: "conn-b" } });
  });

  it("persists refreshed tokens against the same connection", async () => {
    const result = await getAuthedGmail("conn-b");

    result!.oauth2.emit("tokens", { access_token: "fresh", expiry_date: Date.now() + 3600_000 });
    await result!.flushTokens();

    expect(prisma.emailConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conn-b" } }),
    );
  });

  it("derives secrets from the owner, never from the connection", async () => {
    // The encryption key is per-OWNER: a person's mailboxes share one. Keying
    // it on the connection id instead would encrypt under a key nothing can
    // reproduce, quietly making every stored token undecryptable.
    const result = await getAuthedGmail("conn-b");
    result!.oauth2.emit("tokens", { refresh_token: "rotated" });
    await result!.flushTokens();

    expect(readConnectionSecret).toHaveBeenCalledWith("user-1", "accessToken", "enc-b-access");
    expect(readConnectionSecret).toHaveBeenCalledWith("user-1", "refreshToken", "enc-b-refresh");
    expect(encryptConnectionSecrets).toHaveBeenCalledWith("user-1", expect.anything());
    expect(readConnectionSecret).not.toHaveBeenCalledWith("conn-b", expect.anything(), expect.anything());
  });

  it("returns null for a connection that does not exist", async () => {
    expect(await getAuthedGmail("conn-missing")).toBeNull();
  });
});

describe("listUserConnections", () => {
  it("returns the owner's mailboxes oldest first", async () => {
    vi.mocked(prisma.emailConnection.findMany).mockResolvedValue([connA, connB] as never);

    const connections = await listUserConnections("user-1");

    expect(prisma.emailConnection.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(connections.map((c) => c.id)).toEqual(["conn-a", "conn-b"]);
  });
});
