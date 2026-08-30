import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    recurringObligation: { findFirst: vi.fn() },
    recurringObligationEvidence: { updateMany: vi.fn() },
  },
}));

const context = { params: Promise.resolve({ id: "obligation-1" }) };
function request(body: unknown) {
  return new Request("http://localhost/api/recurring/obligation-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/recurring/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "obligation-1" }]);
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue({ id: "obligation-1" } as never);
    vi.mocked(prisma.recurringObligationEvidence.updateMany).mockResolvedValue({ count: 1 });
  });

  it("rejects dismissal without a reason instead of storing a null label", async () => {
    const response = await PATCH(request({ action: "dismiss" }) as never, context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "A dismissal reason is required" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("dismisses with an owner-scoped mutation and snapshots the deciding score", async () => {
    const response = await PATCH(request({ action: "dismiss", dismissReason: "not-recurring" }) as never, context);

    expect(response.status).toBe(200);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    const query = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toContain('"userId" = ?');
    expect(sql).toContain('"decidedConfidence" = confidence');
    expect(sql).toContain('"decidedReasons" = "confidenceReasons"');
    expect(query.values).toEqual(expect.arrayContaining(["obligation-1", "user-1", "not-recurring"]));
  });

  it("confirms once without allowing a later action to overwrite the snapshot", async () => {
    await PATCH(request({ action: "confirm" }) as never, context);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const second = await PATCH(request({ action: "dismiss", dismissReason: "not-recurring" }) as never, context);

    await expect(second.json()).resolves.toEqual({ ok: true, alreadyHandled: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("scopes evidence exclusion through the obligation owner", async () => {
    await PATCH(request({ action: "exclude-evidence", evidenceId: "evidence-1" }) as never, context);

    expect(prisma.recurringObligationEvidence.updateMany).toHaveBeenCalledWith({
      where: {
        id: "evidence-1",
        obligationId: "obligation-1",
        obligation: { userId: "user-1" },
      },
      data: { excludedByUser: true },
    });
  });

  it("returns not found when the owner-scoped lookup cannot see the obligation", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.recurringObligation.findFirst).mockResolvedValue(null);
    const response = await PATCH(request({ action: "confirm" }) as never, context);
    expect(response.status).toBe(404);
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});
