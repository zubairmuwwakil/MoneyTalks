import { describe, expect, it } from "vitest";
import {
  aggregateCommunityInventory,
  communityInventorySubmissionSchema,
  normalizeCommunityKey,
  roundedCommunityCoordinate,
} from "./community-gift-card-inventory";

const now = new Date("2026-09-04T16:00:00Z");
const candidate = { merchantKey: "Metro", placeId: "metro-oshawa" };

function row(availability: "available" | "unavailable", observedAt = now) {
  return {
    merchantKey: "metro",
    placeId: "metro-oshawa",
    latitude: null,
    longitude: null,
    availability,
    observedAt,
  };
}

describe("community gift-card inventory boundary", () => {
  it("requires a physical location and accepts no account/card/purchase fields", () => {
    expect(communityInventorySubmissionSchema.safeParse({
      schemaVersion: 1,
      observationId: "52d3231d-d17b-47ac-a7d7-4cd3604a618a",
      merchantKey: "Metro",
      instrumentKey: "Shoppers Drug Mart gift card",
      availability: "available",
      observedAt: now.toISOString(),
    }).success).toBe(false);

    expect(communityInventorySubmissionSchema.safeParse({
      schemaVersion: 1,
      observationId: "52d3231d-d17b-47ac-a7d7-4cd3604a618a",
      merchantKey: "Metro",
      placeId: "metro-oshawa",
      instrumentKey: "Shoppers Drug Mart gift card",
      availability: "available",
      observedAt: now.toISOString(),
      cardId: "must-not-cross-boundary",
      amount: 100,
    }).success).toBe(true); // Zod strips unknown fields; routes persist only parsed fields.
  });

  it("normalizes keys and rounds store coordinates before persistence", () => {
    expect(normalizeCommunityKey("  Métro #12  ")).toBe("metro 12");
    expect(roundedCommunityCoordinate(43.8971234)).toBe(43.8971);
  });

  it("caps a spammy location-day at three evidence units", () => {
    const reports = Array.from({ length: 100 }, () => row("available"));
    const [signal] = aggregateCommunityInventory(reports, [candidate], now);
    expect(signal.availableUnits).toBe(3);
    expect(signal.unavailableUnits).toBe(0);
  });

  it("preserves conflict instead of converting majority noise into certainty", () => {
    const [signal] = aggregateCommunityInventory(
      [row("available"), row("unavailable")], [candidate], now,
    );
    expect(signal.availableUnits).toBe(1);
    expect(signal.unavailableUnits).toBe(1);
  });

  it("never leaks reports between physical locations of the same banner", () => {
    const [signal] = aggregateCommunityInventory(
      [row("available")],
      [candidate, { merchantKey: "Metro", placeId: "metro-toronto" }],
      now,
    );
    expect(signal.candidateKey).toBe("p:metro-oshawa");
  });
});
