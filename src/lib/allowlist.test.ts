import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./allowlist";

describe("isAllowedEmail", () => {
  it("accepts an exact match", () => {
    expect(isAllowedEmail("a@b.com", "a@b.com")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isAllowedEmail(" A@B.COM ", "a@b.com")).toBe(true);
    expect(isAllowedEmail("a@b.com", " A@B.com , c@d.com ")).toBe(true);
  });

  it("supports multiple comma-separated emails", () => {
    expect(isAllowedEmail("c@d.com", "a@b.com,c@d.com")).toBe(true);
  });

  it("rejects emails not on the list", () => {
    expect(isAllowedEmail("evil@x.com", "a@b.com")).toBe(false);
  });

  it("rejects everything when the list is empty or unset", () => {
    expect(isAllowedEmail("a@b.com", "")).toBe(false);
    expect(isAllowedEmail("a@b.com", undefined)).toBe(false);
  });

  it("rejects null/undefined email", () => {
    expect(isAllowedEmail(null, "a@b.com")).toBe(false);
    expect(isAllowedEmail(undefined, "a@b.com")).toBe(false);
  });
});
