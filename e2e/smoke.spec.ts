import { expect, test } from "@playwright/test";

test("unauthenticated visit to / redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("button", { name: /send sign-in link/i }),
  ).toBeVisible();
});

test("module pages are protected", async ({ page }) => {
  for (const path of ["/investments", "/bills", "/cards", "/money-finder"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("protected API returns 401 when unauthenticated", async ({ request }) => {
  const res = await request.get("/api/me");
  expect(res.status()).toBe(401);
});

test("health endpoint is public", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
