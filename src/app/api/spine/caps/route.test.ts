import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ownerStateRecord: { findUnique: vi.fn() } } }));

describe("GET /api/spine/caps", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns current cap progress in minor units", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue({
      stateData: { cardStates: { "amex-cobalt": { capProgress: { "cobalt-eats-monthly": 123.45 } } } },
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      caps: { "cobalt-eats-monthly": { usedMinor: 12345, periodKey: expect.stringMatching(/^\d{4}-\d{2}$/) } },
    });
  });

  it("does not manufacture a cap when no state is seeded", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ caps: {} });
  });
});
