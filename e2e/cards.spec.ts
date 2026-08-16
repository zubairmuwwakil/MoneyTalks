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

test("cards end to end", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  await page.goto("/investments/import");
  await page.locator('input[name="file"]').setInputFiles(path.join(__dirname, "fixtures", "cards-sample.json"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/3 cards/)).toBeVisible();

  await page.goto("/cards");
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Alpha Amex");
  await expect(page.getByTestId("picker-answer")).toContainText("4.8%");
  await page.getByLabel("Amex accepted here").uncheck();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Beta Visa");

  await page.getByLabel("Amex accepted here").check();
  await page.getByPlaceholder(/Merchant search/).fill("costco");
  await page.getByRole("button", { name: /Costco \(in-store\)/ }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Gamma MC");

  await page.goto("/cards/cheatsheet");
  await expect(page.getByText("Dining & delivery")).toBeVisible();
  await expect(page.getByText("Fixture Alpha Amex").first()).toBeVisible();

  await page.goto("/cards/manage");
  await expect(page.getByText("DOWNGRADE").first()).toBeVisible();

  await page.getByRole("link", { name: "Add card" }).click();
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
  await expect(page.getByRole("heading", { name: "Fixture Form Visa" })).toBeVisible();
  await expect(page.getByText("Fixture dining credit")).toBeVisible();
  const walletConditions = page.getByRole("heading", { name: "Wallet conditions" }).locator("..");
  await expect(walletConditions.getByText("Fixture account condition")).toBeVisible();
  await expect(page.getByText(/effective fee \$0\.00\/yr/)).toBeVisible();

  await page.goto("/cards");
  await page.getByPlaceholder(/Merchant search/).fill("Fixture Merchant");
  await page.getByRole("button", { name: /Fixture Merchant.*your merchant bonus/ }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Form Visa");
  await expect(page.getByTestId("picker-answer")).toContainText("4.0%");

  await page.goto("/cards/manage");
  await page.getByText("Fixture Form Visa").click();
  await page.getByRole("button", { name: "turn off" }).click();
  await expect(page.getByText("(off)")).toBeVisible();

  await page.getByRole("link", { name: "Edit card" }).click();
  await page.locator('input[name="annualFee"]').fill("99.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/fee \$99\.00\/yr/)).toBeVisible();

  await page.goto("/cards/new");
  await page.locator('input[name="nickname"]').fill("Fixture Form Visa");
  await page.locator('input[name="issuer"]').fill("Fixture Credit Union");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("You already have a card with this nickname.")).toBeVisible();

  await page.goto("/cards/manage");
  await page.getByText("Fixture Form Visa").click();
  await page.getByRole("button", { name: "Delete card" }).click();
  await expect(page.getByRole("heading", { name: "Manage cards" })).toBeVisible();
  await expect(page.getByText("Fixture Form Visa")).not.toBeVisible();

  await page.goto("/cards/manage");
  await page.getByText("Fixture Alpha Amex").click();
  await page.getByRole("button", { name: "mark redeemed" }).click();
  await page.locator('input[name="rewardsEstimate"]').fill("60.00");
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("KEEP")).toBeVisible();

  await page.locator('input[name="amount"]').fill("1500.00");
  await page.getByRole("button", { name: "add", exact: true }).click();
  await page.goto("/cards");
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(page.getByTestId("picker-answer")).toContainText("Fixture Beta Visa");

  await context.close();
});
