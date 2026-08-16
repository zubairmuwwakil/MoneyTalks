import { describe, it, expect, vi } from "vitest";

import { generateOAuthState, isValidOAuthState } from "./oauthState";

it("rejects when the cookie value is missing", () => {
  expect(isValidOAuthState(null, "abc")).toBe(false);
  expect(isValidOAuthState(undefined, "abc")).toBe(false);
});

it("rejects when the query value is missing", () => {
  expect(isValidOAuthState("abc", null)).toBe(false);
  expect(isValidOAuthState("abc", undefined)).toBe(false);
});

it("rejects when both values are missing", () => {
  expect(isValidOAuthState(null, null)).toBe(false);
});

it("rejects when the values differ", () => {
  expect(isValidOAuthState("abc", "xyz")).toBe(false);
});

it("rejects a near-miss (prefix of the real value)", () => {
  expect(isValidOAuthState("abcdef", "abc")).toBe(false);
});

it("accepts when the cookie and query values match exactly", () => {
  expect(isValidOAuthState("matching-nonce", "matching-nonce")).toBe(true);
});

it("generateOAuthState returns URL-safe, non-repeating nonces", () => {
  const a = generateOAuthState();
  const b = generateOAuthState();

  expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(a.length >= 32).toBeTruthy();
  expect(a).not.toBe(b);
});
