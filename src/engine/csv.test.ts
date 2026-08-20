import { describe, expect, it } from "vitest";
import { dedupeHash, detectColumnMapping, mapRows, parseCsv, type ColumnMapping } from "./csv";

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

  it("enforces 10,000-row limit with trailing newline", () => {
    const lines = Array.from({ length: 10_001 }, (_, i) => `row${i}`);
    const csv = lines.join("\n") + "\n";
    expect(() => parseCsv(csv)).toThrow(RangeError);
  });

  it("enforces 10,000-row limit without trailing newline", () => {
    const lines = Array.from({ length: 10_001 }, (_, i) => `row${i}`);
    const csv = lines.join("\n");
    expect(() => parseCsv(csv)).toThrow(RangeError);
  });

  it("allows exactly 10,000 rows", () => {
    const lines = Array.from({ length: 10_000 }, (_, i) => `row${i}`);
    const csv = lines.join("\n");
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(10_000);
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

  it("produces a 16-character hex output", () => {
    const hash = dedupeHash("acct1", "2026-01-05", 123456, "FIXTURE GROCER");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toHaveLength(16);
  });
});

describe("detectColumnMapping", () => {
  it("auto-detects Amex & Scotia header layouts with YMD dates", () => {
    const rows = [
      ["Transaction Date", "Description", "Amount"],
      ["2026-08-15", "STARBUCKS", "5.25"],
    ];
    const res = detectColumnMapping(rows);
    expect(res).toEqual({
      dateCol: 0,
      descriptionCol: 1,
      amountCol: 2,
      dateFormat: "YMD",
      negate: false,
      hasHeader: true,
    });
  });

  it("auto-detects TD & RBC header layouts with MDY dates", () => {
    const rows = [
      ["Date", "Description", "CAD$"],
      ["08/15/2026", "TIM HORTONS", "3.10"],
    ];
    const res = detectColumnMapping(rows);
    expect(res).toEqual({
      dateCol: 0,
      descriptionCol: 1,
      amountCol: 2,
      dateFormat: "MDY",
      negate: false,
      hasHeader: true,
    });
  });

  it("returns null when required headers are missing", () => {
    const rows = [["Foo", "Bar"]];
    expect(detectColumnMapping(rows)).toBeNull();
  });
});

