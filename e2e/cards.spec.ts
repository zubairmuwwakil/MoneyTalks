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
