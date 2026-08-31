import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { recordLegacySubscriptionAdapterRequest } from "@/lib/observability";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordLegacySubscriptionAdapterRequest: vi.fn() }));

describe("POST /api/subscriptions/[id]/confirm-detection", () => {
  beforeEach(() => vi.mocked(getSessionUserId).mockResolvedValue("user-1"));

  it("is retired without attempting a partial translation", async () => {
    const request = new Request("http://localhost/api/subscriptions/sub-1/confirm-detection", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(410);
    expect(response.headers.get("Deprecation")).toBe("true");
    await expect(response.json()).resolves.toEqual({
      error: "confirm-detection is retired; use /api/recurring evidence review instead.",
    });
    expect(recordLegacySubscriptionAdapterRequest).toHaveBeenCalledWith({
      request,
      route: "confirm-detection",
      method: "POST",
    });
  });
});
