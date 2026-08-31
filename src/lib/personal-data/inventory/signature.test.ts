import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyNotionWebhookSignature } from "./signature";

describe("verifyNotionWebhookSignature", () => {
  const body = JSON.stringify({ id: "evt_1", type: "page.properties_updated" });
  const token = "verification-token";
  const valid = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;

  it("accepts the HMAC over the exact raw body", () => {
    expect(verifyNotionWebhookSignature(body, valid, token)).toBe(true);
  });

  it("rejects tampered bodies and missing headers", () => {
    expect(verifyNotionWebhookSignature(`${body} `, valid, token)).toBe(false);
    expect(verifyNotionWebhookSignature(body, null, token)).toBe(false);
  });
});
