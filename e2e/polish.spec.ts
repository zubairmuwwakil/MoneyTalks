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

test("csv import and tax checklist", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Seed: accounts fixture (Phase 1)
  await page.goto("/investments/import");
  await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();

  // CSV import into the fictional RRSP: preview first, then 3 rows in, then
  // re-import the same file and watch every row get skipped as a duplicate.
  await page.goto("/investments");
  await page.getByRole("link", { name: "Maple RRSP" }).click();
  await page.getByRole("link", { name: "Import CSV" }).click();
  const csv = path.join(__dirname, "fixtures", "statement-sample.csv");

  await page.locator('input[name="file"]').setInputFiles(csv);
  await page.locator('select[name="dateFormat"]').selectOption("MDY");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("SUPERMARKET PLAZA")).toBeVisible();

  await page.locator('input[name="file"]').setInputFiles(csv);
  await page.locator('select[name="dateFormat"]').selectOption("MDY");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("3 imported, 0 duplicates skipped, 0 error rows")).toBeVisible();

  await page.locator('input[name="file"]').setInputFiles(csv);
  await page.locator('select[name="dateFormat"]').selectOption("MDY");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("0 imported, 3 duplicates skipped, 0 error rows")).toBeVisible();

  // Tax checklist renders with the FBAR line
  await page.goto("/money-finder/tax");
  await expect(page.getByText(/FinCEN 114/)).toBeVisible();

  await context.close();
});
