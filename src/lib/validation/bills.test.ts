import { describe, expect, it } from "vitest";
import { billFormInput, billImportEntry, cadenceInput, scheduleEntryInput } from "./bills";

describe("cadenceInput", () => {
  it("accepts each cadence shape", () => {
    expect(cadenceInput.safeParse({ type: "WEEKLY", anchor: "2026-01-07" }).success).toBe(true);
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
    expect(cadenceInput.safeParse({ type: "SEMIANNUAL", anchor: "2026-09-30" }).success).toBe(true);
    expect(cadenceInput.safeParse({ type: "ANNUAL", anchor: "2026-09-30" }).success).toBe(true);
  });

  it("rejects a biweekly cadence without an anchor and bad day numbers", () => {
    expect(cadenceInput.safeParse({ type: "BIWEEKLY" }).success).toBe(false);
    expect(cadenceInput.safeParse({ type: "MONTHLY", dayOfMonth: 32 }).success).toBe(false);
  });
});

describe("billImportEntry", () => {
  it("accepts a full bill with stepped schedule and granular taxonomy category", () => {
    const parsed = billImportEntry.safeParse({
      name: "Fixture Stream Bundle",
      category: "subscriptions:streaming",
      autopay: true,
      cadence: { type: "MONTHLY", dayOfMonth: 1 },
      schedule: [
        { from: "2025-09-01", to: "2026-08-31", amount: 10.0 },
        { from: "2026-09-01", amount: 15.0 },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.category).toBe("subscriptions:streaming");
    }
  });

  it("requires at least one schedule entry", () => {
    expect(
      billImportEntry.safeParse({
        name: "x",
        category: "other:uncategorized",
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

describe("payment rail", () => {
  const base = {
    name: "Durham Region Water",
    category: "utilities" as const,
    cadence: { type: "MONTHLY" as const, dayOfMonth: 15 },
    schedule: [{ from: "2026-01-01", amount: 120.0 }],
  };

  it("defaults to unknown so an unrecorded rail keeps the old category behaviour", () => {
    const parsed = billImportEntry.safeParse(base);
    expect(parsed.success && parsed.data.paymentRail).toBe("unknown");
  });

  it("accepts each real rail value", () => {
    for (const paymentRail of ["unknown", "card", "pad", "card_via_third_party"]) {
      expect(billImportEntry.safeParse({ ...base, paymentRail }).success).toBe(true);
    }
  });

  it("rejects a rail outside the known vocabulary", () => {
    expect(billImportEntry.safeParse({ ...base, paymentRail: "interac" }).success).toBe(false);
  });

  it("treats a blank fee input as absent rather than as a free rail", () => {
    const parsed = billImportEntry.safeParse({ ...base, paymentRail: "card_via_third_party", railFeePct: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.railFeePct).toBeUndefined();
  });

  it("parses a percentage fee and rejects a nonsensical one", () => {
    const ok = billImportEntry.safeParse({ ...base, paymentRail: "card_via_third_party", railFeePct: "2.5" });
    expect(ok.success && ok.data.railFeePct).toBe(2.5);
    expect(billImportEntry.safeParse({ ...base, railFeePct: -1 }).success).toBe(false);
    expect(billImportEntry.safeParse({ ...base, railFeePct: 101 }).success).toBe(false);
  });

  it("accepts payee and accountNumber fields", () => {
    const parsed = billImportEntry.safeParse({
      ...base,
      payee: "DURHAM WATER, REG MUN OF",
      accountNumber: "1643208999",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.payee).toBe("DURHAM WATER, REG MUN OF");
      expect(parsed.data.accountNumber).toBe("1643208999");
    }
  });

  it("accepts manual account access and safe portal metadata", () => {
    const parsed = billFormInput.safeParse({
      name: base.name,
      category: base.category,
      cadenceJson: JSON.stringify(base.cadence),
      scheduleJson: JSON.stringify(base.schedule),
      accountNumber: "POL-AB-9912",
      accountNumberLabel: "Policy number",
      loginIdentifier: "billing@example.com",
      credentialLocation: "iCloud Passwords",
      serviceUrl: "https://example.com",
      loginUrl: "https://example.com/login",
      billerKind: "SERVICE",
      paymentSource: "card:card-1",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.loginIdentifier).toBe("billing@example.com");
      expect(parsed.data.paymentSource).toBe("card:card-1");
    }
  });

  it("rejects non-web portal URL schemes", () => {
    const parsed = billFormInput.safeParse({
      name: base.name,
      category: base.category,
      cadenceJson: JSON.stringify(base.cadence),
      scheduleJson: JSON.stringify(base.schedule),
      serviceUrl: "javascript:alert(1)",
    });
    expect(parsed.success).toBe(false);
  });
});
