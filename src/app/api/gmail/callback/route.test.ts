import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { encryptConnectionSecrets } from "@/lib/security/emailConnectionSecrets";

// vi.mock factories are hoisted above every import, so anything they read has
// to be hoisted with them rather than declared as an ordinary const below.
const grant = vi.hoisted(() => ({
  email: "first@gmail.com" as string | null,
  tokens: {} as Record<string, unknown>,
}));

type StoredConnection = Record<string, unknown> & {
  emailAddress: string;
  provider: string;
  userId: string;
};

type UpsertArgs = {
  where: {
    userId_provider_emailAddress: Pick<StoredConnection, "emailAddress" | "provider" | "userId">;
  };
  create: StoredConnection;
  update: Record<string, unknown>;
};

const storedConnections: StoredConnection[] = [];

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { emailConnection: { upsert: vi.fn() } } }));
vi.mock("@/lib/security/emailConnectionSecrets", () => ({
  encryptConnectionSecrets: vi.fn((_owner: string, secrets: Record<string, unknown>) => secrets),
}));
vi.mock("@/lib/security/oauthState", () => ({
  OAUTH_STATE_COOKIE: "gmail_oauth_state",
  isValidOAuthState: vi.fn(() => true),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "state-1" }), delete: vi.fn() })),
}));
vi.mock("@/lib/services/gmailClient", () => ({
  oauthClient: () => ({
    getToken: async () => ({ tokens: grant.tokens }),
    setCredentials: vi.fn(),
  }),
}));
vi.mock("googleapis", () => ({
  google: {
    oauth2: () => ({ userinfo: { get: async () => ({ data: { email: grant.email } }) } }),
  },
}));

function callback() {
  return GET(new Request("http://localhost/api/gmail/callback?code=abc&state=state-1") as never);
}

async function connectAs(email: string, tokens: Record<string, unknown> = grant.tokens) {
  grant.email = email;
  grant.tokens = tokens;
  return callback();
}

describe("GET /api/gmail/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant.email = "first@gmail.com";
    grant.tokens = {
      access_token: "at",
      refresh_token: "rt",
      expiry_date: 1893456000000,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    };
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    storedConnections.length = 0;
    vi.mocked(prisma.emailConnection.upsert).mockImplementation((async ({ where, create, update }: UpsertArgs) => {
      const key = where.userId_provider_emailAddress;
      const existing = storedConnections.find(
        (connection) =>
          connection.userId === key.userId &&
          connection.provider === key.provider &&
          connection.emailAddress === key.emailAddress,
      );

      if (!existing) {
        const connection = { id: `conn-${storedConnections.length + 1}`, ...create } as StoredConnection;
        storedConnections.push(connection);
        return connection;
      }

      // Prisma omits undefined fields from an update. This is the behavior that
      // keeps a first-consent refresh token when Google omits it on reconnect.
      for (const [field, value] of Object.entries(update)) {
        if (value !== undefined) existing[field] = value;
      }
      return existing;
    }) as never);
  });

  it("adds a second connection for a different address", async () => {
    await connectAs("first@gmail.com");
    await connectAs("second@gmail.com");

    // Keyed on userId alone, a second address would OVERWRITE the first and
    // the owner would silently be left with one mailbox.
    expect(storedConnections).toHaveLength(2);
    expect(storedConnections.map(({ emailAddress }) => emailAddress)).toEqual([
      "first@gmail.com",
      "second@gmail.com",
    ]);
    expect(vi.mocked(prisma.emailConnection.upsert).mock.calls[1][0].where).toEqual({
      userId_provider_emailAddress: {
        userId: "user-1",
        provider: "GMAIL",
        emailAddress: "second@gmail.com",
      },
    });
  });

  it("updates in place when the same address reconnects", async () => {
    await connectAs("first@gmail.com");
    await connectAs("first@gmail.com", {
      access_token: "updated-at",
      refresh_token: "updated-rt",
      expiry_date: 1924992000000,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });

    expect(storedConnections).toHaveLength(1);
    expect(storedConnections[0]).toMatchObject({
      emailAddress: "first@gmail.com",
      accessToken: "updated-at",
      refreshToken: "updated-rt",
    });
  });

  it("refuses a grant that returned no address", async () => {
    // Without an address the connection cannot be told apart from another, and
    // Postgres treats NULLs as distinct, so storing it would defeat the unique
    // constraint rather than be caught by it.
    grant.email = null;

    const response = await callback();

    expect(response.status).toBe(400);
    expect(prisma.emailConnection.upsert).not.toHaveBeenCalled();
  });

  it("does not erase a stored refresh token when Google omits one", async () => {
    // A refresh token arrives on FIRST consent only. Writing null on a repeat
    // consent would disconnect the mailbox at the next token expiry.
    await connectAs("first@gmail.com");
    await connectAs("first@gmail.com", {
      access_token: "updated-at",
      expiry_date: 1924992000000,
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    });

    expect(storedConnections).toHaveLength(1);
    expect(storedConnections[0]).toMatchObject({
      accessToken: "updated-at",
      refreshToken: "rt",
    });
    expect(vi.mocked(prisma.emailConnection.upsert).mock.calls[1][0].update.refreshToken).toBeUndefined();
  });

  it("encrypts the tokens under the owner, not the address", async () => {
    await callback();

    expect(encryptConnectionSecrets).toHaveBeenCalledWith("user-1", expect.anything());
  });
});
