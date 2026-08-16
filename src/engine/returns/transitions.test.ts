import { describe, expect, it } from "vitest";
import { canTransition, type ReturnStatus } from "./transitions";

const statuses: ReturnStatus[] = ["NOT_STARTED", "PACKED", "DROPPED_OFF", "DELIVERED", "REFUNDED"];

describe("canTransition", () => {
  it.each(statuses.flatMap((from, fromIndex) => statuses.map((to, toIndex) => [from, to, fromIndex <= toIndex] as const)))(
    "%s → %s is %s",
    (from, to, expected) => {
      expect(canTransition(from, to)).toBe(expected);
    },
  );
});
