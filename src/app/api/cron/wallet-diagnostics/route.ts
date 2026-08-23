import { type NextRequest, NextResponse } from "next/server";
import { deleteExpiredWalletDiagnostics } from "@/lib/domain/wallet/diagnostics";
import { isAuthorizedCronRequest } from "@/lib/security/cronAuth";

async function run(req: NextRequest) {
  if (!(await isAuthorizedCronRequest(req))) return new NextResponse("Forbidden", { status: 403 });
  const result = await deleteExpiredWalletDiagnostics();
  return NextResponse.json({ ok: true, deleted: result.count });
}
export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
