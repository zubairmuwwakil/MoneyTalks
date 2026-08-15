import { parseDollarsToMinor } from "./money";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  if (rows.length > 10_000) throw new RangeError("CSV exceeds 10,000 rows");
  return rows;
}

export interface ColumnMapping {
  dateCol: number;
  amountCol: number;
  descriptionCol: number;
  dateFormat: "YMD" | "MDY" | "DMY";
  negate: boolean;
  hasHeader: boolean;
}

function parseDate(raw: string, format: "YMD" | "MDY" | "DMY"): string | null {
  const parts = raw.trim().split(/[/\-.]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  const [a, b, c] = parts;
  const [y, m, d] =
    format === "YMD" ? [a, b, c] : format === "MDY" ? [c, a, b] : [c, b, a];
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type MappedRow =
  | { date: string; amountMinor: number; description: string }
  | { error: string; rowIndex: number };

export function mapRows(rows: string[][], mapping: ColumnMapping): MappedRow[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  return body.map((cells, rowIndex) => {
    const date = parseDate(cells[mapping.dateCol] ?? "", mapping.dateFormat);
    const amount = parseDollarsToMinor(cells[mapping.amountCol] ?? "");
    const description = (cells[mapping.descriptionCol] ?? "").trim();
    if (date === null || amount === null) {
      return { error: `row ${rowIndex}: bad ${date === null ? "date" : "amount"}`, rowIndex };
    }
    return { date, amountMinor: mapping.negate ? -amount : amount, description };
  });
}

export function dedupeHash(
  accountId: string,
  date: string,
  amountMinor: number,
  description: string,
): string {
  const input = `${accountId}|${date}|${amountMinor}|${description}`;
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    hash1 = ((hash1 << 5) + hash1 + ch) >>> 0;
    hash2 = ((hash2 << 5) + hash2 + ch) >>> 0;
  }
  return hash1.toString(16).padStart(8, "0") + hash2.toString(16).padStart(8, "0");
}
