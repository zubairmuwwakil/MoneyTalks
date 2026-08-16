import { it, expect } from "vitest";

import { isAuthorizedCronRequest } from "./cronAuth";

const SECRET = "s3cret-cron-value";

function reqWith(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

async function withSecret<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const saved = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
}

it("denies every request when CRON_SECRET is unset (fails closed)", async () => {
  await withSecret(undefined, async () => {
    await expect(isAuthorizedCronRequest(reqWith({}))).resolves.toBe(false);
    await expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "anything" }))).resolves.toBe(false);
  });
});

it("denies when CRON_SECRET is set to an empty or blank value", async () => {
  await withSecret("   ", async () => {
    await expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "   " }))).resolves.toBe(false);
  });
});

it("accepts the x-cron-secret header used by external schedulers", async () => {
  await withSecret(SECRET, async () => {
    await expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": SECRET }))).resolves.toBe(true);
  });
});

it("accepts the Authorization bearer header sent by Vercel Cron", async () => {
  await withSecret(SECRET, async () => {
    await expect(isAuthorizedCronRequest(reqWith({ authorization: `Bearer ${SECRET}` }))).resolves.toBe(true);
  });
});

it("denies a wrong secret, a missing header, and a near-miss", async () => {
  await withSecret(SECRET, async () => {
    await expect(isAuthorizedCronRequest(reqWith({}))).resolves.toBe(false);
    await expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": "wrong" }))).resolves.toBe(false);
    await expect(isAuthorizedCronRequest(reqWith({ "x-cron-secret": SECRET + "x" }))).resolves.toBe(false);
    await expect(isAuthorizedCronRequest(reqWith({ authorization: SECRET }))).resolves.toBe(false);
  });
});

it("denies a QStash signature when signing keys are not configured", async () => {
  await expect(isAuthorizedCronRequest(reqWith({ "upstash-signature": "not-a-real-signature" }))).resolves.toBe(false);
});
