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

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "3000";
if (!/^\d{2,5}$/.test(playwrightPort)) {
  throw new Error("PLAYWRIGHT_PORT must be a numeric TCP port");
}
const baseURL = `http://localhost:${playwrightPort}`;

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
  use: { baseURL },
  webServer: {
    command: `npm run dev -- -p ${playwrightPort}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
