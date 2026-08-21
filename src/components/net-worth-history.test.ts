import { describe, expect, it } from "vitest";
import type { NetWorthHistoryView } from "@/lib/domain/net-worth/netWorthHistory";
import {
  formatSignedNetWorthChange,
  formatSignedNetWorthPercent,
  netWorthHistoryAnnouncement,
  netWorthPeriodLabel,
} from "./net-worth-history";

const trackingView: NetWorthHistoryView = {
  state: "tracking",
  trackingSince: "2026-07-20",
  latestCompleteAsOf: "2026-08-20",
  incompleteAccounts: [],
  points: [
    { date: "2026-07-20", totalMinor: 1_000_000 },
    { date: "2026-08-20", totalMinor: 1_125_000 },
  ],
};

describe("net worth history presentation", () => {
  it("formats signed money and percentages without implying direction for zero", () => {
    expect(formatSignedNetWorthChange(12_345, "CAD")).toBe("+$123.45");
    expect(formatSignedNetWorthChange(-12_345, "CAD")).toBe("-$123.45");
    expect(formatSignedNetWorthChange(0, "CAD")).toBe("$0.00");
    expect(formatSignedNetWorthPercent(0.125)).toBe("+12.5%");
    expect(formatSignedNetWorthPercent(null)).toBe("—");
  });

  it("uses readable labels for every range", () => {
    expect(netWorthPeriodLabel("1W")).toBe("1 week");
    expect(netWorthPeriodLabel("1M")).toBe("1 month");
    expect(netWorthPeriodLabel("3M")).toBe("3 months");
    expect(netWorthPeriodLabel("YTD")).toBe("year to date");
    expect(netWorthPeriodLabel("1Y")).toBe("1 year");
    expect(netWorthPeriodLabel("ALL")).toBe("all tracked history");
  });

  it("announces the selected raw net-worth change and freshness date", () => {
    expect(netWorthHistoryAnnouncement(trackingView, "1M", "CAD")).toBe(
      "Net worth changed +$1,250.00 (+12.5%) over 1 month, through Aug 20, 2026.",
    );
  });

  it("announces incomplete accounts without presenting a partial daily total", () => {
    const view: NetWorthHistoryView = {
      ...trackingView,
      state: "incomplete",
      latestCompleteAsOf: "2026-08-19",
      incompleteAccounts: ["Brokerage", "Savings"],
      points: [
        { date: "2026-07-20", totalMinor: 1_000_000 },
        { date: "2026-08-19", totalMinor: 1_100_000 },
      ],
    };

    expect(netWorthHistoryAnnouncement(view, "1M", "CAD")).toBe(
      "Net worth changed +$1,000.00 (+10.0%) over 1 month, through Aug 19, 2026. Data is incomplete for Brokerage and Savings; partial days are excluded.",
    );
  });

  it("names incomplete accounts safely before any complete portfolio value exists", () => {
    const view: NetWorthHistoryView = {
      state: "incomplete",
      trackingSince: null,
      latestCompleteAsOf: null,
      incompleteAccounts: ["USD account"],
      points: [],
    };

    expect(netWorthHistoryAnnouncement(view, "1M", "CAD")).toBe(
      "Daily net worth history needs two complete nightly valuations before it can show a change. Data is incomplete for USD account; no complete portfolio value is available yet.",
    );
  });

  it("announces that two complete valuations are required instead of a zero change", () => {
    const view: NetWorthHistoryView = {
      state: "pending",
      trackingSince: "2026-08-20",
      latestCompleteAsOf: "2026-08-20",
      incompleteAccounts: [],
      points: [{ date: "2026-08-20", totalMinor: 1_000_000 }],
    };

    expect(netWorthHistoryAnnouncement(view, "1M", "CAD")).toBe(
      "Daily net worth history needs two complete nightly valuations before it can show a change.",
    );
  });
});
