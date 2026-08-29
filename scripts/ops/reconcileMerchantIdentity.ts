/**
 * reconcileMerchantIdentity.ts
 *
 * Repairs merchant keys written by the retired two-label slice in
 * `normalizeMerchant` (`parts.slice(-2).join(".")`), which mapped every
 * `.co.uk` / `.com.au` / `.co.nz` sender onto the bare public suffix and
 * fused unrelated companies into one merchant.
 *
 * P0b fixed the function. It did not fix rows already written. That matters
 * because recurring-obligation detection reads up to 24 months of
 * `Purchase` history: the false merge is gone going forward and still
 * present in the data the detector will read, where it produces a confident
 * wrong obligation carrying the evidence of every merchant it swallowed.
 * See docs/superpowers/specs/2026-08-29-recurring-obligations-design.md §2.
 *
 * Resolution is REPLAYED through the same modules production uses
 * (`emailDomain` + `merchantPack`), never reimplemented — a reporter that
 * reimplemented the identity function could disagree with production, which
 * is the failure it exists to detect. It reads `EmailTransaction.fromEmail`,
 * which preserves the original sender, so no Gmail round-trip is needed.
 *
 * DRY RUN BY DEFAULT. Nothing is written without --apply.
 *
 *   npx tsx scripts/ops/reconcileMerchantIdentity.ts
 *   npx tsx scripts/ops/reconcileMerchantIdentity.ts --user <userId>
 *   npx tsx scripts/ops/reconcileMerchantIdentity.ts --apply
 *
 * Safety rails, all of which skip rather than overwrite:
 *   - a Purchase whose merchant no longer matches the EmailTransaction it came
 *     from has been changed by something else; left alone
 *   - a Purchase carrying a `details` PurchaseCorrection was edited by the
 *     owner; left alone
 *   - a MerchantAlias whose normalizedName differs from its rawString was
 *     curated at /settings/merchants; never deleted
 *   - a public-suffix alias still referenced by any row is reported, not
 *     deleted
 */

import { parseArgs } from "node:util";
import fs from "node:fs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  normalizeMerchantFromSender,
  isPublicSuffixKey,
} from "../../src/lib/domain/merchants/emailDomain";
import {
  findPackMerchantByBrandKey,
  findPackMerchantByEmail,
  foldMerchantText,
} from "../../src/lib/domain/merchants/merchantPack";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    user: { type: "string" },
  },
});

const apply = values.apply === true;

// tsx does not load .env.local, and Prisma 7 requires an explicit driver
// adapter — `new PrismaClient()` with no options throws. Construct it the way
// src/lib/prisma.ts does rather than a second way.
dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString })) });

/**
 * Read-only replay of `resolveEmailMerchant`. Same precedence — pack facts
 * outrank the alias table, which outranks the registrable domain — but it
 * never seeds an alias, so a dry run cannot mutate anything.
 */
function expectedMerchant(fromEmail: string, aliases: Map<string, string>): string {
  const parserKey = normalizeMerchantFromSender(fromEmail);
  const pack =
    findPackMerchantByEmail(fromEmail) ??
    findPackMerchantByBrandKey(foldMerchantText(parserKey));
  if (pack) return pack.displayName;
  return aliases.get(parserKey) ?? parserKey;
}

