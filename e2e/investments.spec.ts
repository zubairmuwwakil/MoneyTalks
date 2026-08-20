import { expect, test } from "@playwright/test";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { cleanupE2EUser, createAuthedContext, E2E_EMAIL } from "./helpers/session";

test.describe.configure({ mode: "serial" });

function utcDayOffset(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

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

test("shows cash-flow-adjusted performance and honest tracking states", async ({ browser, baseURL }) => {
  const context = await createAuthedContext(browser, baseURL!);
  const page = await context.newPage();
  await page.goto("/investments");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: E2E_EMAIL } });
  const twoDaysAgo = utcDayOffset(-2);
  const previousDay = utcDayOffset(-1);
  const today = utcDayOffset(0);

  const performanceAccount = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      type: "RRSP",
      name: "Performance RRSP",
      institution: "Fictional Performance Brokerage",
      country: "CA",
      currency: "CAD",
      snapshots: { create: { balanceMinor: 0, currency: "CAD", asOf: today } },
    },
  });
  const emptyAccount = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      type: "TFSA",
      name: "Needs Setup TFSA",
      institution: "Fictional Empty Brokerage",
      country: "CA",
      currency: "CAD",
    },
  });
  const zeroAccount = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      type: "CASH",
      name: "Measured Zero Cash",
      institution: "Fictional Cash Bank",
      country: "CA",
      currency: "CAD",
      snapshots: {
        create: { balanceMinor: 0, currency: "CAD", asOf: today },
      },
    },
  });
  const pendingCashAccount = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      type: "CASH",
      name: "Pending Cash",
      institution: "Fictional Cash Bank",
      country: "CA",
      currency: "CAD",
      snapshots: {
        create: { balanceMinor: 2_500, currency: "CAD", asOf: today },
      },
    },
  });

  const baseSnapshot = {
    accountId: performanceAccount.id,
    currency: "CAD",
    cashMinor: 0,
    displayCurrency: "CAD",
    fxRateToDisplay: null,
    fxAsOf: null,
    holdingCount: 2,
    pricedHoldingCount: 2,
    earliestPriceAsOf: twoDaysAgo,
    latestPriceAsOf: today,
  } as const;
  await prisma.investmentAccountSnapshot.create({
    data: {
      ...baseSnapshot,
      asOf: twoDaysAgo,
      holdingsMinor: 10_000,
      totalMinor: 10_000,
      netExternalFlowMinor: 0,
      displayTotalMinor: 10_000,
      displayExternalFlowMinor: 0,
      status: "COMPLETE",
      positions: {
        create: [
          {
            symbol: "AAPL",
            name: "Apple",
            quantity: 2,
            priceMinor: 5_000,
            priceCurrency: "CAD",
            priceAsOf: twoDaysAgo,
            priceSource: "TEST",
            priceStatus: "FRESH",
            marketValueMinor: 10_000,
            displayMarketValueMinor: 10_000,
            valuationComplete: true,
          },
          {
            symbol: "SHOP",
            name: "Shopify",
            quantity: 1,
            priceMinor: 0,
            priceCurrency: "CAD",
            priceAsOf: twoDaysAgo,
            priceSource: "TEST",
            priceStatus: "FRESH",
            marketValueMinor: 0,
            displayMarketValueMinor: 0,
            valuationComplete: true,
          },
        ],
      },
    },
  });
  await prisma.investmentAccountSnapshot.create({
    data: {
      ...baseSnapshot,
      asOf: previousDay,
      holdingsMinor: 11_500,
      totalMinor: 11_500,
      netExternalFlowMinor: 1_000,
      displayTotalMinor: 11_500,
      displayExternalFlowMinor: 1_000,
      status: "COMPLETE",
      positions: {
        create: [
          {
            symbol: "AAPL",
            name: "Apple",
            quantity: 2,
            priceMinor: 5_250,
            priceCurrency: "CAD",
            priceAsOf: previousDay,
            priceSource: "TEST",
            priceStatus: "FRESH",
            marketValueMinor: 10_500,
            displayMarketValueMinor: 10_500,
            valuationComplete: true,
          },
          {
            symbol: "SHOP",
            name: "Shopify",
            quantity: 2,
            priceMinor: 500,
            priceCurrency: "CAD",
            priceAsOf: previousDay,
            priceSource: "TEST",
            priceStatus: "FRESH",
            marketValueMinor: 1_000,
            displayMarketValueMinor: 1_000,
            valuationComplete: true,
          },
        ],
      },
    },
  });
  await prisma.investmentAccountSnapshot.create({
    data: {
      ...baseSnapshot,
      asOf: today,
      holdingsMinor: 20_000,
      totalMinor: 20_000,
      netExternalFlowMinor: 0,
      displayTotalMinor: 20_000,
      displayExternalFlowMinor: 0,
      status: "PARTIAL",
      pricedHoldingCount: 1,
    },
  });
  await prisma.investmentAccountSnapshot.create({
    data: {
      accountId: zeroAccount.id,
      asOf: today,
      currency: "CAD",
      cashMinor: 0,
      holdingsMinor: 0,
      totalMinor: 0,
      netExternalFlowMinor: 0,
      displayCurrency: "CAD",
      displayTotalMinor: 0,
      displayExternalFlowMinor: 0,
      status: "COMPLETE",
      holdingCount: 0,
      pricedHoldingCount: 0,
    },
  });

  try {
    await page.reload();
    await expect(page.getByText("$115.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("+$5.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("+5.0%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("+$10.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Time-weighted return removes deposits and withdrawals/)).toBeVisible();
    await expect(page.getByText(/Data incomplete:/)).toContainText("Performance RRSP");
    await expect(page.getByText("Position changed", { exact: true })).toBeVisible();
    await expect(page.getByText("Needs setup", { exact: true })).toBeVisible();
    await expect(page.getByText("$0.00", { exact: true })).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Performance RRSP/ })).toContainText(
      "$0.00 cash · $115.00 holdings",
    );
    await expect(page.getByRole("link", { name: /Pending Cash/ })).toContainText(
      "$25.00 cash · $0.00 holdings",
    );
    await page.getByText("View performance data", { exact: true }).click();
    await expect(page.getByRole("cell", { name: "Contribution +$10.00" })).toBeVisible();

    const allRange = page.getByRole("button", { name: "All", exact: true });
    await allRange.focus();
    await page.keyboard.press("Enter");
    await expect(allRange).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Scope").selectOption(performanceAccount.id);
    await expect(page.getByText("Performance RRSP value", { exact: true })).toBeVisible();
  } finally {
    await prisma.financialAccount.deleteMany({
      where: {
        id: { in: [performanceAccount.id, emptyAccount.id, zeroAccount.id, pendingCashAccount.id] },
      },
    });
    await context.close();
  }
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
  // Server actions POST to the current page URL and re-render on completion;
  // wait for that response instead of racing the UI update with a fixed timeout.
  const accountPath = new URL(page.url()).pathname;
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(accountPath)),
    transactionSection.getByRole("button", { name: "Add transaction" }).click(),
  ]);
  await expect(page.getByText(/CONTRIBUTION\s*2026-08-10/)).toBeVisible();
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
  await expect(page.getByText(/DIVIDEND\s*2026-08-10/)).toBeVisible();
  await page.getByRole("button", { name: "Delete dividend transaction" }).click();
  await expect(page.getByText(/DIVIDEND\s*2026-08-10/)).toHaveCount(0);

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
