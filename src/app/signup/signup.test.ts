import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: vi.fn(() => "SignUpComponent"),
  SignIn: vi.fn(() => "SignInComponent"),
}));

describe("SignUp pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects authenticated users to root from /signup", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    const SignUpPage = (await import("./[[...signup]]/page")).default;

    await expect(SignUpPage()).rejects.toThrow("REDIRECT:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("renders SignUp component for unauthenticated users on /signup", async () => {
    authMock.mockResolvedValue({ userId: null });
    const SignUpPage = (await import("./[[...signup]]/page")).default;

    const rendered = await SignUpPage();
    expect(rendered).toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated users to root from /sign-up alias", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    const SignUpAliasPage = (await import("../sign-up/[[...sign-up]]/page")).default;

    await expect(SignUpAliasPage()).rejects.toThrow("REDIRECT:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("renders SignUp component for unauthenticated users on /sign-up alias", async () => {
    authMock.mockResolvedValue({ userId: null });
    const SignUpAliasPage = (await import("../sign-up/[[...sign-up]]/page")).default;

    const rendered = await SignUpAliasPage();
    expect(rendered).toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
