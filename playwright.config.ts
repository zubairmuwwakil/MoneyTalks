import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

// @clerk/testing's ticket-based sign-in only works against a Clerk
// development instance. Point this process (and the webServer child it
// spawns) at the dev-instance keys so e2e never touches the live app.
if (process.env.CLERK_TEST_SECRET_KEY) {
  process.env.CLERK_SECRET_KEY = process.env.CLERK_TEST_SECRET_KEY;
}
if (process.env.NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_TEST_PUBLISHABLE_KEY;
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Real Clerk sign-in (network round-trips to the dev instance) is slower
  // than the old forged-DB-session cookie, so give tests more headroom.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every spec seeds and tears down the same fixture user against one shared
  // database, so spec files must not run in parallel workers.
  workers: 1,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
