import type { Browser, BrowserContext } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { prisma } from "../../src/lib/prisma";

// const prisma = new PrismaClient();
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Clerk treats any local part before "+clerk_test@example.com" as a test
// identity: sign-in tickets work against it without real email delivery.
export const E2E_EMAIL = "e2e-test+clerk_test@example.com";

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

async function ensureClerkTestUser(): Promise<string> {
  const existing = await clerkClient.users.getUserList({ emailAddress: [E2E_EMAIL] });
  if (existing.data[0]) return existing.data[0].id;
  // The dev instance requires username/password/phone at creation time; these
  // values are never used to sign in (createAuthedContext signs in via a
  // ticket), so fixed test fixtures are fine — +15555550100 is Clerk's
  // documented test phone number, exempt from real SMS delivery.
  const created = await clerkClient.users.createUser({
    emailAddress: [E2E_EMAIL],
    username: "e2e_test_user",
    password: "e2e-test-fixture-password-1",
    skipPasswordChecks: true,
    phoneNumber: ["+15555550100"],
  });
  return created.id;
}

export async function createAuthedContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  await ensureClerkTestUser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
  await page.close();
  return context;
}

export async function cleanupE2EUser(): Promise<void> {
  await withDbRetry(() => prisma.user.deleteMany({ where: { email: E2E_EMAIL } })); // cascades sessions + financial data
}
