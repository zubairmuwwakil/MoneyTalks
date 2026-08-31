import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findLegacySubscriptionWrites } from "./check-no-legacy-subscription-writes.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("legacy subscription write guard", () => {
  it("flags only live legacy writes", () => {
    const root = mkdtempSync(join(tmpdir(), "subscription-guard-"));
    roots.push(root);
    writeFileSync(join(root, "write.ts"), "await prisma.subscription.create({ data: {} });");
    writeFileSync(join(root, "read.ts"), "await prisma.subscription.findMany();");
    writeFileSync(join(root, "write.test.ts"), "prisma.subscription.create({});");
    expect(findLegacySubscriptionWrites(root)).toEqual([join(root, "write.ts")]);
  });
});
