import { prisma } from "@/lib/prisma";

export async function resolveUniqueNickname(userId: string, requested: string): Promise<string> {
  const existing = await prisma.creditCard.findMany({
    where: { userId, nickname: { startsWith: requested } },
    select: { nickname: true },
  });
  const names = new Set((existing || []).map((c) => c.nickname));
  if (!names.has(requested)) return requested;
  let counter = 2;
  while (names.has(`${requested} (${counter})`)) {
    counter++;
  }
  return `${requested} (${counter})`;
}
