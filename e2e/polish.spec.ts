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

test("csv import, analyzer, and tax checklist", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Seed: accounts fixture (Phase 1) + cards fixture (Phase 4)
  for (const fixture of ["import-sample.json", "cards-sample.json"]) {
    await page.goto("/investments/import");
    await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", fixture));
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported:/)).toBeVisible();
  }

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

  // Analyzer: Beta statement -> hand-checked missed-rewards figure.
  // groceries 3% of $1000 = $30.00, dining base 1.5% of $500 = $7.50, misc 1.5%
  // of $200 = $3.00 -> $40.50 earned. Optimal: Alpha 4.8% = $48.00, Alpha 6% =
  // $30.00, Gamma 2% = $4.00 -> $82.00. Missed $41.50.
  await page.goto("/cards/analyzer");
  await page.locator('select[name="cardId"]').selectOption({ label: "Fixture Beta Visa" });
  await page.locator('input[name="file"]').setInputFiles(csv);
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByTestId("analyzer-report")).toContainText("You left $41.50 on the table");

  // Tax checklist renders with the FBAR line
  await page.goto("/money-finder/tax");
  await expect(page.getByText(/FinCEN 114/)).toBeVisible();

  await context.close();
});
