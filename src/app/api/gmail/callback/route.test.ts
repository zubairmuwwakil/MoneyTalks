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

function upsertArgs() {
  return vi.mocked(prisma.emailConnection.upsert).mock.calls[0][0] as unknown as {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
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
    vi.mocked(prisma.emailConnection.upsert).mockResolvedValue({} as never);
  });

  it("keys the connection on owner, provider and address so a second address adds a row", async () => {
    grant.email = "second@gmail.com";

    await callback();

    // Keyed on userId alone, a second address would OVERWRITE the first and
    // the owner would silently be left with one mailbox.
    expect(upsertArgs().where).toEqual({
      userId_provider_emailAddress: {
        userId: "user-1",
        provider: "GMAIL",
        emailAddress: "second@gmail.com",
      },
    });
    expect(upsertArgs().create).toMatchObject({ emailAddress: "second@gmail.com" });
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
    delete grant.tokens.refresh_token;

    await callback();

    expect(upsertArgs().update.refreshToken).toBeUndefined();
    expect(upsertArgs().create.refreshToken).toBeNull();
  });

  it("encrypts the tokens under the owner, not the address", async () => {
    await callback();

    expect(encryptConnectionSecrets).toHaveBeenCalledWith("user-1", expect.anything());
  });
});
