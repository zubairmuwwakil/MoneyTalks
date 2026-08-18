import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The catalogue/benefits/fixtures files under contracts/ are a vendored copy
 * of PickMe's canonical contract (spec: docs/plans/2026-08-16-card-contract-spec.md
 * §2). This test is the *local-tampering* guardrail: it fails as soon as the
 * vendored bytes stop matching the manifest recorded at the last sync.
 *
 * It intentionally answers only "has our copy been edited since the last
 * sync?" — it cannot see PickMe, so it cannot tell whether PickMe's files
 * have since moved on. That second question ("is our copy current?") is
 * answered by the `_upstream` block this same MANIFEST.json now carries
 * (written from PickMe's *source* bytes at sync time, see
 * scripts/sync-contracts.sh) and checked over the network by the separate
 * `contracts-freshness` CI job in .github/workflows/ci.yml. Splitting them is
 * deliberate — one check needs no network, the other cannot work without one
 * (see docs/superpowers/specs/2026-08-18-annual-fee-renewal-calendar-design.md
 * §12).
 */

const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts");
const MANIFEST_PATH = path.join(CONTRACTS_DIR, "MANIFEST.json");

// Keep in sync with the FILES list in scripts/sync-contracts.sh.
const EXPECTED_FILES = [
  "card-catalogue.json",
  "benefits-catalogue.json",
  "engine-fixtures.json",
  "schema/card-catalogue.schema.json",
  "schema/benefits-catalogue.schema.json",
  "schema/engine-fixtures.schema.json",
];

const DRIFT_MESSAGE = "contracts drifted — run scripts/sync-contracts.sh /path/to/PickMe/contracts";

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("vendored contracts", () => {
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  it("MANIFEST.json covers exactly the expected vendored files", () => {
    // "_upstream" is metadata about the sync source, not a vendored file —
    // same "_"-prefixed-is-an-annotation convention cardCatalogue.ts's
    // annotatedObject() uses. Excluded here, not part of the file-list contract.
    const fileKeys = Object.keys(manifest).filter((key) => !key.startsWith("_"));
    expect(fileKeys.sort(), DRIFT_MESSAGE).toEqual([...EXPECTED_FILES].sort());
  });

  it.each(EXPECTED_FILES)("%s matches its recorded sha256", (file) => {
    const recorded = manifest[file];
    expect(recorded, DRIFT_MESSAGE).toBeDefined();
    expect(sha256(path.join(CONTRACTS_DIR, file)), DRIFT_MESSAGE).toBe(recorded);
  });
});
