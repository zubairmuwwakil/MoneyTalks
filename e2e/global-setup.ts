import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup(): Promise<void> {
  if (process.env.CLERK_SECRET_KEY?.startsWith("sk_live_")) {
    throw new Error(
      "Refusing to run e2e against a live Clerk secret key. Set CLERK_TEST_SECRET_KEY / " +
        "NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY in .env.local to a Clerk development instance.",
    );
  }
  await clerkSetup();
}
