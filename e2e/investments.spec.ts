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

  // All mode lets the user choose the display currency for the aggregate total.
  await page.getByRole("navigation", { name: "Net worth currency mode" }).getByRole("link", { name: "All" }).click();
  await expect(page.getByText("Net worth (all currencies, USD)")).toBeVisible();
  await page
    .getByRole("navigation", { name: "All-currency display currency" })
    .getByRole("link", { name: "USD" })
    .click();
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

  // A late currency conflict rolls back earlier writes from the same import.
  await page.goto("/investments/import");
  await page.locator('input[name="file"]').setInputFiles({
    name: "fictional-currency-conflict.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      accounts: [
        {
          type: "CASH",
          name: "Atomic rollback account",
          institution: "Fictional Test Bank",
          country: "CA",
          currency: "CAD",
        },
        {
          type: "RRSP",
          name: "Maple RRSP",
          institution: "Maple Invest",
          country: "CA",
          currency: "USD",
        },
      ],
    })),
  });
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Currency for Maple RRSP cannot change from CAD to USD/)).toBeVisible();
  await page.goto("/investments");
  await expect(page.getByText("Atomic rollback account")).toHaveCount(0);

  await context.close();
});

test("edit account and delete holding, transaction, snapshot, and account", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();

  await page.goto("/investments");
  await page.getByRole("link", { name: /Maple TFSA/ }).click();

  const accountSection = page.getByRole("heading", { name: "Account details" }).locator("..");
  await accountSection.locator('input[name="name"]').fill("Maple TFSA Updated");
  await accountSection.getByRole("button", { name: "Save account" }).click();
  await expect(page.getByRole("heading", { name: "Maple TFSA Updated" })).toBeVisible();

  await expect(accountSection.locator('input[name="currency"]')).toHaveAttribute("readonly", "");
  await accountSection.locator('input[name="currency"]').evaluate((input) => {
    (input as HTMLInputElement).value = "USD";
  });
  await accountSection.getByRole("button", { name: "Save account" }).click();
  await expect(accountSection.getByRole("alert")).toContainText("Currency cannot be changed after account creation");

  const holdingSection = page.getByRole("heading", { name: "Holdings" }).locator("..");
  await holdingSection.locator('input[name="symbol"]').fill("TEST");
  await holdingSection.locator('input[name="name"]').fill("Fictional test holding");
  await holdingSection.locator('input[name="domicileCountry"]').fill("CA");
  await holdingSection.locator('input[name="quantity"]').fill("2");
  await holdingSection.locator('input[name="lastPrice"]').fill("12.50");
  await holdingSection.locator('input[name="priceAsOf"]').fill("2026-08-10");
  await holdingSection.getByRole("button", { name: "Add / update holding" }).click();
  const deleteHoldingButton = page.getByRole("button", { name: "Delete TEST holding" });
  await expect(deleteHoldingButton).toBeVisible();
  await deleteHoldingButton.click();
  await expect(deleteHoldingButton).toHaveCount(0);

  const transactionSection = page.getByRole("heading", { name: "Log a transaction" }).locator("..");
  await transactionSection.locator('select[name="type"]').first().selectOption("CONTRIBUTION");
  await transactionSection.locator('input[name="amount"]').first().fill("10.00");
  await transactionSection.locator('input[name="date"]').first().fill("2026-08-10");
  await transactionSection.locator('input[name="description"]').first().fill("Fictional contribution");
  await transactionSection.locator("form").first().evaluate((form) => {
    const currency = document.createElement("input");
    currency.type = "hidden";
    currency.name = "currency";
    currency.value = "JMD";
    form.append(currency);
  });
  await transactionSection.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText(/2026-08-10 CONTRIBUTION/)).toBeVisible();
  const accountId = new URL(page.url()).pathname.split("/").pop();
  const accountResponse = await page.request.get(`/api/accounts/${accountId}`);
  const accountBody = await accountResponse.json();
  expect(accountBody.transactions).toContainEqual(
    expect.objectContaining({ description: "Fictional contribution", currency: "CAD" }),
  );

  await page.getByText("Edit transaction", { exact: true }).click();
  const editTransaction = page.locator("details form").filter({ has: page.locator('input[name="transactionId"]') });
  await editTransaction.locator('select[name="type"]').selectOption("DIVIDEND");
  await editTransaction.locator('input[name="amount"]').fill("15.00");
  await editTransaction.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText(/2026-08-10 DIVIDEND/)).toBeVisible();
  await page.getByRole("button", { name: "Delete dividend transaction" }).click();
  await expect(page.getByText(/2026-08-10 DIVIDEND/)).toHaveCount(0);

  const snapshotSection = page.getByRole("heading", { name: "Balance snapshots" }).locator("..");
  await snapshotSection.locator('input[name="balance"]').fill("1750.00");
  await snapshotSection.locator('input[name="asOf"]').fill("2026-08-10");
  await snapshotSection.getByRole("button", { name: "Snapshot", exact: true }).click();
  await expect(page.getByText("2026-08-10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete 2026-08-10 snapshot" }).click();
  await expect(page.getByText("2026-08-10", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete account (and all its data)" }).click();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(page.getByText("Maple TFSA Updated")).toHaveCount(0);

  await context.close();
});
