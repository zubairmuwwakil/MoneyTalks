import { describe, expect, it } from "vitest";
import { dedupeHash, mapRows, parseCsv, type ColumnMapping } from "./csv";

describe("parseCsv", () => {
  it("parses quoted fields with embedded commas and escaped quotes", () => {
    const rows = parseCsv('date,desc,amt\r\n2026-01-05,"COFFEE, THE ""GOOD"" ONE",4.50\n');
    expect(rows).toEqual([
      ["date", "desc", "amt"],
      ["2026-01-05", 'COFFEE, THE "GOOD" ONE', "4.50"],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toHaveLength(2);
  });
});

describe("mapRows", () => {
  const mapping: ColumnMapping = {
    dateCol: 0, amountCol: 2, descriptionCol: 1, dateFormat: "MDY", negate: false, hasHeader: true,
  };

  it("maps columns, converts dollars to cents, and normalizes dates", () => {
    const out = mapRows(
      [
        ["Date", "Description", "Amount"],
        ["01/05/2026", "FIXTURE GROCER", "$1,234.56"],
        ["02/07/2026", "FIXTURE REFUND", "(45.00)"],
      ],
      mapping,
    );
    expect(out).toEqual([
      { date: "2026-01-05", amountMinor: 123_456, description: "FIXTURE GROCER" },
      { date: "2026-02-07", amountMinor: -4_500, description: "FIXTURE REFUND" },
    ]);
  });

  it("negates when the statement's sign convention is inverted", () => {
    const out = mapRows([["01/05/2026", "X", "10.00"]], { ...mapping, hasHeader: false, negate: true });
    expect(out).toEqual([{ date: "2026-01-05", amountMinor: -1_000, description: "X" }]);
  });

  it("reports unparseable rows as errors instead of throwing", () => {
    const out = mapRows([["not-a-date", "X", "abc"]], { ...mapping, hasHeader: false });
    expect(out[0]).toMatchObject({ rowIndex: 0 });
    expect("error" in out[0]).toBe(true);
  });
});

describe("dedupeHash", () => {
  it("is stable and input-sensitive", () => {
    const a = dedupeHash("acct1", "2026-01-05", 123456, "FIXTURE GROCER");
    expect(a).toBe(dedupeHash("acct1", "2026-01-05", 123456, "FIXTURE GROCER"));
    expect(a).not.toBe(dedupeHash("acct1", "2026-01-05", 123457, "FIXTURE GROCER"));
    expect(a).not.toBe(dedupeHash("acct2", "2026-01-05", 123456, "FIXTURE GROCER"));
  });
});
