import { test, expect } from "@playwright/test";
import { DEFAULT_PACKAGES, localizePackage } from "../../src/lib/domain/billing/recharge-config.js";

async function fixtures(page, { initialNull = 0, paid = false } = {}) {
  let calls = 0, credits = 500;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") {
      return route.fulfill({ json: ++calls <= initialNull ? null : { user: { id: "recharge-user", email: "recharge@example.invalid", name: "Recharge", credits }, expires: "2099-01-01T00:00:00Z" } });
    }
    if (url.pathname === "/api/catalog") return route.fulfill({ json: { products: DEFAULT_PACKAGES.map(p => localizePackage(p, url.searchParams.get("locale"))), methods: [{ id: "alipay", provider: "epay" }, { id: "wxpay", provider: "epay" }], paymentsEnabled: true } });
    if (url.pathname === "/api/recharge/status") {
      if (paid) credits = 3500;
      return route.fulfill({ json: { id: "fixture-order", status: paid ? "paid" : "pending", amountMinor: 4900, currency: "cny", credits: 3000 } });
    }
    if (url.pathname === "/api/studio/documents") return route.fulfill({ json: [] });
    if (url.pathname === "/api/studio/capabilities") return route.fulfill({ json: { imageModels: [], imageProvider: "", tools: [], planningAvailable: false } });
    if (url.pathname === "/api/auth/providers") return route.fulfill({ json: { email: { id: "email", name: "Email", type: "credentials" } } });
    return route.fulfill({ json: {} });
  });
}

for (const theme of ["dark", "light"]) test(`recharge opens from credits with CNY prices (${theme})`, async ({ page }, info) => {
  await fixtures(page);
  await page.goto("/zh");
  await page.locator(".cr-recharge-trigger").click();
  const dialog = page.getByRole("dialog", { name: "积分充值" });
  await expect(dialog.getByRole("button", { name: "立即充值" })).toBeEnabled();
  await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
  await expect(dialog.getByText("¥49.00", { exact: true })).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: /微信支付/ })).toBeVisible();
  await dialog.getByRole("button", { name: /微信支付/ }).click();
  await expect(dialog.getByRole("button", { name: /微信支付/ })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath(`recharge-${theme}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/zh$/);
});

test("mobile scroll keeps recharge close and payment controls in view", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await fixtures(page);
  await page.goto("/zh");
  await page.locator(".cr-recharge-trigger").click();
  const dialog = page.getByRole("dialog", { name: "积分充值" });
  await expect(dialog.getByRole("button", { name: "立即充值" })).toBeEnabled();
  const content = dialog.locator("header + div");
  await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  for (const control of [dialog.getByRole("button", { name: "关闭充值" }), dialog.getByRole("button", { name: "立即充值" })]) {
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  const rect = await dialog.boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("recharge-mobile.png") });
});

test("transient null session recovers without clearing browser storage", async ({ page }) => {
  await fixtures(page, { initialNull: 2 });
  await page.goto("/zh");
  await expect(page.getByRole("button", { name: /recharge@example.invalid/ })).toBeVisible();
  await expect(page.locator(".cr-recharge-trigger")).toHaveText("500");
  await page.reload();
  await expect(page.locator(".cr-recharge-trigger")).toHaveText("500");
  await page.getByRole("navigation", { name: "创作导航" }).getByRole("link", { name: "灵感发现", exact: true }).click();
  await expect(page.locator(".cr-recharge-trigger")).toHaveText("500");
});

test("only confirmed payment shows success and refreshes the visible balance", async ({ page }) => {
  await fixtures(page, { paid: true });
  await page.addInitScript(() => sessionStorage.setItem("letai:recharge:recharge-user", "fixture-order"));
  await page.goto("/zh");
  await page.locator(".cr-recharge-trigger").click();
  await expect(page.getByRole("status")).toContainText("3,000 积分已到账");
  await expect(page.locator(".cr-recharge-trigger")).toHaveText("3500");
});

test("HTTP pages without randomUUID can start and retry the same checkout", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined }));
  const keys = [];
  await page.route("**/api/checkout", route => {
    keys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 503, json: { error: "CHECKOUT_UNAVAILABLE" } });
  });
  await page.goto("/zh");
  await page.locator(".cr-recharge-trigger").click();
  const dialog = page.getByRole("dialog", { name: "积分充值" });
  await dialog.getByRole("button", { name: "立即充值" }).click();
  await expect(dialog.getByRole("alert")).toContainText("暂未开放充值");
  expect(keys[0]).toMatch(/^[a-f0-9]{32}$/);
  await dialog.getByRole("button", { name: "立即充值" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
});

test("English recharge uses USD and hidden Google does not appear on login", async ({ page }) => {
  await fixtures(page);
  await page.goto("/en/pricing");
  await expect(page.getByText("$15.00", { exact: true })).toHaveCount(1);
  await page.route("**/api/auth/session", route => route.fulfill({ json: null }));
  await page.goto("/en/login");
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Google/i })).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/login$/);
});
