import { test, expect } from "@playwright/test";
import { DEFAULT_PACKAGES, localizePackage } from "../../src/lib/domain/billing/recharge-config.js";

async function guest(page, { google = false } = {}) {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: null });
    if (url.pathname === "/api/inspiration") return route.fulfill({ json: { items: [], layout: { mode: "masonry", columns: 4, gap: 16 } } });
    if (url.pathname === "/api/auth/providers") return route.fulfill({ json: { email: { id: "email", type: "credentials" }, ...(google ? { google: { id: "google", type: "oauth" } } : {}) } });
    if (url.pathname === "/api/catalog") return route.fulfill({ json: { products: DEFAULT_PACKAGES.map(p => localizePackage(p, "zh")), methods: [{ id: "alipay", provider: "epay" }], paymentsEnabled: true } });
    if (url.pathname === "/api/studio/capabilities") return route.fulfill({ json: { imageModels: [], tools: [] } });
    return route.fulfill({ json: {} });
  });
}

for (const code of ["RATE_LIMITED", "EMAIL_ADDRESS_RATE_LIMITED", "EMAIL_IP_RATE_LIMITED"]) test(`password recovery explains ${code} and respects the server retry time`, async ({ page }) => {
  await guest(page);
  const requests = [];
  await page.route("**/api/auth/email/send-code", route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 429, headers: { "Retry-After": "125" }, json: { code, error: code, retryable: true, retryAfter: 125 } });
  });
  await page.goto("/zh/login");
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await dialog.getByRole("button", { name: "忘记密码" }).click();
  await dialog.getByLabel("邮箱", { exact: true }).fill("recovery@example.invalid");
  await dialog.getByRole("button", { name: "发送验证码" }).click();
  await expect(dialog.getByRole("alert")).not.toContainText("出错了");
  await expect(dialog.getByRole("alert")).toContainText(code === "EMAIL_ADDRESS_RATE_LIMITED" ? "该邮箱本小时" : code === "EMAIL_IP_RATE_LIMITED" ? "当前网络" : "请求过于频繁");
  await expect(dialog.getByRole("button", { name: /^2:0[0-5]$/ })).toBeDisabled();
  expect(requests).toEqual([{ email: "recovery@example.invalid", purpose: "RESET_PASSWORD" }]);
  // Resending is rate-limited; redeeming a code already delivered remains possible.
  await page.route("**/api/auth/email/reset-password", route => route.fulfill({ json: { ok: true } }));
  await dialog.getByLabel("验证码", { exact: true }).fill("123456");
  await dialog.getByLabel("新密码", { exact: true }).fill("New-password-123");
  await dialog.getByLabel("确认密码", { exact: true }).fill("New-password-123");
  await dialog.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("密码已重置");
});

for (const theme of ["dark", "light"]) test(`login stays over the current creation and preserves its prompt (${theme})`, async ({ page }, info) => {
  await guest(page);
  await page.goto("/zh?source=preview");
  await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
  const prompt = page.getByRole("textbox", { name: "描述你的创意", exact: true });
  await prompt.fill("一张有呼吸感的产品海报");
  await page.screenshot({ path: info.outputPath(`home-brand-${theme}.png`), animations: "disabled" });
  const trigger = page.locator(".cr-top-cta");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await expect(dialog.getByLabel("邮箱", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Google/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/zh\?source=preview$/);
  await expect(dialog.locator("img")).toHaveCount(0);
  expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(440);
  await page.screenshot({ path: info.outputPath(`auth-${theme}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(prompt).toHaveValue("一张有呼吸感的产品海报");
  await expect(trigger).toBeFocused();
  const icon = page.locator(".cr-recharge-trigger svg");
  expect(await icon.evaluate(el => getComputedStyle(el).fill)).not.toBe("none");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath(`home-brand-mobile-${theme}.png`), animations: "disabled" });
});

test("legacy login opens a dismissible modal and keeps invitation registration", async ({ page }) => {
  await guest(page);
  const registrations = [];
  await page.route("**/api/auth/email/register", route => {
    registrations.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { error: "INVALID_CODE" } });
  });
  await page.goto("/zh/login?ref=ABC123&callbackUrl=%2Fzh%2Fprojects");
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/zh\?auth=login&callbackUrl=/);
  await dialog.getByRole("button", { name: "免费注册" }).click();
  await dialog.getByLabel("邮箱", { exact: true }).fill("artist@example.invalid");
  await dialog.getByLabel("验证码", { exact: true }).fill("123456");
  await dialog.getByLabel("密码", { exact: true }).fill("secret12345");
  await dialog.getByLabel("确认密码", { exact: true }).fill("secret12345");
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
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
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
  const login = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await expect(login).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(login).toHaveCount(0);
  await expect(recharge).toBeVisible();
  await expect(recharge.getByRole("button", { name: "登录并充值" })).toBeEnabled();
});

for (const mode of ["register", "reset"]) test(`${mode} requires matching confirmation and clears passwords when switching modes`, async ({ page }, info) => {
  await guest(page);
  const submissions = [];
  await page.route(`**/api/auth/email/${mode === "register" ? "register" : "reset-password"}`, route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { code: "CODE_INVALID" } });
  });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/zh/login");
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await dialog.getByRole("button", { name: mode === "register" ? "免费注册" : "忘记密码" }).click();
  await dialog.getByLabel("邮箱", { exact: true }).fill("artist@example.invalid");
  await dialog.getByLabel("验证码", { exact: true }).fill("123456");
  await dialog.getByLabel(mode === "register" ? "密码" : "新密码", { exact: true }).fill("Password-one-123");
  const confirmation = dialog.getByLabel("确认密码", { exact: true });
  await dialog.locator("button[type=submit]").click();
  expect(submissions).toHaveLength(0);
  await confirmation.fill("Password-two-123");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog.getByRole("alert")).toHaveText("两次输入的密码不一致，请重新确认。");
  expect(submissions).toHaveLength(0);
  await confirmation.fill("Password-one-123");
  await dialog.getByRole("button", { name: "显示确认密码" }).click();
  await expect(confirmation).toHaveAttribute("type", "text");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog.getByRole("alert")).toHaveText("验证码错误");
  expect(submissions).toEqual([{ email: "artist@example.invalid", password: "Password-one-123", confirmPassword: "Password-one-123", code: "123456" }]);
  await expect(dialog.getByRole("button", { name: "关闭登录" })).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`${mode}-confirmation-mobile.png`) });
  await dialog.getByRole("button", { name: "返回登录" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByLabel("密码", { exact: true })).toHaveValue("");
});

test("registration shows an existing email error without starting the send countdown", async ({ page }) => {
  await guest(page);
  await page.route("**/api/auth/email/send-code", route => route.fulfill({ status: 400, json: { code: "EMAIL_ALREADY_REGISTERED" } }));
  await page.goto("/zh/login");
  const dialog = page.getByRole("dialog", { name: "登录来塔绘梦" });
  await dialog.getByRole("button", { name: "免费注册" }).click();
  await dialog.getByLabel("邮箱", { exact: true }).fill("existing@example.invalid");
  await dialog.getByRole("button", { name: "发送验证码" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("该邮箱已注册，请直接登录");
  await expect(dialog.getByRole("button", { name: "发送验证码" })).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveCount(0);
});
