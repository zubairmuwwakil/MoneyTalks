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
    page.getByRole("button", { name }).click(),
  ]);
}

test("rules engine end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  // Seed accounts via the Phase 1 fixture (5 fictional accounts incl. RRSP with XEQT.TO and an RDSP)
  await page.goto("/investments/import");
  await page
    .locator('input[name="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "import-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Imported: 5 accounts/)).toBeVisible();

  // Configure the profile: LOW tier, 1 carry-forward year, JM citizen who contributed to NHT
  await page.goto("/settings");
  await page.locator('input[name="citizenships"]').fill("US, CA, JM");
  await page.locator('select[name="rdspIncomeTier"]').selectOption("LOW");
  await page.locator('input[name="rdspCarryForwardYears"]').fill("1");
  await page.locator('input[name="nhtContributed"]').check();
  await submit(page, "Save profile", "/settings");

  // Money Finder: no PFIC yet (XEQT.TO sits in the RRSP — exempt)
  await page.goto("/money-finder");
  await expect(page.getByText(/CDSG/).first()).toBeVisible();
  await expect(page.getByText("$7,000.00", { exact: false }).first()).toBeVisible(); // acceptance case
  await expect(page.getByText(/FBAR/).first()).toBeVisible();
  await expect(page.getByText(/PFIC risk/)).toHaveCount(0);

  // Add a Canadian-listed fund to the TFSA → CRITICAL PFIC appears
  await page.goto("/investments");
  await page.getByText("Maple TFSA").click();
  await page.locator('input[name="symbol"]').fill("FAKE.TO");
  await page.locator('form:has(input[name="symbol"]) input[name="name"]').fill("Fictional Canadian ETF");
  await page.locator('input[name="domicileCountry"]').fill("CA");
  await page.locator('input[name="quantity"]').fill("10");
  await page.locator('input[name="lastPriceMinor"]').fill("1000");
  await page.locator('input[name="priceAsOf"]').fill("2026-08-01");
  await page.getByRole("button", { name: /Add \/ update holding/ }).click();

  await page.goto("/money-finder");
  await expect(page.getByText(/PFIC risk: FAKE.TO/)).toBeVisible();

  // Dismiss the NHT alert; it moves to the dismissed view and can be restored
  const nhtCard = page.getByTestId("alert-card").filter({ hasText: "NHT contribution refund" });
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/money-finder")),
    nhtCard.getByRole("button", { name: "dismiss" }).click(),
  ]);
  await page.goto("/money-finder");
  await expect(page.getByText("NHT contribution refund")).toHaveCount(0);
  await page.goto("/money-finder?dismissed=1");
  await expect(page.getByText("NHT contribution refund")).toBeVisible();

  await context.close();
});
