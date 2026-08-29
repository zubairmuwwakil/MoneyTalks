import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST as updateScanMode } from "./scan-mode/route";
import { POST as disconnect } from "./disconnect/route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/require-user";

vi.mock("@/lib/require-user", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailConnection: { updateMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/gmail/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("per-connection Gmail mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.emailConnection.deleteMany).mockResolvedValue({ count: 1 });
  });

  it("updates one connection's scan mode with an owner authorization check", async () => {
    const response = await updateScanMode(request("scan-mode", {
      connectionId: "conn-a",
      scanMode: "RECEIPTS_ONLY",
    }));

    expect(response.status).toBe(200);
    expect(prisma.emailConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "conn-a", userId: "user-1" },
      data: { scanMode: "RECEIPTS_ONLY" },
    });
  });

  it("returns 404 rather than addressing another owner's connection", async () => {
    vi.mocked(prisma.emailConnection.updateMany).mockResolvedValue({ count: 0 });

    const response = await updateScanMode(request("scan-mode", {
      connectionId: "conn-other-owner",
      scanMode: "ALL",
    }));

    expect(response.status).toBe(404);
  });

  it("disconnects one mailbox and leaves all others alone", async () => {
    const response = await disconnect(request("disconnect", { connectionId: "conn-a" }));

    expect(response.status).toBe(200);
    expect(prisma.emailConnection.deleteMany).toHaveBeenCalledWith({
      where: { id: "conn-a", userId: "user-1" },
    });
  });
});
