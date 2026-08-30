import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { getSessionUserId } from "@/lib/require-user";
import { listUserConnections } from "@/lib/services/gmailClient";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/services/gmailClient", () => ({ listUserConnections: vi.fn() }));

const baseConnection = {
  id: "conn-a",
  userId: "user-1",
  provider: "GMAIL",
  emailAddress: "first@gmail.com",
  accessToken: "encrypted-access",
  refreshToken: "encrypted-refresh",
  expiry: new Date("2099-01-01T00:00:00.000Z"),
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  scanMode: "ALL",
  lastScanAt: null,
  lastScanError: null,
  backfillCursor: null,
  backfillCompletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("GET /api/gmail/status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(listUserConnections).mockResolvedValue([
      baseConnection,
      {
        ...baseConnection,
        id: "conn-b",
        emailAddress: "second@gmail.com",
        scope: "openid email",
      },
    ] as never);
  });

  it("reports every connection separately", async () => {
    const response = await GET();
    const body = await response.json();

    expect(listUserConnections).toHaveBeenCalledWith("user-1");
    expect(body.connections).toHaveLength(2);
    expect(body.connections[0]).toMatchObject({
      id: "conn-a",
      emailAddress: "first@gmail.com",
      connected: true,
      needsReauth: false,
    });
  });

  it("marks only the connection missing Gmail scope as needing reauth", async () => {
    const body = await (await GET()).json();

    expect(body.connections.find((connection: { id: string }) => connection.id === "conn-a").needsReauth)
      .toBe(false);
    expect(body.connections.find((connection: { id: string }) => connection.id === "conn-b")).toMatchObject({
      connected: false,
      needsReauth: true,
      gmailScopeGranted: false,
    });
  });

  it("requires reauth for a legacy backfill address", async () => {
    vi.mocked(listUserConnections).mockResolvedValue([
      { ...baseConnection, emailAddress: "legacy-conn@invalid" },
    ] as never);

    const body = await (await GET()).json();
    expect(body.connections[0]).toMatchObject({ connected: true, needsReauth: true });
  });
});
