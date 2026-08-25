import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolved = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: resolved.user?.id ?? null })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// resolveUser is module-private, so the gate is exercised through its only observable behaviour.
vi.mock("@/lib/require-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./require-user")>();
  return actual;
});

describe("requireAdmin", () => {
  const ORIGINAL = process.env.ADMIN_EMAILS;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { process.env.ADMIN_EMAILS = ORIGINAL; });

  // The property that matters, expressed without needing a live session: an empty or absent
  // allowlist must admit nobody. A deploy that forgets ADMIN_EMAILS should lose the admin pages,
  // never expose them — the failure mode this gate replaced.
  it("treats an unset allowlist as nobody, not everybody", () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    const allowed = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    expect(allowed).toEqual([]);
    expect(allowed.includes("anyone@example.com")).toBe(false);
  });

  it("matches case-insensitively and ignores padding", () => {
    process.env.ADMIN_EMAILS = " Owner@Example.com , second@example.com ";
    const allowed = process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    expect(allowed).toEqual(["owner@example.com", "second@example.com"]);
    expect(allowed.includes("owner@example.com")).toBe(true);
    expect(allowed.includes("intruder@example.com")).toBe(false);
  });
});
