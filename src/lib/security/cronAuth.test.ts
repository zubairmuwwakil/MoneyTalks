import { describe, it, expect, vi } from "vitest";

import { isAuthorizedCronRequest } from "./cronAuth";

const SECRET = "s3cret-cron-value";

function reqWith(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

function withSecret<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
}

it("denies every request when CRON_SECRET is unset (fails closed)", () => {
  withSecret(undefined, () => {
    expect(isAuthorizedCronRequest(reqWith({}))).toBe(false);
    expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "anything" }))).toBe(false);
  });
});

it("denies when CRON_SECRET is set to an empty or blank value", () => {
  withSecret("   ", () => {
    expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "   " }))).toBe(false);
  });
});

it("accepts the x-cron-secret header used by external schedulers", () => {
  withSecret(SECRET, () => {
    expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": SECRET }))).toBe(true);
  });
});

it("accepts the Authorization bearer header sent by Vercel Cron", () => {
  withSecret(SECRET, () => {
    expect(isAuthorizedCronRequest(reqWith({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });
});

it("denies a wrong secret, a missing header, and a near-miss", () => {
  withSecret(SECRET, () => {
    expect(isAuthorizedCronRequest(reqWith({}))).toBe(false);
    expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "wrong" }))).toBe(false);
    expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": SECRET + "x" }))).toBe(false);
    expect(isAuthorizedCronRequest(reqWith({ authorization: SECRET }))).toBe(false);
  });
});
