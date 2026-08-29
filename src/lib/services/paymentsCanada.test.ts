import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lookupCorporateCreditor,
  resetPaymentsCanadaTokenCacheForTests,
  searchCorporateCreditors,
} from "./paymentsCanada";

const record = {
  ccin: "91234567",
  shortname: "TORONTO HYDRO",
  status: "A",
  statusDate: "2026-08-01",
  cycleDate: "2026-08-28",
  provCode: "ON",
  countryCode: "CANADA",
  acceptableMediaType: "2",
  leadFiName: "TEST BANK",
};

describe("Payments Canada CCIN client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetPaymentsCanadaTokenCacheForTests();
    process.env.PAYMENTS_CANADA_CONSUMER_KEY = "consumer-key";
    process.env.PAYMENTS_CANADA_CONSUMER_SECRET = "consumer-secret";
    process.env.PAYMENTS_CANADA_ENV = "sandbox";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.PAYMENTS_CANADA_CONSUMER_KEY;
    delete process.env.PAYMENTS_CANADA_CONSUMER_SECRET;
    delete process.env.PAYMENTS_CANADA_ENV;
  });

  it("authenticates once and searches the sandbox master extract", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 300 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([record]), { status: 200 }));
    global.fetch = fetchMock;

    await expect(searchCorporateCreditors("hydro")).resolves.toEqual([
      expect.objectContaining({
        ccin: "91234567",
        shortName: "TORONTO HYDRO",
        status: "ACTIVE",
        acceptsElectronic: true,
        environment: "sandbox",
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ccin-extracts-sandbox/extracts/master");
    expect(String(fetchMock.mock.calls[1][0])).toContain("filter=hydro");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
    });
  });

  it("revalidates a selected biller through the single-CCIN endpoint", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "token", expires_in: 300 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(record), { status: 200 }));

    const result = await lookupCorporateCreditor("91234567");
    expect(result.shortName).toBe("TORONTO HYDRO");
    expect(String(vi.mocked(global.fetch).mock.calls[1][0])).toContain("/ccin-lookup-sandbox/ccins/91234567");
  });

  it("never calls the API for a one-character search", async () => {
    global.fetch = vi.fn();
    await expect(searchCorporateCreditors("x")).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
