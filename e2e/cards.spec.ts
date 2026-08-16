import { expect, test } from "@playwright/test";
import { cleanupE2EUser, createAuthedContext } from "./helpers/session";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2EUser();
});

test.afterAll(async () => {
  await cleanupE2EUser();
});

test("wallet cards end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  await page.goto("/cards");
  await expect(page.getByText("No cards yet")).toBeVisible();

  await page.getByRole("link", { name: "add your first card" }).click();
  await page.locator('input[name="nickname"]').fill("Fixture Form Visa");
  await page.locator('input[name="issuer"]').fill("Fixture Credit Union");
  await page.locator('input[name="annualFee"]').fill("12.00");
  await page.getByLabel("Base earn rate (points/$)").fill("1");
  await page.getByLabel("Point value (¢)").fill("1");
  await page.getByLabel("Foreign transaction fee (%)").fill("0");

  const conditions = page.getByTestId("conditions-form");
  await conditions.getByRole("button", { name: "Add condition" }).click();
  await conditions.getByLabel("Condition").fill("Fixture account condition");
  await conditions.getByLabel("Annual-fee reduction ($, optional)").fill("12.00");

  const allSpendRates = page.getByTestId("all-spend-rate-form");
  await allSpendRates.getByRole("button", { name: "Add all-spend rate" }).click();
  await allSpendRates.getByLabel("Rule name").fill("Fixture all-spend rate");
  await allSpendRates.getByLabel("Earn rate (points/$)").fill("2");
  await allSpendRates.getByLabel("Spend cap ($, optional)").fill("1000.00");

  const sharedCaps = page.getByTestId("shared-cap-form");
  await sharedCaps.getByRole("button", { name: "Add shared cap" }).click();
  await sharedCaps.getByLabel("Cap name").fill("Fixture food cap");
  await sharedCaps.getByLabel("Spend cap ($)").fill("750.00");

  const categories = page.getByTestId("bonus-category-form");
  await categories.getByRole("button", { name: "Add category" }).click();
  await categories.getByLabel("Category").selectOption("groceries");
  await categories.getByLabel("Earn rate (points/$)").fill("3");
  await categories.getByLabel("Shared cap").selectOption("cap-group-1");
  await categories.getByLabel("Active when").selectOption("condition-1");

  const merchants = page.getByTestId("merchant-bonus-form");
  await merchants.getByRole("button", { name: "Add merchant bonus" }).click();
  await merchants.getByLabel("Merchant").fill("Fixture Merchant");
  await merchants.getByLabel("Earn rate (points/$)").fill("4");
  await merchants.getByLabel("Active when").selectOption("condition-1");

  const credits = page.getByTestId("credit-form");
  await credits.getByRole("button", { name: "Add credit" }).click();
  await credits.getByLabel("Credit name").fill("Fixture dining credit");
  await credits.getByLabel("Value ($)").fill("5.00");
  await credits.getByLabel("Frequency").selectOption("MONTH");
  await page.getByRole("button", { name: "Add card" }).click();

  // Landed on the detail page: card facts, credits, conditions, and the
  // fee-waiver condition's effect on the effective fee all render.
  await expect(page.getByRole("heading", { name: "Fixture Form Visa" })).toBeVisible();
  await expect(page.getByText("Fixture dining credit")).toBeVisible();
  const walletConditions = page.getByRole("heading", { name: "Wallet conditions" }).locator("..");
  await expect(walletConditions.getByText("Fixture account condition")).toBeVisible();
  const allSpendRateSection = page.getByRole("heading", { name: "All-spend conditional rates" }).locator("..");
  await expect(allSpendRateSection.getByText(/Fixture all-spend rate.*2x/)).toBeVisible();
  await expect(page.getByText(/effective fee \$0\.00\/yr/)).toBeVisible();
  await expect(page.getByText(/\(published \$12\.00\)/)).toBeVisible();

  // Wallet list and manage list both show the new card.
  await page.goto("/cards");
  await expect(page.getByRole("link", { name: /Fixture Form Visa/ })).toBeVisible();
  await page.goto("/cards/manage");
  await expect(page.getByRole("link", { name: /Fixture Form Visa/ })).toBeVisible();
  await expect(page.getByText(/fee \$0\.00 - net/)).toBeVisible();

  // Log cap usage against the shared "Fixture food cap" group and see the
  // progress bar update. The card also has an all-spend-rate cap, so scope
  // to this cap's own <li> — each cap renders its own "amount" input.
  await page.getByRole("link", { name: /Fixture Form Visa/ }).click();
  const foodCapEntry = page.locator("li", { hasText: "Fixture food cap" });
  await expect(foodCapEntry).toBeVisible();
  await foodCapEntry.locator('input[name="amount"]').fill("300.00");
  await foodCapEntry.getByRole("button", { name: "add", exact: true }).click();
  await expect(foodCapEntry.getByText("$300.00 / $750.00 (40%)")).toBeVisible();

  // Turning the fee-waiver condition off restores the published fee.
  await page.getByRole("button", { name: "turn off" }).click();
  await expect(walletConditions.getByText("off", { exact: true })).toBeVisible();
  await expect(page.getByText(/effective fee \$12\.00\/yr/)).toBeVisible();

  // Edit updates persist.
  await page.getByRole("link", { name: "Edit card" }).click();
  await page.locator('input[name="annualFee"]').fill("99.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/effective fee \$99\.00\/yr/)).toBeVisible();

  // Nickname collisions are rejected.
  await page.goto("/cards/new");
  await page.locator('input[name="nickname"]').fill("Fixture Form Visa");
  await page.locator('input[name="issuer"]').fill("Fixture Credit Union");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("You already have a card with this nickname.")).toBeVisible();

  // Delete removes it from the wallet.
  await page.goto("/cards/manage");
  await page.getByRole("link", { name: /Fixture Form Visa/ }).click();
  await page.getByRole("button", { name: "Delete card" }).click();
  await expect(page.getByRole("heading", { name: "Manage cards" })).toBeVisible();
  await expect(page.getByText("Fixture Form Visa")).not.toBeVisible();

  await context.close();
});
