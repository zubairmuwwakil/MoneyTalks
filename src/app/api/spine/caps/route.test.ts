import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";
import { capPeriodKey } from "@/lib/spine/cap-usage";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ownerStateRecord: { findUnique: vi.fn() }, capUsageLedger: { findMany: vi.fn() } } }));

describe("GET /api/spine/caps", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns current cap progress in minor units", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.capUsageLedger.findMany).mockResolvedValue([] as never);
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
    vi.mocked(prisma.capUsageLedger.findMany).mockResolvedValue([] as never);
    expect(await (await GET()).json()).toEqual({ caps: {} });
  });

  it("uses current ledger truth over the seeded baseline", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue({
      stateData: { cardStates: { "amex-cobalt": { capProgress: { "cobalt-eats-monthly": 123.45 } } } },
    } as never);
    vi.mocked(prisma.capUsageLedger.findMany).mockResolvedValue([{
      cardId: "amex-cobalt", capId: "cobalt-eats-monthly", periodKey: capPeriodKey({ period: "calendarMonth" }, {}, new Date()), usedMinor: 642,
    }] as never);
    expect((await (await GET()).json()).caps["cobalt-eats-monthly"].usedMinor).toBe(642);
  });

  it("returns observed ledger use when the seed has no cap value", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.ownerStateRecord.findUnique).mockResolvedValue({
      stateData: { cardStates: { "amex-cobalt": {} } },
    } as never);
    vi.mocked(prisma.capUsageLedger.findMany).mockResolvedValue([{
      cardId: "amex-cobalt", capId: "cobalt-eats-monthly", periodKey: capPeriodKey({ period: "calendarMonth" }, {}, new Date()), usedMinor: 642,
    }] as never);

    expect((await (await GET()).json()).caps["cobalt-eats-monthly"]).toEqual(expect.objectContaining({ usedMinor: 642 }));
  });
});
