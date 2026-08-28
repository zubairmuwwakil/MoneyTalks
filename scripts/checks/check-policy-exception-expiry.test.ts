import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findExpiredExceptions, loadExceptionsFor } from "./check-policy-exception-expiry.mjs";

function registry(entries: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "exc-"));
  const file = join(dir, "exceptions.json");
  writeFileSync(file, JSON.stringify(entries, null, 2));
  return { dir, file };
}

const base = {
  id: "e1",
  check: "no-card-rate-model",
  path: "src/lib/cards/legacy.ts",
  why: "migration in flight",
  owner: "zub",
};

describe("findExpiredExceptions", () => {
  it("reports an exception whose reviewDate has passed", () => {
    const r = registry([{ ...base, reviewDate: "2026-01-01" }]);
    expect(findExpiredExceptions(r.file, new Date("2026-08-28")).map((entry) => entry.id)).toEqual(["e1"]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("does not report one whose reviewDate is in the future", () => {
    const r = registry([{ ...base, reviewDate: "2027-01-01" }]);
    expect(findExpiredExceptions(r.file, new Date("2026-08-28"))).toEqual([]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("treats the reviewDate itself as still valid", () => {
    const r = registry([{ ...base, reviewDate: "2026-08-28" }]);
    expect(findExpiredExceptions(r.file, new Date("2026-08-28"))).toEqual([]);
    rmSync(r.dir, { recursive: true, force: true });
  });

  it("rejects an entry missing a required field", () => {
    const noOwner = { ...base, reviewDate: "2027-01-01" };
    Reflect.deleteProperty(noOwner, "owner");
    const r = registry([noOwner]);
    expect(() => findExpiredExceptions(r.file, new Date("2026-08-28"))).toThrow(/owner/);
    rmSync(r.dir, { recursive: true, force: true });
  });
});

describe("loadExceptionsFor", () => {
  it("returns only the entries for the named check", () => {
    const r = registry([
      { ...base, reviewDate: "2027-01-01" },
      { ...base, id: "e2", check: "other-check", path: "src/x.ts", reviewDate: "2027-01-01" },
    ]);
    expect(loadExceptionsFor("no-card-rate-model", r.file)).toEqual([
      { path: "src/lib/cards/legacy.ts" },
    ]);
    rmSync(r.dir, { recursive: true, force: true });
  });
});
