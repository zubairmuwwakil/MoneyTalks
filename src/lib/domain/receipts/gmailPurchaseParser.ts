//parse through reciepts to extract needed info 

import "server-only";
import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";
import { getDomain } from "tldts";
import { z } from "zod";

export type PurchaseItem = { name?: string; quantity?: number; price?: number };
export type Purchase = {
  messageId: string;
  merchant: string;
  fromEmail?: string;
  subject?: string;
  purchasedAt?: Date;
  orderId?: string;
  totalCents?: number;
  currency?: string;
  items?: PurchaseItem[];
  rawSource: "jsonld" | "pdf" | "text";
  /** Decoded text body, so callers never re-parse raw MIME themselves. */
  textBody?: string;
};

const JsonLd = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

function base64UrlToBuffer(b64url: string): Buffer {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

function domainFromEmail(addr?: string) {
  if (!addr) return undefined;
  const m = addr.match(/@([^>\s]+)/);
  return m?.[1]?.toLowerCase();
}

function normalizeMerchant(fromEmail?: string, subject?: string) {
  const domain = domainFromEmail(fromEmail);
  if (!domain) return subject?.split(" ")[0]?.toLowerCase() ?? "unknown";

  // tldts is larger than psl, but this path only runs in Node routes where
  // client bundle size is irrelevant. It embeds a current PSL snapshot (no
  // runtime fetch) and is actively maintained. Private suffixes are enabled
  // because collapsing two tenants of a hosted domain is the same false-merge
  // class as collapsing two .co.uk merchants.
  return getDomain(domain, { allowPrivateDomains: true }) ?? domain;
}

function extractFromJsonLd(html: string): Partial<Purchase> | null {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]').toArray();

  for (const el of scripts) {
    const raw = $(el).text().trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const safe = JsonLd.safeParse(parsed);
    if (!safe.success) continue;

    const nodes = Array.isArray(safe.data) ? safe.data : [safe.data];

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const type = (node as Record<string, unknown>)["@type"];
      const typeStr = Array.isArray(type) ? type.join(",") : String(type ?? "");

      if (!/Order|Invoice|Receipt/i.test(typeStr)) continue;

      const orderId =
        (node as Record<string, unknown>).orderNumber ||
        (node as Record<string, unknown>).identifier ||
        (node as Record<string, unknown>).confirmationNumber;

      const totalPaymentDue = (node as Record<string, unknown>).totalPaymentDue as Record<string, unknown> | undefined;
      const paymentDue = (node as Record<string, unknown>).paymentDue as Record<string, unknown> | undefined;
      const priceCurrency =
        (node as Record<string, unknown>).priceCurrency ||
        totalPaymentDue?.priceCurrency ||
        paymentDue?.priceCurrency;

      const total =
        Number((node as Record<string, unknown>).totalPrice) ||
        Number((node as Record<string, unknown>).price) ||
        Number(totalPaymentDue?.price) ||
        Number(paymentDue?.price);

      const purchasedAtRaw = (node as Record<string, unknown>).orderDate || (node as Record<string, unknown>).dateIssued;
      const purchasedAt = purchasedAtRaw ? new Date(String(purchasedAtRaw)) : undefined;

      const items: PurchaseItem[] = [];
      const maybeItems =
        (node as Record<string, unknown>).acceptedOffer ||
        (node as Record<string, unknown>).offers ||
        (node as Record<string, unknown>).orderedItem;

      const arr = Array.isArray(maybeItems) ? maybeItems : maybeItems ? [maybeItems] : [];
      for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const itemOffered = (it as Record<string, unknown>).itemOffered as Record<string, unknown> | undefined;
        const priceSpec = (it as Record<string, unknown>).priceSpecification as Record<string, unknown> | undefined;
        const itemName =
          (it as Record<string, unknown>).name ||
          itemOffered?.name ||
          itemOffered?.description;
        const qty = Number((it as Record<string, unknown>).quantity) || undefined;
        const p =
          Number((it as Record<string, unknown>).price) ||
          Number(priceSpec?.price) ||
          undefined;
        items.push({ name: String(itemName || ""), quantity: qty, price: p });
      }

      const totalCents = Number.isFinite(total) ? Math.round(total * 100) : undefined;

      return {
        rawSource: "jsonld",
        orderId: orderId ? String(orderId) : undefined,
        totalCents,
        currency: priceCurrency ? String(priceCurrency) : undefined,
        purchasedAt: purchasedAt && !Number.isNaN(purchasedAt.getTime()) ? purchasedAt : undefined,
        items: items.length ? items : undefined,
      };
    }
  }

  return null;
}

/**
 * Convert HTML to text while preserving block boundaries.
 *
 * cheerio's .text() concatenates across elements, which turned a real receipt
 * into a single 2057-character line and made line-based extraction impossible.
 * Inserting breaks around block-level tags first keeps table cells — where
 * receipt labels and amounts live — on separate lines.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br[^>]*>/gi, "\n")
    .replace(/<\s*\/(p|div|tr|td|th|li|table|h[1-6])\s*>/gi, "$&\n")
    .replace(/<\s*(p|div|tr|td|th|li|h[1-6])[^>]*>/gi, "\n$&");

  const $ = cheerio.load(withBreaks);
  $("script, style, head").remove();

  return $.root()
    .text()
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

// Receipt wording that introduces an order/reference number.
const ORDER_NUMBER = /\b(?:order|receipt|invoice|confirmation)\b[^\n]{0,20}?(?:number|no\.?|#)\s*:?\s*([A-Za-z0-9][A-Za-z0-9-]{2,24})/i;

/** Pull an order/reference number out of receipt wording, if one is stated. */
export function extractOrderNumber(subject: string | null | undefined, body: string | null | undefined): string | undefined {
  for (const source of [subject ?? "", body ?? ""]) {
    const m = source.match(ORDER_NUMBER);
    // Require a digit: "Order confirmation" must not yield "confirmation".
    if (m && /[0-9]/.test(m[1])) return m[1];
  }
  return undefined;
}

