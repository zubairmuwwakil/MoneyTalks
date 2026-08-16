import { getSessionUserId } from "@/lib/require-user";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return Response.json({ email: user?.email ?? null });
}
