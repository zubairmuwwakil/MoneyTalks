import { describe, expect, it } from "vitest";
import { parseValetObservation, parseValetRates } from "./fetch-fx";

const fixture = {
  observations: [{ d: "2026-08-14", FXUSDCAD: { v: "1.3701" } }],
};

describe("parseValetObservation", () => {
  it("extracts the rate and date", () => {
    expect(parseValetObservation(fixture, "FXUSDCAD")).toEqual({ rate: 1.3701, asOf: "2026-08-14" });
  });

  it("returns null on malformed payloads", () => {
    expect(parseValetObservation({}, "FXUSDCAD")).toBeNull();
    expect(parseValetObservation({ observations: [] }, "FXUSDCAD")).toBeNull();
    expect(parseValetObservation({ observations: [{ d: "x", FXUSDCAD: { v: "abc" } }] }, "FXUSDCAD")).toBeNull();
  });
});

describe("multi-series rates", () => {
  // Shape verified against the live Valet API: one payload, one series key
  // per currency, each carrying its own observation cell.
  const payload = {
    observations: [
      {
        d: "2026-08-15",
        FXUSDCAD: { v: "1.3712" },
        FXEURCAD: { v: "1.4903" },
        FXGBPCAD: { v: "1.7521" },
      },
    ],
  };

  it("maps every requested currency to a CAD-quoted rate", () => {
    expect(parseValetRates(payload, ["USD", "EUR", "GBP"])).toEqual([
      { base: "USD", quote: "CAD", rate: 1.3712, asOf: "2026-08-15" },
      { base: "EUR", quote: "CAD", rate: 1.4903, asOf: "2026-08-15" },
      { base: "GBP", quote: "CAD", rate: 1.7521, asOf: "2026-08-15" },
    ]);
  });

  it("skips a currency the payload does not carry rather than failing the batch", () => {
    // One unavailable series must not cost us the rates that did arrive.
    expect(parseValetRates(payload, ["USD", "JPY"])).toEqual([
      { base: "USD", quote: "CAD", rate: 1.3712, asOf: "2026-08-15" },
    ]);
  });

  it("returns nothing for an unrecognized payload", () => {
    expect(parseValetRates({}, ["USD"])).toEqual([]);
    expect(parseValetRates(null, ["USD"])).toEqual([]);
  });

  it("never yields CAD->CAD, which needs no rate", () => {
    expect(parseValetRates(payload, ["CAD", "USD"]).map((r) => r.base)).toEqual(["USD"]);
  });
});
