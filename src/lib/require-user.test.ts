import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const getUserMock = vi.fn();
const revokeSessionMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  clerkClient: vi.fn(async () => ({
    users: { getUser: getUserMock },
    sessions: { revokeSession: revokeSessionMock },
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
      create: createMock,
    },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

process.env.ALLOWED_EMAILS = "owner@example.com";

function verifiedEmail(address: string) {
  return {
    id: "email_1",
    emailAddress: address,
    verification: { status: "verified" },
  };
}

describe("require-user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_EMAILS = "owner@example.com";
  });

  it("getSessionUserId returns null when signed out", async () => {
    authMock.mockResolvedValue({ userId: null, sessionId: null });
    const { getSessionUserId } = await import("./require-user");
    expect(await getSessionUserId()).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("revokes an existing account whose email was removed from the allowlist", async () => {
    authMock.mockResolvedValue({ userId: "clerk_1", sessionId: "sess_1" });
    findUniqueMock.mockResolvedValue({ id: "user_1", email: "removed-friend@example.com" });
    const { getSessionUserId } = await import("./require-user");
    expect(await getSessionUserId()).toBeNull();
    expect(revokeSessionMock).toHaveBeenCalledWith("sess_1");
  });

  it("keeps existing accounts working when no allowlist is configured", async () => {
    process.env.ALLOWED_EMAILS = "";
    authMock.mockResolvedValue({ userId: "clerk_1", sessionId: "sess_1" });
    findUniqueMock.mockResolvedValue({ id: "user_1", email: "anyone@example.com" });
    const { getSessionUserId } = await import("./require-user");
    expect(await getSessionUserId()).toBe("user_1");
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });

  it("resolves an existing clerkId match without calling the Clerk API", async () => {
    authMock.mockResolvedValue({ userId: "clerk_1", sessionId: "sess_1" });
    findUniqueMock.mockResolvedValue({ id: "user_1", email: "owner@example.com" });
    const { getSessionUserId } = await import("./require-user");

    expect(await getSessionUserId()).toBe("user_1");
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { clerkId: "clerk_1" },
      select: { id: true, email: true },
    });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("bootstraps by matching an existing User row on verified email", async () => {
    authMock.mockResolvedValue({ userId: "clerk_2", sessionId: "sess_2" });
    findUniqueMock
      .mockResolvedValueOnce(null) // no clerkId match
      .mockResolvedValueOnce({ id: "user_2", email: "owner@example.com" }); // email match
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: "email_1",
      emailAddresses: [verifiedEmail("owner@example.com")],
    });
    updateMock.mockResolvedValue({ id: "user_2", email: "owner@example.com" });
    const { getSessionUserId } = await import("./require-user");

    expect(await getSessionUserId()).toBe("user_2");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user_2" },
      data: { clerkId: "clerk_2" },
      select: { id: true, email: true },
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates a new User when no email match exists and the email is allowlisted", async () => {
    authMock.mockResolvedValue({ userId: "clerk_3", sessionId: "sess_3" });
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: "email_1",
      emailAddresses: [verifiedEmail("owner@example.com")],
    });
    createMock.mockResolvedValue({ id: "user_3", email: "owner@example.com" });
    const { getSessionUserId } = await import("./require-user");

    expect(await getSessionUserId()).toBe("user_3");
    expect(createMock).toHaveBeenCalledWith({
      data: { clerkId: "clerk_3", email: "owner@example.com" },
      select: { id: true, email: true },
    });
  });

  it("rejects and revokes the session when the verified email is not allowlisted", async () => {
    authMock.mockResolvedValue({ userId: "clerk_4", sessionId: "sess_4" });
    findUniqueMock.mockResolvedValueOnce(null);
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: "email_1",
      emailAddresses: [verifiedEmail("intruder@example.com")],
    });
    const { getSessionUserId } = await import("./require-user");

    expect(await getSessionUserId()).toBeNull();
    expect(revokeSessionMock).toHaveBeenCalledWith("sess_4");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats an unverified primary email as no email (rejected)", async () => {
    authMock.mockResolvedValue({ userId: "clerk_5", sessionId: "sess_5" });
    findUniqueMock.mockResolvedValueOnce(null);
    getUserMock.mockResolvedValue({
      primaryEmailAddressId: "email_1",
      emailAddresses: [{ id: "email_1", emailAddress: "owner@example.com", verification: { status: "unverified" } }],
    });
    const { getSessionUserId } = await import("./require-user");

    expect(await getSessionUserId()).toBeNull();
    expect(revokeSessionMock).toHaveBeenCalledWith("sess_5");
  });

  it("requireUserId redirects to /login when unresolved", async () => {
    authMock.mockResolvedValue({ userId: null, sessionId: null });
    const { requireUserId } = await import("./require-user");
    await expect(requireUserId()).rejects.toThrow("REDIRECT:/login");
  });

  it("requireUser returns the resolved email", async () => {
    authMock.mockResolvedValue({ userId: "clerk_1", sessionId: "sess_1" });
    findUniqueMock.mockResolvedValue({ id: "user_1", email: "owner@example.com" });
    const { requireUser } = await import("./require-user");
    expect(await requireUser()).toEqual({ email: "owner@example.com" });
  });
});
