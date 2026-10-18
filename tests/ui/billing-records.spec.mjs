import { test, expect } from "@playwright/test";
import { DEFAULT_PACKAGES, localizePackage } from "../../src/lib/domain/billing/recharge-config.js";

async function fixtures(page, { failed = false } = {}) {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const data = {
      "/api/auth/session": { user: { id: "record-user", email: "records@example.invalid", credits: 2782 }, expires: "2099-01-01T00:00:00Z" },
      "/api/catalog": { products: DEFAULT_PACKAGES.map(p => localizePackage(p, url.searchParams.get("locale"))), methods: [{ id: "alipay", provider: "epay" }], paymentsEnabled: true },
      "/api/studio/documents": [],
      "/api/studio/capabilities": { imageModels: [], tools: [] },
      "/api/inspiration": { items: [], layout: { mode: "masonry", columns: 4, gap: 16 } },
    };
    if (url.pathname === "/api/account") {
      if (failed) return route.fulfill({ status: 503, json: { error: "SERVICE_UNAVAILABLE" } });
      const page = Number(url.searchParams.get("page") || 1);
      return route.fulfill({ json: {
        usage: { credits: 2782, reservedCredits: 0 },
        orders: [
          { id: "private-order-id", createdAt: "2026-10-19T02:56:35Z", planId: "pack_should_never_be_shown", amountMinor: 4900, currency: "cny", status: "paid", creditedCredits: 3000 },
          { id: "pending-order", createdAt: "2026-10-18T08:01:00Z", amountMinor: 1990, currency: "cny", status: "pending", creditedCredits: 0 },
        ],
        transactions: page === 2 ? [{ id: "last", createdAt: "2026-10-18T08:00:00Z", type: "registration_bonus", channel: "credits", amount: 125 }] : [
          ...["generate", "inpaint", "expand", "ocr", "upscale", "studio-optimize"].map((operation, index) => ({ id: `tool-${index}`, createdAt: "2026-10-19T03:00:00Z", type: "consume", channel: "credits", amount: -18, operation, resolution: "2K", reason: "capture" })),
          { id: "zero", createdAt: "2026-10-19T02:00:00Z", type: "release", channel: "credits", amount: 0, reason: "release" },
        ],
        pagination: { orders: { hasMore: false }, usage: { hasMore: page === 1 } },
      } });
    }
    return route.fulfill({ json: data[url.pathname] || {} });
  });
}

