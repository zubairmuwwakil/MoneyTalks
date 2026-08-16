import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The catalogue/benefits/fixtures files under contracts/ are a vendored copy
 * of PickMe's canonical contract (spec: docs/plans/2026-08-16-card-contract-spec.md
 * §2). This test is the CI guardrail that a silent divergence isn't possible:
 * it fails as soon as the vendored bytes stop matching the manifest recorded
 * at the last sync, whether the vendored file changed or PickMe's did.
 */

const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts");
const MANIFEST_PATH = path.join(CONTRACTS_DIR, "MANIFEST.json");

// Keep in sync with the FILES list in scripts/sync-contracts.sh.
const EXPECTED_FILES = [
  "card-catalogue.json",
  "benefits-catalogue.json",
  "engine-fixtures.json",
  "schema/card-catalogue.schema.json",
  "schema/engine-fixtures.schema.json",
];

const DRIFT_MESSAGE = "contracts drifted — run scripts/sync-contracts.sh /path/to/PickMe/contracts";

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("vendored contracts", () => {
  const manifest: Record<string, string> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  it("MANIFEST.json covers exactly the expected vendored files", () => {
    expect(Object.keys(manifest).sort(), DRIFT_MESSAGE).toEqual([...EXPECTED_FILES].sort());
  });

  it.each(EXPECTED_FILES)("%s matches its recorded sha256", (file) => {
    const recorded = manifest[file];
    expect(recorded, DRIFT_MESSAGE).toBeDefined();
    expect(sha256(path.join(CONTRACTS_DIR, file)), DRIFT_MESSAGE).toBe(recorded);
  });
});
