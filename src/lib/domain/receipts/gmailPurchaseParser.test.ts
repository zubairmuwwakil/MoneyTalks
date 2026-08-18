import { it, expect } from "vitest";

import { extractOrderNumber, extractTotalFromText, htmlToText, parsePurchaseFromRawGmailMessage } from "./gmailPurchaseParser";

it("reads an explicit order total", () => {
  expect(extractTotalFromText("Order total: CAD $42.99")).toEqual({ totalCents: 4299, currency: "CAD" });
});

it("does not let a savings line outbid the real total", () => {
  // The old implementation kept the largest money value on any line
  // containing "total", so promotional framing won.
  const text = ["Total savings: $500.00", "You saved $120.00", "Order total: $42.99"].join("\n");
  expect(extractTotalFromText(text).totalCents).toBe(4299);
});

it("prefers a grand total over a subtotal", () => {
  const text = ["Subtotal $40.00", "Shipping $5.00", "Grand total $45.00"].join("\n");
  expect(extractTotalFromText(text).totalCents).toBe(4500);
});

it("never guesses a currency from a bare dollar sign", () => {
  // $ is ambiguous between CAD and USD — the wallet path refuses to guess
  // and so must this one.
  expect(extractTotalFromText("Order total: $42.99").currency).toBeUndefined();
});

it("finds nothing in marketing copy with no total", () => {
  expect(extractTotalFromText("Save up to $500 on everything! Shop now.")).toEqual({});
});

function rawMessage(subject: string, from: string, body: string) {
  const mime = [
    `From: Shop <${from}>`,
    "To: buyer@example.com",
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

it("exposes the decoded text body so callers stop scanning raw MIME", async () => {
  const parsed = await parsePurchaseFromRawGmailMessage({
    messageId: "m1",
    raw: rawMessage("Your order has shipped", "ship@store.com", "Tracking number 1Z999AA10123456784"),
  });

  expect(parsed.textBody).toContain("1Z999AA10123456784");
  expect(parsed.textBody).not.toContain("Content-Type");
});

it("keeps line structure when converting HTML, instead of one long blob", () => {
  // cheerio's .text() concatenates block elements, which produced a single
  // 2057-character line for a real receipt and defeated line-based extraction.
  const html = "<table><tr><td>Order total</td><td>$42.99</td></tr></table><p>Thanks!</p>";
  const text = htmlToText(html);

  expect(text.split("\n").length).toBeGreaterThan(1);
  expect(text).toMatch(/Order total/);
  expect(text).toMatch(/\$42\.99/);
});

it("reads a total when the label and amount sit on separate lines", () => {
  // How HTML receipt tables convert: label in one cell, amount in the next.
  const text = ["Order total", "$154.81", "Thanks for shopping"].join("\n");
  expect(extractTotalFromText(text).totalCents).toBe(15481);
});

it("still ignores a savings label split across lines", () => {
  const text = ["Total savings", "$500.00", "Order total", "$42.99"].join("\n");
  expect(extractTotalFromText(text).totalCents).toBe(4299);
});

it("extracts an order number from receipt wording", () => {
  expect(extractOrderNumber("Your receipt from GigSky #60501399", "")).toBe("60501399");
  expect(extractOrderNumber("Order #7932 confirmed", "")).toBe("7932");
  expect(extractOrderNumber("Confirmation", "Order number: A1B2-9931")).toBe("A1B2-9931");
});

it("does not invent an order number from prose", () => {
  expect(extractOrderNumber("Order confirmation", "Thank you for your order!")).toBeUndefined();
  expect(extractOrderNumber("Your order has shipped", "It is on the way.")).toBeUndefined();
});

it("finds the amount in the HTML part when the plain-text part omits it", async () => {
  // Verbatim shape of the GigSky receipts: a text/plain alternative with no
  // money in it at all, and the real total only in the HTML part.
  const boundary = "b1";
  const mime = [
    "From: GigSky <receipt@gigsky.com>",
    "Subject: Your receipt from GigSky #60501399",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Thank you for your purchase. View your receipt online.",
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    "<table><tr><td>Total</td><td>USD $5.00</td></tr></table>",
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const parsed = await parsePurchaseFromRawGmailMessage({
    messageId: "g1",
    raw: Buffer.from(mime).toString("base64url"),
  });

  expect(parsed.totalCents).toBe(500);
  expect(parsed.orderId).toBe("60501399");
});
