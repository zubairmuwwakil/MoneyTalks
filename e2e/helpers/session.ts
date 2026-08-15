import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const E2E_EMAIL = "e2e-test@example.com";

export async function createAuthedContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const user = await prisma.user.upsert({
    where: { email: E2E_EMAIL },
    update: {},
    create: { email: E2E_EMAIL },
  });
  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: sessionToken, url: baseURL },
  ]);
  return context;
}

export async function cleanupE2EUser(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: E2E_EMAIL } }); // cascades sessions + financial data
}
