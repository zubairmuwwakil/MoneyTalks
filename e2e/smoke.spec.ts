import { expect, test } from "@playwright/test";

test("unauthenticated visit to / redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("textbox", { name: /email address or username/i }),
  ).toBeVisible();
});

test("module pages are protected", async ({ page }) => {
  for (const path of ["/investments", "/bills", "/cards", "/money-finder"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("protected APIs return 401 when unauthenticated", async ({ request }) => {
  for (const url of ["/api/me", "/api/accounts", "/api/accounts/some-id"]) {
    const res = await request.get(url);
    expect(res.status()).toBe(401);
  }
});

test("health endpoint is public", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
