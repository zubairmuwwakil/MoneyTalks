import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
 * scripts/sync/sync-contracts.sh) and checked over the network by the separate
 * `contracts-freshness` CI job in .github/workflows/ci.yml. Splitting them is
 * deliberate — one check needs no network, the other cannot work without one
 * (see docs/superpowers/specs/2026-08-18-annual-fee-renewal-calendar-design.md
 * §12).
 */

const CONTRACTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../contracts");
const MANIFEST_PATH = path.join(CONTRACTS_DIR, "MANIFEST.json");

// Keep in sync with the FILES list in scripts/sync/sync-contracts.sh.
const EXPECTED_FILES = [
  "card-catalogue.json",
  "benefits-catalogue.json",
  "engine-fixtures.json",
  "owner-state.json",
  "programs.json",
  "candidate-catalogue.json",
  "RELEASE.json",
  // Not part of card-contracts@N: the merchant pack carries its own
  // packVersion and stays out of PickMe's release digest, because merchant
  // facts change on a different cadence from card rate facts. It is still
  // vendored and hashed here like everything else.
  "merchant-pack.json",
  "schema/card-catalogue.schema.json",
  "schema/benefits-catalogue.schema.json",
  "schema/engine-fixtures.schema.json",
  // Part of card-contracts@2.7 onward. programs.json had been vendored without its
  // schema since the beginning, so the "holds every file the release publishes"
  // suite below could not have checked it even in principle.
  "schema/programs.schema.json",
  // Part of card-contracts@2.8 onward.
  "owner-conditions.json",
  "schema/owner-conditions.schema.json",
  // Part of card-contracts@2.15 onward: canonical persisted purchase categories and aliases.
  "purchase-categories.json",
  "schema/purchase-categories.schema.json",
  "schema/merchant-pack.schema.json",
];

const DRIFT_MESSAGE = "contracts drifted — run scripts/sync/sync-contracts.sh /path/to/PickMe/contracts";

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

/**
 * The cross-repo half of the guard, added 2026-08-24.
 *
 * The suite above answers "has our copy been edited since the last sync?" by
 * comparing our bytes to our own manifest. It cannot answer "is the manifest
 * telling the truth about PickMe?", and that gap was not theoretical: a
 * manifest was found recording `_upstream.commit 670d1fe` alongside
 * `_upstream.files["card-catalogue.json"] = e2c6375a…`, bytes that appear in
 * NO PickMe commit. Both checks stayed green while the two repos disagreed
 * about 13 whole cards.
 *
 * `scripts/sync/sync-contracts.sh` now refuses to write such a manifest. This test
 * catches one already written — including the one in the tree today.
 *
 * It needs a sibling PickMe checkout, so it self-skips where there isn't one
 * (CI vendors contracts without cloning PickMe). A skip is honest: it means
 * "not checked here", and the networked `contracts-freshness` job is what
 * covers that case.
 */
describe("vendored contracts vs the PickMe checkout", () => {
  const PICKME_ROOT = path.resolve(CONTRACTS_DIR, "../../PickMe");
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const upstream = manifest._upstream as { commit?: string } | undefined;

  function pickMeIsAvailable(): boolean {
    try {
      execFileSync("git", ["-C", PICKME_ROOT, "rev-parse", "HEAD"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  const available = pickMeIsAvailable();

  it.runIf(available)("records a commit that PickMe actually contains", () => {
    expect(upstream?.commit, "MANIFEST.json is missing _upstream.commit").toBeTruthy();
    expect(
      () => execFileSync("git", ["-C", PICKME_ROOT, "cat-file", "-e", `${upstream!.commit}^{commit}`], { stdio: "pipe" }),
      `_upstream.commit ${upstream?.commit} is not a commit in PickMe`,
    ).not.toThrow();
  });

  it.each(EXPECTED_FILES)("%s matches PickMe at the recorded commit", (file) => {
    if (!available) return; // covered by the networked freshness job instead
    const commit = upstream?.commit;
    if (!commit || commit === "unknown" || commit.endsWith("-dirty")) {
      throw new Error(`_upstream.commit is "${commit}" — provenance cannot be verified. Re-sync from a clean PickMe checkout.`);
    }
    const committed = execFileSync("git", ["-C", PICKME_ROOT, "show", `${commit}:contracts/${file}`], {
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    const committedSha = createHash("sha256").update(committed).digest("hex");
    expect(
      sha256(path.join(CONTRACTS_DIR, file)),
      `contracts/${file} does not match PickMe at ${commit.slice(0, 10)}. ` +
        `PickMe owns these files (CLAUDE.md: "Swift stays canonical; contract changes land in Swift + fixtures first"). ` +
        `Land the change in PickMe, then re-run scripts/sync/sync-contracts.sh.`,
    ).toBe(committedSha);
  });
});

/**
 * The self-verifying half, added 2026-08-24.
 *
 * Everything above proves our copy is internally consistent, or matches a sibling PickMe
 * checkout. Neither answers the question a consumer actually has — "which published version of
 * the contract is this?" — without another repo present, and the `_upstream.commit` claim that
 * tried to answer it was found asserting a (commit, bytes) pairing that never existed.
 *
 * RELEASE.json is content-addressed: its digest is computed FROM the files it describes, so it
 * cannot claim bytes it does not have. Recomputing it here needs no sibling checkout, no network
 * and no git, which means it runs identically in CI, on a fresh clone, and in any other consumer
 * — iOS, Android, or one not yet written. That portability is the point: there are already four
 * copies of this catalogue across two repos.
 */
describe("vendored contracts are a known published release", () => {
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const release = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, "RELEASE.json"), "utf8")) as {
    release: string;
    catalogueVersion: string;
    digest: string;
    files: Record<string, string>;
  };

  // Must mirror scripts/release-catalogue.sh exactly: "name<TAB>sha256" lines, sorted by name
  // (byte order — the names are ASCII, so JS's default sort matches the shell's LC_ALL=C), each
  // terminated by a newline. Sorted so the digest does not depend on file order, and over names
  // as well as bytes so a rename changes the release.
  function recomputeDigest(files: string[]): string {
    const lines = files
      .map((file) => `${file}\t${sha256(path.join(CONTRACTS_DIR, file))}`)
      .sort();
    return `sha256:${createHash("sha256").update(lines.join("\n") + "\n").digest("hex")}`;
  }

  it("recomputes the release digest from the bytes we actually hold", () => {
    expect(recomputeDigest(Object.keys(release.files)), `contracts/ does not hash to ${release.release}`)
      .toBe(release.digest);
  });

  it("holds every file the release publishes", () => {
    for (const [file, expected] of Object.entries(release.files)) {
      expect(sha256(path.join(CONTRACTS_DIR, file)), `${file} differs from ${release.release}`).toBe(expected);
    }
  });

  // The release id must move whenever the bytes move, or one published id would describe two
  // different contracts. release-catalogue.sh --check enforces this upstream; this is the
  // consumer-side half of the same rule.
  it("names the catalogue version it actually vendored", () => {
    const catalogue = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, "card-catalogue.json"), "utf8"));
    expect(release.catalogueVersion).toBe(catalogue.catalogueVersion);
    expect(release.release).toBe(`card-contracts@${catalogue.catalogueVersion}`);
  });

  it("records in MANIFEST.json which release was vendored", () => {
    const upstream = manifest._upstream as { release?: string } | undefined;
    expect(upstream?.release, "sync-contracts.sh should record the release it pulled").toBe(release.release);
  });
});