for (const [name, viewport] of [["desktop", { width: 1360, height: 900 }], ["mobile", { width: 390, height: 700 }]]) {
  test(`recharge amount hierarchy and exclusive record dialogs (${name})`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await fixtures(page);
    await page.goto("/zh");
    const entry = page.locator(".cr-recharge-trigger");
    await entry.click();
    const recharge = page.getByRole("dialog", { name: "积分充值", exact: true });
    await expect(recharge.getByRole("button", { name: "立即充值" })).toBeEnabled();
    const pack = recharge.getByRole("button", { name: /1,000 积分/ });
    const price = await pack.locator("h2").boundingBox(), credits = await pack.locator("strong").boundingBox();
    expect(price.y + price.height).toBeLessThan(credits.y);
    await expect(pack.locator("h2")).toHaveText("¥19.90");
    await page.screenshot({ path: info.outputPath(`${name}-packs.png`), animations: "disabled" });
    await recharge.getByRole("button", { name: "充值记录", exact: true }).click();
    const records = page.getByRole("dialog", { name: "积分记录", exact: true });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(recharge).toHaveCount(0);
    await expect(page).toHaveURL(/\/zh$/);
    await expect(records.getByRole("columnheader")).toHaveText(["时间", "充值金额", "到账积分", "状态"]);
    await expect(records.getByRole("cell", { name: "3,000", exact: true })).toBeVisible();
    await expect(records.getByRole("row").filter({ hasText: "待支付" })).toContainText("—");
    await expect(records).not.toContainText("pack_should_never_be_shown");
    await expect(records).not.toContainText("private-order-id");
    await expect(records).not.toContainText("使用指南");
    await expect(records).not.toContainText("账户管理");
    expect(await records.locator(".ma-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}-orders.png`), animations: "disabled" });
    await records.getByRole("button", { name: "使用记录", exact: true }).click();
    for (const label of ["生图", "局部修改", "AI 扩图", "文字识别", "AI 超清放大", "提示词优化"]) await expect(records.getByRole("cell", { name: label, exact: true })).toBeVisible();
    expect(await records.locator(".ma-scroll").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(records.locator(".ma-balance svg")).toBeVisible();
    await expect(records).not.toContainText("解除预留");
    await expect(records.getByRole("cell", { name: /^0/ })).toHaveCount(0);
    await records.getByRole("button", { name: "下一页" }).click();
    await expect(records.getByRole("cell", { name: "注册赠送", exact: true })).toBeVisible();
    await expect(records.getByRole("button", { name: "下一页" })).toBeDisabled();
    await records.getByRole("button", { name: "上一页" }).click();
    await expect(records.getByRole("cell", { name: "局部修改", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${name}-usage.png`), animations: "disabled" });
    await records.getByRole("button", { name: "充值积分", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(recharge).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}

test("avatar entries open dialogs and contain no retired links or help", async ({ page }) => {
  await fixtures(page);
  await page.goto("/zh");
  const avatar = page.getByRole("button", { name: "records@example.invalid" });
  await avatar.click();
  const menu = page.getByRole("menu");
  await expect(menu).not.toContainText("使用指南");
  await expect(menu).not.toContainText("账户与账单");
  await menu.getByRole("menuitem", { name: "购买记录" }).click();
  const records = page.getByRole("dialog", { name: "积分记录" });
  await expect(records.getByRole("button", { name: "购买记录", exact: true })).toHaveAttribute("aria-pressed", "true");
  await records.getByRole("button", { name: "关闭积分记录" }).click();
  await expect(avatar).toBeFocused();
  await avatar.click();
  await page.getByRole("menuitem", { name: "使用记录" }).click();
  await expect(records.getByRole("button", { name: "使用记录", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('a[href$="/account"]')).toHaveCount(0);
});

test("old account bookmarks redirect to the new dialog, never the old dashboard", async ({ page }) => {
  await fixtures(page);
  await page.goto("/zh/account?checkout=success");
  await expect(page).toHaveURL(/\/zh\?records=orders$/);
  const records = page.getByRole("dialog", { name: "积分记录" });
  await expect(records.getByRole("cell", { name: "3,000", exact: true })).toBeVisible();
  await expect(page.locator(".account-page")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/zh$/);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/en/account?tab=usage");
  await expect(page.getByRole("dialog", { name: "Credit history" }).getByRole("cell", { name: "Recognize text" })).toBeVisible();
});

test("record failures show a retry state instead of fake empty or stale entries", async ({ page }) => {
  await fixtures(page, { failed: true });
  await page.goto("/zh?records=orders");
  const records = page.getByRole("dialog", { name: "积分记录" });
  await expect(records.getByRole("alert")).toContainText("记录加载失败");
  await expect(records.getByRole("button", { name: "重新加载" })).toBeVisible();
  await expect(records.getByRole("cell")).toHaveCount(0);
});

test("light theme records retain readable status and close controls", async ({ page }, info) => {
  await fixtures(page);
  await page.goto("/zh?records=orders");
  const records = page.getByRole("dialog", { name: "积分记录" });
  await expect(records.getByRole("cell", { name: "3,000", exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.screenshot({ path: info.outputPath("orders-light.png"), animations: "disabled" });
  await expect(records.getByRole("button", { name: "关闭积分记录" })).toBeInViewport({ ratio: 1 });
});

test("guest records offer the login modal and keep only one dialog open", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/auth/session", route => route.fulfill({ json: null }));
  await page.goto("/zh/account");
  const records = page.getByRole("dialog", { name: "积分记录" });
  await expect(records.getByText("登录后查看你的积分记录")).toBeVisible();
  await records.getByRole("button", { name: "登录", exact: true }).click();
  await expect(records).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
});
