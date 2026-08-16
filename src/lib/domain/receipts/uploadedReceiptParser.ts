//for uploading receipts pdf format?

import "server-only";

// pdf-parse pulls in pdfjs, which touches browser globals (DOMMatrix, Path2D) at
// module scope. Requiring it eagerly crashes `next build` while it collects page
// data, so it is loaded lazily at call time - the same approach gmailPurchaseParser
// already uses.
async function loadPdfParse(): Promise<((input: Buffer) => Promise<{ text?: string }>) | null> {
  const mod = await import("pdf-parse").catch(() => null);
  if (!mod) return null;
  const candidate =
    (mod as Record<string, unknown>).default ??
    (mod as Record<string, unknown>).PDFParse ??
    mod;
  return typeof candidate === "function"
    ? (candidate as (input: Buffer) => Promise<{ text?: string }>)
    : null;
}

function firstNonEmptyLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 3) ?? null;
}

function extractMoney(text: string): { amountCents?: number; currency?: string } {
  // tries to find "Total" lines and pick the largest amount on that line
  const totalLine = /(grand\s+total|order\s+total|total)\b[^\n]{0,120}/i;
  const money = /(?:USD|CAD|EUR|GBP|CA\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi;

  let bestCents: number | undefined;
  let bestCur: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    if (!totalLine.test(line)) continue;

    for (const m of line.matchAll(money)) {
      const rawAmt = m[1].replace(/,/g, "");
      const amt = Number(rawAmt);
      if (!Number.isFinite(amt)) continue;

      const token = (m[0].match(/USD|CAD|EUR|GBP|CA\$/i)?.[0] ?? "").toUpperCase();
      const cur =
        token === "CA$" ? "CAD" :
        token === "CAD" ? "CAD" :
        token === "USD" ? "USD" :
        token || undefined;

      const cents = Math.round(amt * 100);
      if (!bestCents || cents > bestCents) {
        bestCents = cents;
        bestCur = cur;
      }
    }
  }

  return { amountCents: bestCents, currency: bestCur };
}

function extractDate(text: string): string | null {
  // ISO-like: 2026-01-09 or 2026/01/09
  const iso = text.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, "0");
    const d = iso[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Month name: Jan 9, 2026
  const named = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s*(20\d{2})\b/i
  );
  if (named) {
    const dt = new Date(`${named[1]} ${named[2]}, ${named[3]}`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }

  return null;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function parseReceiptUpload(params: {
  buffer: Buffer;
  contentType: string;
  filename: string;
  defaultReturnDays: number;
}) {
  const { contentType, filename, defaultReturnDays } = params;

  // PDF path
  if (contentType.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
    const pdfParse = await loadPdfParse();
    if (!pdfParse) throw new Error("PDF parsing is unavailable");
    const pdf = await pdfParse(params.buffer);
    const text = pdf.text ?? "";

    const line1 = firstNonEmptyLine(text);
    const merchant = (line1?.slice(0, 60) ?? filename.replace(/\.[^.]+$/, "")).trim() || "Unknown";

    const dateISO = extractDate(text) ?? new Date().toISOString().slice(0, 10);
    const money = extractMoney(text);

    const purchaseDate = dateISO;
    const returnBy = addDaysISO(purchaseDate, defaultReturnDays);

    return {
      kind: "PDF" as const,
      merchant,
      purchaseDate,
      returnWindowDays: defaultReturnDays,
      returnBy,
      amountCents: money.amountCents,
      currency: (money.currency ?? "CAD") as string,
      extracted: {
        merchant,
        purchaseDate,
        returnBy,
        returnWindowDays: defaultReturnDays,
        amountCents: money.amountCents ?? null,
        currency: money.currency ?? "CAD",
      },
      confidence: "MEDIUM" as const,
      reasons: ["Receipt upload", "Parsed PDF text (v1 heuristics)"],
    };
  }

  // Image path (no OCR yet)
  const purchaseDate = new Date().toISOString().slice(0, 10);
  const returnBy = addDaysISO(purchaseDate, defaultReturnDays);

  return {
    kind: "IMAGE" as const,
    merchant: filename.replace(/\.[^.]+$/, "") || "Manual receipt",
    purchaseDate,
    returnWindowDays: defaultReturnDays,
    returnBy,
    amountCents: null as number | null,
    currency: "CAD",
    extracted: {
      note: "Image uploaded. OCR not enabled yet.",
      purchaseDate,
      returnBy,
      returnWindowDays: defaultReturnDays,
    },
    confidence: "LOW" as const,
    reasons: ["Receipt upload", "Image OCR not enabled yet — confirm manually"],
  };
}
