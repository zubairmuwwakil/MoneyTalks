import { describe, expect, it } from "vitest";
import { billImportEntry, cadenceInput, scheduleEntryInput } from "./bills";

describe("cadenceInput", () => {
  it("accepts each cadence shape", () => {
    expect(cadenceInput.safeParse({ type: "BIWEEKLY", anchor: "2026-01-07" }).success).toBe(true);
    expect(
      cadenceInput.safeParse({
        type: "MONTHLY",
        dayOfMonth: 1,
        startsFrom: "2027-02-01",
        activeMonths: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      }).success,
    ).toBe(true);
    expect(cadenceInput.safeParse({ type: "QUARTERLY", anchor: "2026-09-30" }).success).toBe(true);
  });

  it("rejects a biweekly cadence without an anchor and bad day numbers", () => {
    expect(cadenceInput.safeParse({ type: "BIWEEKLY" }).success).toBe(false);
    expect(cadenceInput.safeParse({ type: "MONTHLY", dayOfMonth: 32 }).success).toBe(false);
  });
});

describe("billImportEntry", () => {
  it("accepts a full bill with stepped schedule", () => {
    const parsed = billImportEntry.safeParse({
      name: "Fixture Stream Bundle",
      category: "subscriptions",
      autopay: true,
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [
        { from: "2025-09-01", to: "2026-08-31", amount: 10.0 },
        { from: "2026-09-01", amount: 15.0 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires at least one schedule entry", () => {
    expect(
      billImportEntry.safeParse({
        name: "x",
        category: "other",
        cadence: { type: "MONTHLY", dayOfMonth: 1 },
        schedule: [],
      }).success,
    ).toBe(false);
  });
});

// --- Deviations from the plan, agreed with the owner ---

describe("form-blank handling", () => {
  it("treats an empty optional date input as absent, so open-ended entries are addable", () => {
    // <input type="date" name="to"> submits "" when left blank; a bare
    // isoDate.optional() rejects that, making open-ended entries unaddable.
    const parsed = scheduleEntryInput.safeParse({ from: "2026-01-01", to: "", amount: "5.00" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.to).toBeUndefined();
  });

  it("does not coerce the string 'false' to true", () => {
    const parsed = billImportEntry.safeParse({
      name: "Fixture Gym",
      category: "other",
      autopay: "false",
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [{ from: "2026-01-01", amount: 1.0 }],
    });
    expect(parsed.success && parsed.data.autopay).toBe(false);
  });
});

describe("calendar and range validation", () => {
  it("rejects dates that do not exist", () => {
    expect(scheduleEntryInput.safeParse({ from: "2026-02-31", amount: 1.0 }).success).toBe(false);
    expect(cadenceInput.safeParse({ type: "BIWEEKLY", anchor: "2026-13-01" }).success).toBe(false);
  });

  it("rejects an amount beyond the int32 column range", () => {
    expect(scheduleEntryInput.safeParse({ from: "2026-01-01", amount: "21474836.48" }).success).toBe(false);
  });

  it("rejects a schedule entry ending before it starts", () => {
    expect(
      scheduleEntryInput.safeParse({ from: "2026-06-01", to: "2026-01-01", amount: 1.0 }).success,
    ).toBe(false);
  });
});
