import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD, E2E_USERS } from "../support/e2e-users.mjs";
import { DEFAULT_PACKAGES } from "../../src/lib/domain/billing/recharge-config.js";
import { epaySign } from "../../src/lib/domain/billing/epay.js";

const database = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
const headers = () => ({ "Idempotency-Key": randomUUID() });
async function signIn(page, email, destination = "/en") {
  await page.goto(`/en/login?callbackUrl=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
}

test("real session persists on refresh and navigation; revoked sessions stay on login", async ({ page, context }, info) => {
  const db = database();
  const email = `session-${info.project.name}-${randomUUID()}@modelshot.test`;
  try {
    const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date(), credits: 321 } });
    await signIn(page, email);
    const response = await page.request.get("/api/auth/session");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).user.email).toBe(email);
    const cookie = (await context.cookies()).find(c => c.name.endsWith("session-token"));
    expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400);
    await page.reload();
    await expect(page.locator(".cr-recharge-trigger")).toHaveText("321");
    await page.getByRole("navigation", { name: "Creative navigation" }).getByRole("link", { name: "Explore", exact: true }).click();
    await expect(page.locator(".cr-recharge-trigger")).toHaveText("321");
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await (await page.request.get("/api/auth/session")).json()).toBeNull();
    await page.goto("/en/login");
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/en\/login$/);
    // A fresh login must work with the same browser storage after revocation.
    await signIn(page, email);
    expect((await (await page.request.get("/api/auth/session")).json()).user.email).toBe(email);
  } finally { await db.$disconnect(); }
});

test("root configures recharge and Google; signed HTTP callback fulfills a CNY order once", async ({ page, browser, baseURL }, info) => {
  const db = database();
  let customer;
  const key = "isolated-epay-fixture-key";
  const reason = "verify dynamic recharge configuration";
  try {
    const email = `billing-${info.project.name}-${randomUUID()}@modelshot.test`;
    await db.user.create({ data: { email, role: "root", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } });
    await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined }));
    await signIn(page, email, "/en/admin/billing");
    await expect(page.getByRole("heading", { name: "充值与支付", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "添加套餐", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "中文名称", exact: true }).last()).toHaveValue("新套餐");
    const config = { payments_enabled: "true", epay_enabled: "true", epay_gateway: "https://gateway.example.invalid", epay_merchant_id: "fixture-pid", epay_merchant_key: key, epay_methods: ["alipay", "wxpay"], payment_public_url: baseURL };
    const saved = await page.request.patch("/api/admin/billing", { headers: headers(), data: { config, packages: DEFAULT_PACKAGES, reason } });
    expect(await saved.json()).toMatchObject({ ok: true });
    expect((await db.systemConfig.findUnique({ where: { key: "epay_merchant_key" } })).value).not.toContain(key);
    expect(await (await page.request.get("/api/admin/billing")).text()).not.toContain(key);
    for (const [setting, value] of [["google_client_id", "fixture.apps.googleusercontent.com"], ["google_client_secret", "fixture-google-secret"], ["google_login_enabled", "true"], ["registration_credits", "77"]]) {
      const changed = await page.request.patch("/api/admin/settings", { headers: headers(), data: { key: setting, value, reason } });
      expect(changed.ok()).toBe(true);
    }
    expect(await (await page.request.get("/api/auth/providers")).json()).toHaveProperty("google");
    expect((await page.request.patch("/api/admin/settings", { headers: headers(), data: { key: "google_login_enabled", value: "false", reason } })).ok()).toBe(true);
    expect(await (await page.request.get("/api/auth/providers")).json()).not.toHaveProperty("google");
    const zh = await (await page.request.get("/api/catalog?locale=zh")).json();
    const en = await (await page.request.get("/api/catalog?locale=en")).json();
    expect(zh.products[0]).toMatchObject({ currency: "cny", amountMinor: 1990 });
    expect(en.products[0]).toMatchObject({ currency: "usd", amountMinor: 500 });
    expect(en.methods.some(m => m.provider === "epay")).toBe(false);

    customer = await browser.newPage({ baseURL });
    await signIn(customer, E2E_USERS[0].email);
    expect((await customer.request.patch("/api/admin/billing", { headers: headers(), data: { config, packages: DEFAULT_PACKAGES, reason } })).status()).toBe(403);
    const before = (await (await customer.request.get("/api/auth/session")).json()).user.credits;
    const input = { planId: "basic", locale: "zh", method: "alipay", expectedAmountMinor: 1990, expectedCredits: 1000 };
    const checkoutHeaders = headers();
    const checkout = await customer.request.post("/api/checkout", { headers: checkoutHeaders, data: input });
    expect(checkout.ok()).toBe(true);
    const purchase = await checkout.json();
    expect(purchase).toMatchObject({ provider: "epay", url: "https://gateway.example.invalid/submit.php" });
    const repeated = await (await customer.request.post("/api/checkout", { headers: checkoutHeaders, data: input })).json();
    expect(repeated.orderId).toBe(purchase.orderId);
    expect((await page.request.get(`/api/recharge/status?orderId=${purchase.orderId}`)).status()).toBe(404);
    const params = { pid: "fixture-pid", type: "alipay", out_trade_no: purchase.orderId, trade_no: randomUUID(), money: "19.90", trade_status: "TRADE_SUCCESS", sign_type: "MD5" };
    expect(await (await customer.request.get("/api/payment/epay/callback", { params: { ...params, sign: "0".repeat(32) } })).text()).toBe("fail");
    params.sign = epaySign(params, key);
    for (let i = 0; i < 2; i++) expect(await (await customer.request.get("/api/payment/epay/callback", { params })).text()).toBe("success");
    expect(await (await customer.request.get(`/api/recharge/status?orderId=${purchase.orderId}`)).json()).toMatchObject({ status: "paid", credits: 1000, currency: "cny" });
    expect((await (await customer.request.get("/api/auth/session")).json()).user.credits).toBe(before + 1000);
    expect(await db.creditTransaction.count({ where: { businessKey: `purchase:${purchase.orderId}` } })).toBe(1);
  } finally { await customer?.close(); await db.$disconnect(); }
});
