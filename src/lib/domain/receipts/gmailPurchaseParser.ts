//parse through reciepts to extract needed info 

import "server-only";
import { simpleParser } from "mailparser";
import * as cheerio from "cheerio";
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

  if (domain.includes("amazon.")) return "Amazon";
  if (domain.includes("netflix.")) return "Netflix";
  if (domain.includes("spotify.")) return "Spotify";
  if (domain.includes("nike.")) return "Nike";

  const parts = domain.split(".");
  const root = parts.length >= 2 ? parts.slice(-2).join(".") : domain;
  return root;
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

function extractTotalFromText(text: string): { totalCents?: number; currency?: string } {
  const money = /(?:USD|CAD|EUR|GBP|\$|CA\$)\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi;
  const totalLine = /(grand\s+total|order\s+total|total)\b[^\n]{0,120}/i;

  const lines = text.split(/\r?\n/);
  let best: { totalCents?: number; currency?: string } = {};

  for (const line of lines) {
    if (!totalLine.test(line)) continue;
    const matches = [...line.matchAll(money)];

    for (const m of matches) {
      const rawAmt = m[1].replace(/,/g, "");
      const amt = Number(rawAmt);
      if (!Number.isFinite(amt)) continue;

      const curToken = (m[0].match(/USD|CAD|EUR|GBP|CA\$/i)?.[0] ?? "").toUpperCase();
      const currency =
        curToken === "CA$" ? "CAD" :
        curToken === "USD" ? "USD" :
        curToken === "CAD" ? "CAD" :
        curToken || undefined;

      const cents = Math.round(amt * 100);
      if (!best.totalCents || cents > best.totalCents) best = { totalCents: cents, currency };
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
  const text = parsed.text ?? "";

  const base: Purchase = {
    messageId: params.messageId,
    merchant,
    fromEmail: from,
    subject,
    purchasedAt: parsed.date ?? undefined,
    rawSource: "text",
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
  return { ...base, ...txtHit, rawSource: "text" as const };
}
