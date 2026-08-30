import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe: liveness is /api/health; this one verifies the DB path. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, ready: true });
  } catch {
    return NextResponse.json({ ok: false, ready: false }, { status: 503 });
  }
}