// A currency code may sit before its own symbol ("CAD $42.99"), so allow it.
const MONEY = /(?:USD|CAD|EUR|GBP|Can\$|CA\$|\$)\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi;

// Lines that name the payable figure outright beat a bare "total".
const STRONG_TOTAL = /\b(grand\s+total|order\s+total|total\s+(paid|charged|due)|amount\s+(paid|charged|due)|total\s+amount)\b/i;
const WEAK_TOTAL = /\btotal\b/i;

// Money quoted in a non-payable framing: promotional savings, list prices,
// loyalty balances. "Total savings: $500" must never outbid "Order total: $42.99".
const NON_PAYABLE = /\b(saving|savings|saved|save|discount|rewards?|points|coupon|credit|value|retail|msrp|was|off)\b/i;

export function extractTotalFromText(text: string): { totalCents?: number; currency?: string } {
  const lines = text.split(/\r?\n/);

  let best: { totalCents?: number; currency?: string } = {};
  let bestScore = 0;

  const consider = (line: string, score: number) => {
    for (const m of line.matchAll(MONEY)) {
      const amt = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(amt)) continue;

      const curToken = (m[0].match(/USD|CAD|EUR|GBP|CA\$|Can\$/i)?.[0] ?? "").toUpperCase();
      // A bare "$" is ambiguous between CAD and USD; leave it unresolved
      // rather than asserting one.
      const currency = curToken === "CA$" || curToken === "CAN$" ? "CAD" : curToken || undefined;

      const cents = Math.round(amt * 100);
      if (score > bestScore || cents > (best.totalCents ?? 0)) {
        best = { totalCents: cents, currency };
        bestScore = score;
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const strong = STRONG_TOTAL.test(line);
    if (!strong && !WEAK_TOTAL.test(line)) continue;
    if (NON_PAYABLE.test(line)) continue;

    const score = strong ? 2 : 1;
    if (score < bestScore) continue;

    if (MONEY.test(line)) {
      MONEY.lastIndex = 0;
      consider(line, score);
      continue;
    }
    MONEY.lastIndex = 0;

    // HTML tables put the label in one cell and the amount in the next, so
    // the figure lands on a following line.
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j];
      if (!next.trim()) continue;
      if (NON_PAYABLE.test(next)) break;
      MONEY.lastIndex = 0;
      if (MONEY.test(next)) {
        MONEY.lastIndex = 0;
        consider(next, score);
        break;
      }
      MONEY.lastIndex = 0;
      // Another label before any amount: this one had no figure attached.
      if (STRONG_TOTAL.test(next) || WEAK_TOTAL.test(next)) break;
    }
  }

  return best;
}

async function extractFromPdfAttachments(attachments: { contentType?: string; filename?: string; content: Buffer }[]) {
  for (const a of attachments) {
    const isPdf = (a.contentType || "").includes("pdf") || (a.filename || "").toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;

    try {
      const mod = await import("pdf-parse").catch(() => null);
      const pdfParse = (mod as Record<string, unknown>)?.default ?? (mod as Record<string, unknown>)?.PDFParse ?? mod;
      if (typeof pdfParse !== "function") continue;

      const parsed = await pdfParse(a.content);
      const hit = extractTotalFromText((parsed as { text?: string })?.text ?? "");
      if (hit.totalCents) return { rawSource: "pdf" as const, ...hit };
    } catch (err) {
      console.error("pdf-parse failed, skipping attachment", err);
      continue;
    }
  }
  return null;
}

export async function parsePurchaseFromRawGmailMessage(params: {
  messageId: string;
  raw: string; // base64url
}) {
  const buf = base64UrlToBuffer(params.raw);
  const parsed = await simpleParser(buf);

  const from = parsed.from?.text;
  const subject = parsed.subject ?? undefined;
  const merchant = normalizeMerchant(from, subject);

  const html = typeof parsed.html === "string" ? parsed.html : undefined;
  // Some senders ship a degraded text/plain part that omits the amount
  // entirely (observed on real receipts), so search both representations
  // rather than trusting whichever one happens to exist.
  const text = [parsed.text ?? "", html ? htmlToText(html) : ""].filter(Boolean).join("\n");

  const base: Purchase = {
    messageId: params.messageId,
    merchant,
    fromEmail: from,
    subject,
    purchasedAt: parsed.date ?? undefined,
    rawSource: "text",
    textBody: text,
  };

  const jsonLdHit = html ? extractFromJsonLd(html) : null;
  if (jsonLdHit) return { ...base, ...jsonLdHit, rawSource: "jsonld" as const };

  const pdfHit = await extractFromPdfAttachments(
    (parsed.attachments ?? []).map((a: { contentType?: string; filename?: string; content: Buffer }) => ({
      contentType: a.contentType,
      filename: a.filename,
      content: a.content,
    }))
  );
  if (pdfHit) return { ...base, ...pdfHit };

  const txtHit = extractTotalFromText(text);
  const orderId = extractOrderNumber(subject, text);
  return { ...base, ...txtHit, orderId, rawSource: "text" as const };
}
