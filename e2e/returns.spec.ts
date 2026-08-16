import { expect, test } from "@playwright/test";
import path from "node:path";
import { cleanupE2EUser, createAuthedContext } from "./helpers/session";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2EUser();
});

test.afterAll(async () => {
  await cleanupE2EUser();
});

test("returns end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // 1. Upload receipt
  await page.goto("/receipts/upload");
  await page.setInputFiles('input[type="file"]', path.join(__dirname, "fixtures/dummy_receipt.jpg"));

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/receipts/upload")),
    page.getByRole("button", { name: "Upload" }).click(),
  ]);

  expect(response.ok()).toBeTruthy();

  // wait for success redirect or message
  await expect(page).toHaveURL(/\/settings\/automation\/review/);

  // 2. Purchase appears in purchases
  await page.goto("/purchases");
  await expect(page.locator("text=dummy_receipt").first()).toBeVisible();

  await page.locator("text=dummy_receipt").first().click();
  await expect(page).toHaveURL(/\/purchases\/.+/);

  // 3. Create return
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Start a return" }).click(),
  ]);

  // Appears on returns board
  await expect(page).toHaveURL(/\/returns/);
  await expect(page.locator("text=dummy_receipt").first()).toBeVisible();
});
