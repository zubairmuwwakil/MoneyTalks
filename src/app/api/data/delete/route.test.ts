import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import { getSessionAccount } from "@/lib/require-user";
import { clerkClient } from "@clerk/nextjs/server";
import { recordSubscriptionDataOperation } from "@/lib/observability";

vi.mock("@/lib/require-user", () => ({ getSessionAccount: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordSubscriptionDataOperation: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    dataDeletionJob: { create: vi.fn(), update: vi.fn() },
    user: { delete: vi.fn() },
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

/** Records which Prisma models a `$transaction` callback wiped, without naming them up front. */
function transactionRecorder() {
  const wiped: string[] = [];
  const tx = new Proxy(
    {},
    {
      get: (_target, model: string) => ({
        deleteMany: async () => {
          wiped.push(model);
          return { count: 0 };
        },
      }),
    },
  );
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (run: (tx: unknown) => Promise<unknown>) => run(tx)) as never,
  );
  return wiped;
}

function request(body?: unknown) {
  return new Request("http://localhost/api/data/delete", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const deleteUser = vi.fn();

describe("POST /api/data/delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(clerkClient).mockResolvedValue({ users: { deleteUser } } as never);
    vi.mocked(prisma.dataDeletionJob.create).mockResolvedValue({ id: "job-1" } as never);
  });

  it("requires a Clerk session", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
  });

  it("wipes data but keeps the account when no scope is given", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    transactionRecorder();

    const response = await POST(request());

    expect(await response.json()).toEqual({ ok: true, jobId: "job-1", scope: "data" });
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(prisma.dataDeletionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
    expect(recordSubscriptionDataOperation).toHaveBeenCalledWith({
      operation: "delete", outcome: "success", scope: "data",
    });
  });

  it("wipes the wallet and spine tables the app syncs into", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    const wiped = transactionRecorder();

    await POST(request({ scope: "data" }));

    expect(wiped).toEqual(
      expect.arrayContaining([
        "walletEvent",
        "walletInstallation",
        "capUsageLedger",
        "capAccrual",
        "ownerStateRecord",
        "receiptDocument",
      ]),
    );
  });

  it("deletes the user row and the Clerk user for a full account deletion", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    vi.mocked(prisma.user.delete).mockResolvedValue({ id: "user-1" } as never);

    const response = await POST(request({ scope: "account" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, scope: "account" });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(deleteUser).toHaveBeenCalledWith("clerk-1");
  });

  it("removes the database row before the sign-in, so a failure stays recoverable", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    const order: string[] = [];
    vi.mocked(prisma.user.delete).mockImplementation((async () => {
      order.push("database");
      return { id: "user-1" };
    }) as never);
    deleteUser.mockImplementation(async () => {
      order.push("clerk");
    });

    await POST(request({ scope: "account" }));

    expect(order).toEqual(["database", "clerk"]);
  });

  it("treats an already-deleted Clerk user as success", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    vi.mocked(prisma.user.delete).mockResolvedValue({ id: "user-1" } as never);
    deleteUser.mockRejectedValue({ status: 404 });

    expect((await POST(request({ scope: "account" }))).status).toBe(200);
  });

  it("leaves the Clerk user alone and records the failure when the database delete fails", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    vi.mocked(prisma.user.delete).mockRejectedValue(new Error("connection lost"));

    const response = await POST(request({ scope: "account" }));

    expect(response.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(prisma.dataDeletionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(recordSubscriptionDataOperation).toHaveBeenCalledWith({
      operation: "delete", outcome: "failure", scope: "account",
    });
  });

  it("tells the client the data is gone when only the sign-in removal fails", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });
    vi.mocked(prisma.user.delete).mockResolvedValue({ id: "user-1" } as never);
    deleteUser.mockRejectedValue(new Error("clerk is down"));

    const response = await POST(request({ scope: "account" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.any(String), dataDeleted: true });
    expect(recordSubscriptionDataOperation).toHaveBeenCalledWith({
      operation: "delete", outcome: "partial", scope: "account",
    });
  });

  it("rejects an unrecognised scope rather than guessing", async () => {
    vi.mocked(getSessionAccount).mockResolvedValue({ id: "user-1", clerkId: "clerk-1" });

    expect((await POST(request({ scope: "everything" }))).status).toBe(400);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
