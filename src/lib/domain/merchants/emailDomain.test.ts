import { describe, expect, it } from "vitest";
import {
  domainFromEmail,
  isPublicSuffixKey,
  normalizeMerchantFromSender,
} from "./emailDomain";

describe("normalizeMerchantFromSender", () => {
  it("does not collapse multi-label public suffixes into one merchant", () => {
    // The retired `parts.slice(-2)` mapped all three onto "co.uk", fusing
    // unrelated companies into a single merchant. A false merge is worse than
    // a miss: it carries the evidence of everything it swallowed.
    const keys = [
      normalizeMerchantFromSender("noreply@shopify.co.uk"),
      normalizeMerchantFromSender("bills@britishgas.co.uk"),
      normalizeMerchantFromSender("info@netflix.co.uk"),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(keys).not.toContain("co.uk");
  });

  it("handles other multi-label suffixes", () => {
    expect(normalizeMerchantFromSender("a@telstra.com.au")).toBe("telstra.com.au");
    expect(normalizeMerchantFromSender("a@spark.co.nz")).toBe("spark.co.nz");
    expect(normalizeMerchantFromSender("a@hmrc.gov.uk")).toBe("hmrc.gov.uk");
  });

  it("folds subdomain drift onto one merchant", () => {
    expect(normalizeMerchantFromSender("noreply@email.netflix.com")).toBe(
      normalizeMerchantFromSender("info@netflix.com"),
    );
  });

  it("keeps plain domains intact", () => {
    expect(normalizeMerchantFromSender("invoice+statements@vercel.com")).toBe("vercel.com");
  });

  it("falls back to the subject when there is no sender", () => {
    expect(normalizeMerchantFromSender(undefined, "Costco receipt")).toBe("costco");
    expect(normalizeMerchantFromSender(null, null)).toBe("unknown");
  });
});

describe("isPublicSuffixKey", () => {
  it("flags the fingerprint of the retired two-label slice", () => {
    expect(isPublicSuffixKey("co.uk")).toBe(true);
    expect(isPublicSuffixKey("com.au")).toBe(true);
  });

  it("does not flag real merchant keys or wallet display names", () => {
    expect(isPublicSuffixKey("netflix.com")).toBe(false);
    expect(isPublicSuffixKey("shopify.co.uk")).toBe(false);
    // Wallet taps share this table and arrive as display names.
    expect(isPublicSuffixKey("AMERICAN EXPRESS")).toBe(false);
  });
});

describe("domainFromEmail", () => {
  it("extracts and lowercases", () => {
    expect(domainFromEmail("Billing <NoReply@Vercel.COM>")).toBe("vercel.com");
    expect(domainFromEmail(undefined)).toBeUndefined();
  });
});
