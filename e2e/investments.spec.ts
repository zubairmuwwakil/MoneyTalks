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

test("import fixture, see accounts with balances, toggle currency", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Import the fictional fixture
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();

  // Accounts page: all 5 with native-currency balances (spec acceptance)
  await page.goto("/investments");
  for (const name of ["Maple RRSP", "Maple TFSA", "Maple RDSP", "Eagle Roth IRA", "Comet Crypto"]) {
    await expect(page.getByText(name)).toBeVisible();
  }
  await expect(page.getByText("$3,000.00")).toBeVisible(); // Maple RRSP snapshot

  // Dashboard in CAD: 3000 + 1500 + 5000 + (2000*1.4) + (1000*1.4) = 13,700.00
  await page.goto("/?ccy=CAD");
  await expect(page.getByText("$13,700.00")).toBeVisible();

  // Toggle to USD: 3000/1.4 + 1500/1.4 + 5000/1.4 + 2000 + 1000 = 9,785.72 after per-account rounding
  await page.goto("/?ccy=USD");
  await expect(page.getByText(/9,785\.7/)).toBeVisible();

  // Idempotency: re-import, still exactly 5 account rows
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();
  await page.goto("/investments");
  await expect(page.locator("main ul li")).toHaveCount(5); // scoped: the nav's <li> items live outside <main>

  await context.close();
});
