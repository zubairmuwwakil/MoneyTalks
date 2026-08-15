import { describe, expect, it } from "vitest";
import { parseValetObservation } from "./fetch-fx";

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
