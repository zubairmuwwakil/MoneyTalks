import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { cleanupE2EUser, createAuthedContext } from "./helpers/session";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2EUser();
});

test.afterAll(async () => {
  await cleanupE2EUser();
});

// click() resolves when the click dispatches, not when the server action's write
// commits — so every submit waits for the action's POST before the next navigation.
async function submit(page: Page, name: string | RegExp, urlPart: string) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(urlPart)),
    page.getByRole("button", { name }).first().click(),
  ]);
}

test("bills end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Import the fictional bill set
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "bills-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/4 bills/)).toBeVisible();

  // Grouped list with next due dates
  await page.goto("/bills");
  for (const name of ["Fixture Mortgage", "Fixture Condo Fees", "Fixture Stream Bundle", "Fixture Water"]) {
    await expect(page.getByText(name)).toBeVisible();
  }

  // September 2026 month view: triple mortgage + stepped amounts, hand-checked total
  await page.goto("/bills/month?month=2026-09");
  await expect(page.getByTestId("pileup-flag")).toContainText("3× Fixture Mortgage");
  // 3×1000.00 + condo 420.00 + stream 15.00 + water 250.00 = 3685.00
  await expect(page.getByText("Total: $3,685.00")).toBeVisible();

  // Forecast table flags the triple months
  await page.goto("/bills/forecast");
  await expect(page.getByText("3× Fixture Mortgage").first()).toBeVisible();

  // Mark a mortgage occurrence paid and see it reflected
  await page.goto("/bills");
  await page.getByText("Fixture Mortgage").click();
  await submit(page, "mark paid", "/bills/");
  await expect(page.getByText("paid", { exact: true }).first()).toBeVisible();

  // Dashboard strip shows something due in the next 14 days (biweekly guarantees it)
  await page.goto("/");
  await expect(page.getByText("Next 14 days")).toBeVisible();
  await expect(page.getByText("Fixture Mortgage").first()).toBeVisible();

  await context.close();
});

// The import path covers everything above; the create form is the one write
// path it never touches, and its cadence/schedule travel as client-assembled
// JSON in hidden fields.
test("creating a biweekly bill through the form", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  await page.goto("/bills/new");
  await page.locator('input[name="name"]').fill("Fixture Hydro");
  await page.locator('select[name="category"]').selectOption("utilities");
  await page.getByLabel("Cadence").selectOption("BIWEEKLY");
  await page.getByLabel(/Anchor date/).fill("2026-01-07");
  await page.getByLabel("Amount (cents)").fill("8250");
  await page.getByLabel("Amount effective from").fill("2020-01-01");
  await submit(page, "Create bill", "/bills/new");

  await expect(page.getByText("Fixture Hydro")).toBeVisible();

  // Same anchor as the fixture mortgage, so April 2026 piles up for both bills:
  // 14-day steps from 2026-01-07 land on the 1st, 15th and 29th of April.
  await page.goto("/bills/month?month=2026-04");
  const pileup = page.getByTestId("pileup-flag");
  await expect(pileup).toContainText("3× Fixture Hydro");
  await expect(pileup).toContainText("3× Fixture Mortgage");
  await expect(page.getByText("$82.50").first()).toBeVisible();

  // A duplicate name is rejected rather than silently replacing the schedule
  await page.goto("/bills/new");
  await page.locator('input[name="name"]').fill("Fixture Hydro");
  await page.getByLabel("Amount (cents)").fill("100");
  await page.getByLabel("Amount effective from").fill("2020-01-01");
  await submit(page, "Create bill", "/bills/new");
  await expect(page.getByText(/already exists/)).toBeVisible();

  await context.close();
});
