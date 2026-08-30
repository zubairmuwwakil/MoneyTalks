import { describe, expect, it, vi } from "vitest";

import { parseReceiptUpload } from "./uploadedReceiptParser";

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    async getText() {
      return { text: "Example Store\n2026-08-17\nOrder total: $42.99" };
    }
    async destroy() {}
  },
}));

describe("parseReceiptUpload", () => {
  it("does not assign CAD to an image whose currency has not been read", async () => {
    const parsed = await parseReceiptUpload({
      buffer: Buffer.from("not yet OCRed"),
      contentType: "image/png",
      filename: "receipt.png",
      defaultReturnDays: 30,
    });

    expect(parsed.currency).toBeUndefined();
  });

  it("does not assign CAD to a PDF with only a bare dollar sign", async () => {
    const parsed = await parseReceiptUpload({
      buffer: Buffer.from("mock pdf"),
      contentType: "application/pdf",
      filename: "receipt.pdf",
      defaultReturnDays: 30,
    });

    expect(parsed.amountCents).toBe(4_299);
    expect(parsed.currency).toBeUndefined();
  });
});
