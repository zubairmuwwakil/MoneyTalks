/**
 * probeGmailScan.ts
 *
 * Answers "why did the scan find nothing?" without writing anything.
 *
 * A connected mailbox can yield zero EmailTransaction rows for three quite
 * different reasons, and they need different fixes: the grant is broken, the
 * receipt query matches nothing, or the query is narrower than the mail.
 * This distinguishes them by running the REAL `buildReceiptQuery` alongside
 * progressively broader ones and comparing the counts.
 *
 * READ-ONLY. It lists message ids and fetches headers only (`format:
 * "metadata"`), never bodies, and never touches the database beyond reading
 * the connection.
 *
 *   npx tsx scripts/ops/probeGmailScan.ts --user <userId> [--days 365]
 */

import { parseArgs } from "node:util";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: { user: { type: "string" }, days: { type: "string", default: "365" } },
});

dotenv.config({ path: ".env.local", quiet: true });

async function main() {
  // Imports are dynamic because `@/lib/prisma` throws at module scope when
  // DATABASE_URL is unset, and static imports hoist above dotenv.config().
  const { getAuthedGmail } = await import("../../src/lib/services/gmailClient");
  const { buildReceiptQuery, hasGmailReadScope } = await import("../../src/lib/services/gmailScanSource");
  const { prisma } = await import("../../src/lib/prisma");

  const userId = values.user ?? (await prisma.emailConnection.findFirst())?.userId;
  if (!userId) {
    console.log("No email connection exists. Nothing to probe.");
    return;
  }

  const authed = await getAuthedGmail(userId);
  if (!authed) {
    console.log("FAIL: getAuthedGmail returned null — the grant is unusable (no tokens, or expired with no refresh token).");
    return;
  }
  if (!hasGmailReadScope(authed.conn.scope)) {
    console.log(`FAIL: the grant has no Gmail read scope. scope=${authed.conn.scope}`);
    return;
  }
  console.log(`Connection ${authed.conn.emailAddress}, lastScanAt=${authed.conn.lastScanAt ?? "never"}`);

  const days = Number(values.days);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const after = `after:${Math.floor(since.getTime() / 1000)}`;

  // Widen one filter at a time, so the count that changes names the culprit.
  const queries: [string, string][] = [
    ["production query        ", buildReceiptQuery(since)],
    ["  + promotions allowed  ", `${after} -category:social (category:purchases OR subject:(receipt OR invoice OR statement))`],
    ["  subject terms only    ", `${after} subject:(receipt OR invoice OR statement OR "order confirmation")`],
    ["  purchases category    ", `${after} category:purchases`],
    ["  everything in window  ", after],
  ];

  console.log(`\nWindow: last ${days} days\n`);
  for (const [label, q] of queries) {
    const res = await authed.gmail.users.messages.list({ userId: "me", q, maxResults: 100 });
    const n = res.data.messages?.length ?? 0;
    const more = res.data.nextPageToken ? "+" : "";
    console.log(`  ${label} ${String(n).padStart(4)}${more}`);
  }

  // Show what the production query actually matched, headers only.
  const hits = await authed.gmail.users.messages.list({
    userId: "me",
    q: buildReceiptQuery(since),
    maxResults: 15,
  });
  const ids = (hits.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  if (ids.length > 0) {
    console.log(`\nSample of what the production query matches:`);
    for (const id of ids) {
      const msg = await authed.gmail.users.messages.get({
        userId: "me", id, format: "metadata",
      } as never) as { data: { payload?: { headers?: { name?: string; value?: string }[] } } };
      const headers = msg.data.payload?.headers ?? [];
      const pick = (n: string) => headers.find((h) => h.name?.toLowerCase() === n)?.value ?? "?";
      console.log(`  ${pick("from")}\n    ${pick("subject")}`);
    }
  }

  await authed.flushTokens();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
