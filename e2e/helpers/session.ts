import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const E2E_EMAIL = "e2e-test@example.com";

function isTransientDbError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "P1001" ||
    code === "P1002" ||
    message.includes("Can't reach database server") ||
    message.includes("Timed out")
  );
}

async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDbError(error)) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function createAuthedContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const user = await withDbRetry(() =>
    prisma.user.upsert({
      where: { email: E2E_EMAIL },
      update: {},
      create: { email: E2E_EMAIL },
    }),
  );
  const sessionToken = randomUUID();
  await withDbRetry(() =>
    prisma.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    }),
  );
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: sessionToken, url: baseURL },
  ]);
  return context;
}

export async function cleanupE2EUser(): Promise<void> {
  await withDbRetry(() => prisma.user.deleteMany({ where: { email: E2E_EMAIL } })); // cascades sessions + financial data
}
