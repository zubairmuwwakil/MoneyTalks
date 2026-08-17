import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapRows, parseCsv } from "@/engine/csv";
import { reconcileStatementLines } from "@/engine/statement-reconciliation";

const fixture = readFileSync(new URL("./fixtures/statement-reconciliation.csv", import.meta.url), "utf8");
const mapped = mapRows(parseCsv(fixture), {
  dateCol: 0, amountCol: 2, descriptionCol: 1, dateFormat: "YMD", negate: false, hasHeader: true,
}).filter((row): row is Extract<typeof row, { date: string }> => "date" in row);

describe("reconcileStatementLines", () => {
  it("matches an exact amount and uses merchant aliases for the tiebreaker", () => {
    const [line] = reconcileStatementLines([{ ...mapped[0], id: "statement-1" }], [{
      id: "purchase-1", date: "2026-08-10", amountMinor: 642, merchant: "Starbucks", source: "purchase",
    }], { "starbucks #1234": "Starbucks" });
    expect(line.status).toBe("matched");
    expect(line.matchedCandidateId).toBe("purchase-1");
  });

  it("matches a capture within the three-day date window", () => {
    const [line] = reconcileStatementLines([{ ...mapped[1], id: "statement-2" }], [{
      id: "wallet-1", date: "2026-08-17", amountMinor: 1899, merchant: "Netflix", source: "wallet",
    }]);
    expect(line.status).toBe("matched");
  });

  it("marks equally plausible captures ambiguous", () => {
    const [line] = reconcileStatementLines([{ ...mapped[2], id: "statement-3" }], [
      { id: "purchase-a", date: "2026-08-20", amountMinor: 450, merchant: "Coffee Shop", source: "purchase" },
      { id: "wallet-b", date: "2026-08-20", amountMinor: 450, merchant: "Coffee Shop", source: "wallet" },
    ]);
    expect(line.status).toBe("ambiguous");
  });

  it("excludes payment and credit rows from coverage", () => {
    const [line] = reconcileStatementLines([{ ...mapped[3], id: "statement-4" }], []);
    expect(line.status).toBe("excluded");
    const [credit] = reconcileStatementLines([{
      id: "statement-credit", date: "2026-08-22", amountMinor: 500, description: "CREDIT ADJUSTMENT",
    }], []);
    expect(credit.status).toBe("excluded");
  });
});