async function main() {
  const where = values.user ? { userId: values.user } : {};

  const aliasRows = await prisma.merchantAlias.findMany({
    select: { rawString: true, normalizedName: true },
  });
  const aliases = new Map(aliasRows.map((a) => [a.rawString, a.normalizedName]));

  const transactions = await prisma.emailTransaction.findMany({
    where: { ...where, fromEmail: { not: null } },
    select: { id: true, userId: true, merchant: true, fromEmail: true, purchaseId: true },
  });

  type Drift = { id: string; purchaseId: string | null; from: string; to: string; sender: string };
  const drift: Drift[] = [];
  for (const tx of transactions) {
    const expected = expectedMerchant(tx.fromEmail!, aliases);
    if (expected !== tx.merchant) {
      drift.push({
        id: tx.id,
        purchaseId: tx.purchaseId,
        from: tx.merchant,
        to: expected,
        sender: tx.fromEmail!,
      });
    }
  }

  // Corpus totals, so a zero result is unambiguous. "Scanned 0" on its own
  // cannot be told apart from "there is nothing here", and an operator
  // deciding whether to trust a clean report needs to know which it is.
  const [totalTransactions, totalPurchases, totalAliases] = await Promise.all([
    prisma.emailTransaction.count({ where }),
    prisma.purchase.count({ where: { ...where, source: "GMAIL" } }),
    prisma.merchantAlias.count(),
  ]);

  console.log(`\nCorpus: ${totalTransactions} email transaction(s), of which ` +
    `${transactions.length} carry a sender address; ${totalPurchases} Gmail-sourced ` +
    `purchase(s); ${totalAliases} merchant alias(es).`);
  console.log(`${drift.length} transaction(s) resolve differently under the current identity function.\n`);

  const grouped = new Map<string, Drift[]>();
  for (const d of drift) {
    const key = `${d.from}  ->  ${d.to}`;
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  for (const [key, rows] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const senders = [...new Set(rows.map((r) => r.sender))].slice(0, 3).join(", ");
    console.log(`  ${String(rows.length).padStart(5)}  ${key}`);
    console.log(`         e.g. ${senders}`);
  }

  // Public-suffix aliases: each is an aggregate of every sender beneath it,
  // and is the fingerprint of the retired slice.
  const poisoned = aliasRows.filter((a) => isPublicSuffixKey(a.rawString));
  if (poisoned.length > 0) {
    console.log(`\n${poisoned.length} alias row(s) keyed on a bare public suffix:`);
    for (const a of poisoned) {
      const curated = a.normalizedName !== a.rawString;
      const stillUsed = await prisma.emailTransaction.count({ where: { merchant: a.normalizedName } });
      console.log(
        `  ${a.rawString} -> ${a.normalizedName}` +
          `${curated ? "  [CURATED - never deleted]" : ""}` +
          `${stillUsed > 0 ? `  [${stillUsed} row(s) still reference it]` : ""}`,
      );
    }
  }

  if (!apply) {
    console.log(`\nDRY RUN. Nothing written. Re-run with --apply to repair.\n`);
    return;
  }

  let txUpdated = 0;
  let purchasesUpdated = 0;
  let purchasesSkipped = 0;

  for (const d of drift) {
    await prisma.$transaction(async (db) => {
      await db.emailTransaction.update({ where: { id: d.id }, data: { merchant: d.to } });
      txUpdated += 1;

      if (!d.purchaseId) return;
      const purchase = await db.purchase.findUnique({
        where: { id: d.purchaseId },
        select: { id: true, merchant: true },
      });
      // Diverged from the email it came from — something else owns this value.
      if (!purchase || purchase.merchant !== d.from) {
        purchasesSkipped += 1;
        return;
      }
      // Owner edited it. A repair script does not overwrite a person.
      const corrected = await db.purchaseCorrection.count({
        where: { purchaseId: purchase.id, kind: "details", undoneAt: null },
      });
      if (corrected > 0) {
        purchasesSkipped += 1;
        return;
      }
      await db.purchase.update({ where: { id: purchase.id }, data: { merchant: d.to } });
      purchasesUpdated += 1;
    });
  }

  const deletable = [];
  for (const a of poisoned) {
    if (a.normalizedName !== a.rawString) continue;
    const stillUsed = await prisma.emailTransaction.count({ where: { merchant: a.normalizedName } });
    if (stillUsed === 0) deletable.push(a.rawString);
  }
  if (deletable.length > 0) {
    await prisma.merchantAlias.deleteMany({ where: { rawString: { in: deletable } } });
  }

  console.log(
    `\nAPPLIED. ${txUpdated} email transaction(s), ${purchasesUpdated} purchase(s) updated, ` +
      `${purchasesSkipped} purchase(s) skipped by a safety rail, ` +
      `${deletable.length} stale alias row(s) removed.\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
