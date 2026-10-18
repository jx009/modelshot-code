import { test, expect } from "@playwright/test";
import { DEFAULT_PACKAGES, localizePackage } from "../../src/lib/domain/billing/recharge-config.js";

async function guest(page, { google = false } = {}) {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: null });
    if (url.pathname === "/api/auth/providers") return route.fulfill({ json: { email: { id: "email", type: "credentials" }, ...(google ? { google: { id: "google", type: "oauth" } } : {}) } });
    if (url.pathname === "/api/catalog") return route.fulfill({ json: { products: DEFAULT_PACKAGES.map(p => localizePackage(p, "zh")), methods: [{ id: "alipay", provider: "epay" }], paymentsEnabled: true } });
    if (url.pathname === "/api/studio/capabilities") return route.fulfill({ json: { imageModels: [], tools: [] } });
    return route.fulfill({ json: {} });
  });
}

for (const theme of ["dark", "light"]) test(`login stays over the current creation and preserves its prompt (${theme})`, async ({ page }, info) => {
  await guest(page);
  await page.goto("/zh?source=preview");
  await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
  const prompt = page.getByRole("textbox", { name: "描述你的创意", exact: true });
  await prompt.fill("一张有呼吸感的产品海报");
  const trigger = page.locator(".cr-top-cta");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "登录来塔AI" });
  await expect(dialog.getByLabel("邮箱", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Google/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/zh\?source=preview$/);
  await expect.poll(() => dialog.locator("img").evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath(`auth-${theme}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(prompt).toHaveValue("一张有呼吸感的产品海报");
  await expect(trigger).toBeFocused();
  const icon = page.locator(".cr-recharge-trigger svg");
  expect(await icon.evaluate(el => getComputedStyle(el).fill)).not.toBe("none");
});

test("legacy login opens a dismissible modal and keeps invitation registration", async ({ page }) => {
  await guest(page);
  const registrations = [];
  await page.route("**/api/auth/email/register", route => {
    registrations.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: "INVALID_CODE" } });
  });
  await page.goto("/zh/login?ref=ABC123&callbackUrl=%2Fzh%2Fprojects");
  const dialog = page.getByRole("dialog", { name: "登录来塔AI" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/zh\?auth=login&callbackUrl=/);
  await dialog.getByRole("button", { name: "免费注册" }).click();
  await dialog.getByLabel("邮箱", { exact: true }).fill("artist@example.invalid");
  await dialog.getByLabel("验证码", { exact: true }).fill("123456");
  await dialog.getByLabel("密码", { exact: true }).fill("secret12345");
  await dialog.locator("button[type=submit]").click();
  await expect.poll(() => registrations.length).toBe(1);
  expect(registrations[0].refCode).toBe("ABC123");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "关闭登录" }).click();
  await expect(page).toHaveURL(/\/zh$/);
  await expect(page.getByRole("textbox", { name: "描述你的创意", exact: true })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 700 }, { width: 1024, height: 420 }]) test(`registration keeps close visible in ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
  await page.setViewportSize(viewport);
  await guest(page, { google: true });
  await page.goto("/zh/login");
  const dialog = page.getByRole("dialog", { name: "登录来塔AI" });
  await dialog.getByRole("button", { name: "免费注册" }).click();
  await expect(dialog.getByRole("button", { name: /Google/ })).toBeVisible();
  await dialog.locator("header + div").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(dialog.getByRole("button", { name: "关闭登录" })).toBeInViewport({ ratio: 1 });
  const rect = await dialog.boundingBox();
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: info.outputPath("auth-compact.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "关闭登录" }).click();
  await expect(dialog).toHaveCount(0);
});

test("guest recharge opens login above the recharge selection", async ({ page }) => {
  await guest(page);
  await page.goto("/zh");
  await page.locator(".cr-recharge-trigger").click();
  const recharge = page.getByRole("dialog", { name: "积分充值" });
  await recharge.getByRole("button", { name: "登录并充值" }).click();
  const login = page.getByRole("dialog", { name: "登录来塔AI" });
  await expect(login).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(login).toHaveCount(0);
  await expect(recharge).toBeVisible();
  await expect(recharge.getByRole("button", { name: "登录并充值" })).toBeEnabled();
});
