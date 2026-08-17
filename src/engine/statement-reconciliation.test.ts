import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapRows, parseCsv } from "@/engine/csv";
import {
  coverageForLines,
  reconcileStatementLines,
  type CapturedPurchase,
  type StatementLine,
} from "@/engine/statement-reconciliation";

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

describe("reconcileStatementLines tip tolerance", () => {
  const dinner = (amountMinor: number): StatementLine => ({
    id: "statement-dinner", date: "2026-08-18", amountMinor, description: "THE KEG STEAKHOUSE",
  });
  const capture = (amountMinor: number, id = "wallet-keg"): CapturedPurchase => ({
    id, date: "2026-08-18", amountMinor, merchant: "The Keg Steakhouse", source: "wallet",
  });

  it("matches a tipped statement line to the amount observed at the till", () => {
    const [line] = reconcileStatementLines([dinner(5850)], [capture(5000)]);
    expect(line.status).toBe("matched-tolerant");
    expect(line.matchedCandidateId).toBe("wallet-keg");
    expect(line.toleranceMinor).toBe(850);
  });

  it("accepts a candidate exactly on the 25% floor and rejects the cent below it", () => {
    expect(reconcileStatementLines([dinner(5000)], [capture(3750)])[0].status).toBe("matched-tolerant");
    expect(reconcileStatementLines([dinner(5000)], [capture(3749)])[0].status).toBe("unmatched");
  });

  it("never matches a candidate above the line, because tips only add", () => {
    // A $40.00 line against a $50.00 capture: the statement settled BELOW what
    // was observed, which a tip cannot explain.
    const [line] = reconcileStatementLines([dinner(4000)], [capture(5000)]);
    expect(line.status).toBe("unmatched");
  });

  it("marks two in-tolerance candidates ambiguous rather than guessing", () => {
    const [line] = reconcileStatementLines([dinner(5850)], [capture(5000, "wallet-a"), capture(5200, "wallet-b")]);
    expect(line.status).toBe("ambiguous");
    expect(line.matchedCandidateId).toBeUndefined();
  });

  it("requires merchant evidence a tolerant amount cannot supply on its own", () => {
    const [line] = reconcileStatementLines([dinner(5850)], [{
      id: "wallet-grocery", date: "2026-08-18", amountMinor: 5000, merchant: "Loblaws", source: "wallet",
    }]);
    expect(line.status).toBe("unmatched");
  });

  it("gives a capture to the line it matches exactly, not to an earlier tipped line", () => {
    // Order-dependence regression: a single pass would let the $58.50 line
    // consume the only capture, stranding the line that matches it to the cent.
    const [tipped, exact] = reconcileStatementLines(
      [{ ...dinner(5850), id: "line-tipped" }, { ...dinner(5000), id: "line-exact" }],
      [capture(5000)],
    );
    expect(exact.status).toBe("matched");
    expect(exact.matchedCandidateId).toBe("wallet-keg");
    expect(tipped.status).toBe("unmatched");
  });

  it("reports tolerant matches beside coverage instead of inside it", () => {
    const coverage = coverageForLines(
      reconcileStatementLines([{ ...dinner(5850), id: "line-tipped" }, { ...dinner(5000), id: "line-exact" }], [
        capture(5000, "wallet-exact"),
        { id: "wallet-tipped", date: "2026-08-18", amountMinor: 5100, merchant: "The Keg Steakhouse", source: "wallet" },
      ]),
    );
    expect(coverage).toEqual({ matchedLines: 1, tolerantLines: 1, eligibleLines: 2, percentage: 50 });
  });
});
