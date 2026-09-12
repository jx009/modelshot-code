import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import JSZip from "jszip";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

async function login(page, email) {
  await page.goto("/en/login?callbackUrl=/en/studio");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/studio$/);
  await expect.poll(async () => (await (await page.request.get("/api/auth/session")).json()).user?.email).toBe(email);
}

test("private upload, draft, quote, durable worker, review and ZIP delivery", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `workflow-${info.project.name}@modelshot.test`;
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    await login(page, email);
    const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#df586c" } }).png().toBuffer();
    await page.locator('.asset-panel input[type="file"]').setInputFiles({ name: "garment.png", mimeType: "image/png", buffer: image });
    await expect(page.locator(".asset-list img").first()).toBeVisible();
    if (info.project.name === "mobile") await page.locator('.mobile-workspace-tabs button').nth(1).click();
    await page.locator('.params-panel .mode-switch button').filter({ hasText: "Custom" }).click();
    await page.locator('.custom-model input[type="file"]').setInputFiles({ name: "model.png", mimeType: "image/png", buffer: image });
    await expect(page.locator(".custom-model img")).toBeVisible();
    await page.getByLabel("SKU", { exact: true }).fill("SKU-BROWSER");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel("Open draft", { exact: true }).selectOption({ index: 1 });
    await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("SKU-BROWSER");
    await page.locator(".generate-button").click();
    await expect(page.locator(".workflow-dialog")).toBeVisible();
    const submitted = page.waitForResponse(response => response.url().endsWith("/api/tryon") && response.request().method() === "POST");
    await page.locator(".workflow-dialog .primary").click();
    const result = await (await submitted).json();
    expect(result.tryonId).toBeTruthy();
    await page.reload();
    await expect.poll(async () => (await (await page.request.get(`/api/tryons?id=${result.tryonId}`)).json()).exportStatus, { timeout: 45000 }).toBe("ready");
    await page.goto(`/en/gallery?id=${result.tryonId}`);
    await expect(page.locator(".detail-dialog")).toBeVisible();
    await page.screenshot({ path: info.outputPath("result-detail.png"), fullPage: true });
    const record = await (await page.request.get(`/api/tryons?id=${result.tryonId}`)).json();
    expect(record.qaStatus).toBe("skipped");
    expect((await page.request.patch("/api/tryons", { data: { id: record.id, decision: "approved" } })).ok()).toBeTruthy();
    const created = await page.request.post("/api/exports", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { outputIds: [record.id], mode: "delivery" } });
    expect(created.ok()).toBeTruthy();
    const exportJob = await created.json();
    await expect.poll(async () => (await (await page.request.get(`/api/exports/${exportJob.id}`)).json()).status, { timeout: 45000 }).toBe("succeeded");
    const download = await page.request.get(`/api/exports/${exportJob.id}/download`);
    const zip = await JSZip.loadAsync(await download.body());
    expect(Object.keys(zip.files).some(name => name.endsWith(".png"))).toBeTruthy();
    await page.goto("/en/account");
    await expect(page.locator(".usage-metrics")).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});

test("workspace controls fit six viewport widths in both languages", async ({ page }, info) => {
  if (info.project.name !== "desktop") return;
  for (const theme of ["dark", "light"]) for (const locale of ["en", "zh"]) for (const width of [360, 390, 768, 810, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/${locale}/studio`);
    await page.evaluate(value => { localStorage.setItem("theme", value); }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".cost-summary")).toBeVisible();
    await expect(page.locator(".studio-heading .mode-switch")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`${theme}-${locale}-${width}.png`) });
  }
});

test("batch failure, queued cancellation, ownership and configuration reuse", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `failure-${info.project.name}@modelshot.test`;
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 200, emailVerified: new Date() } });
    await login(page, email);
    const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#de5275" } }).png().toBuffer();
    const uploaded = await page.request.post("/api/upload", { multipart: { file: { name: "fixture.png", mimeType: "image/png", buffer: png } } });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const asset = await uploaded.json();
    const quote = await (await page.request.post("/api/quotes", { data: { images: [asset.assetId, asset.assetId], personImage: asset.assetId, provider: "openai", prompt: "FIXTURE_REJECT", variants: 1 } })).json();
    const submitted = await (await page.request.post("/api/tryon", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { quoteId: quote.quoteId, digest: quote.digest } })).json();
    expect(submitted.batchJobId, JSON.stringify(submitted)).toBeTruthy();
    await expect.poll(async () => (await (await page.request.get(`/api/batch?id=${submitted.batchJobId}`)).json()).status, { timeout: 45000 }).toBe("failed");
    await page.goto(`/en/studio?id=${submitted.tryonId}&retry=1`);
    await expect(page.locator('.asset-list img').first()).toHaveAttribute("src", /api\/assets/);
    const nextQuote = await (await page.request.post("/api/quotes", { data: { images: [asset.assetId], personImage: asset.assetId, provider: "openai", retryOfId: submitted.tryonId } })).json();
    const retried = await (await page.request.post("/api/tryon", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { quoteId: nextQuote.quoteId, digest: nextQuote.digest } })).json();
    const cancelled = await page.request.post(`/api/jobs/${retried.tryonId}/cancel`);
    expect(cancelled.ok()).toBeTruthy();
    await expect.poll(async () => (await (await page.request.get(`/api/tryons?id=${retried.tryonId}`)).json()).status, { timeout: 45000 }).toMatch(/cancelled|succeeded/);
    const csrf = await (await page.request.get("/api/auth/csrf")).json();
    await page.request.post("/api/auth/signout", { form: { csrfToken: csrf.csrfToken, callbackUrl: "/en/login" } });
    await login(page, "m0-user@modelshot.test");
    expect((await page.request.get(`/api/assets/${asset.assetId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/tryons?id=${submitted.tryonId}`)).status()).toBe(404);
    expect((await page.request.post(`/api/jobs/${submitted.tryonId}/cancel`)).status()).toBe(404);
    expect((await page.request.post("/api/exports", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { outputIds: [submitted.tryonId], mode: "original" } })).status()).toBe(404);
  } finally { await db.$disconnect(); }
});

test("worker restart delivers a persisted job once and gallery selection survives pagination", async ({ page }, info) => {
  test.setTimeout(150000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `restart-${info.project.name}@modelshot.test`;
  try {
    const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    await login(page, email);
    const png = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#35a488" } }).png().toBuffer();
    const uploaded = await page.request.post("/api/upload", { multipart: { file: { name: "restart.png", mimeType: "image/png", buffer: png } } });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json();
    expect((await page.request.post("http://127.0.0.1:3199/worker/stop")).ok()).toBeTruthy();
    const quote = await (await page.request.post("/api/quotes", { data: { images: [asset.assetId], personImage: asset.assetId, provider: "openai" } })).json();
    const submitted = await (await page.request.post("/api/tryon", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { quoteId: quote.quoteId, digest: quote.digest } })).json();
    expect(submitted.tryonId).toBeTruthy();
    expect((await db.tryOn.findUnique({ where: { id: submitted.tryonId } })).status).toBe("queued");
    expect((await page.request.post("http://127.0.0.1:3199/worker/start")).ok()).toBeTruthy();
    await expect.poll(async () => (await (await page.request.get(`/api/tryons?id=${submitted.tryonId}`)).json()).exportStatus, { timeout: 90000 }).toBe("ready");
    expect(await db.creditTransaction.count({ where: { tryOnId: submitted.tryonId, type: "consume" } })).toBe(1);
    const source = await db.tryOn.findUnique({ where: { id: submitted.tryonId } });
    // Synthetic completed records exercise cursor pagination without additional supplier calls.
    await db.tryOn.createMany({ data: Array.from({ length: 24 }, (_, index) => ({ userId: user.id, personImage: source.personImage, clothesImage: source.clothesImage, prompt: "Pagination fixture", requestId: crypto.randomUUID(), status: "succeeded", originalAssetId: source.originalAssetId, deliveryAssetId: source.deliveryAssetId, snapshot: { ...source.snapshot, variant: index + 1 }, qaStatus: "skipped", exportStatus: "ready", sku: `PAGINATION-${index}` })) });
    await page.goto("/en/gallery");
    await expect(page.locator(".shot-checkbox input")).toHaveCount(24);
    await page.locator(".shot-checkbox input").first().check();
    await page.locator(".pagination button").last().click();
    await expect(page.locator(".shot-checkbox input")).toHaveCount(1);
    await page.locator(".shot-checkbox input").first().check();
    await page.locator(".pagination button").first().click();
    await expect(page.locator(".shot-checkbox input")).toHaveCount(24);
    await expect(page.locator(".shot-checkbox input").first()).toBeChecked();
    const pending = page.waitForResponse(response => response.url().endsWith("/api/exports") && response.request().method() === "POST");
    await page.locator(".library-heading button").click();
    const response = await pending;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON().outputIds).toHaveLength(2);
    const job = await response.json();
    await expect.poll(async () => (await (await page.request.get(`/api/exports/${job.id}`)).json()).status, { timeout: 60000 }).toBe("succeeded");
    const zip = await JSZip.loadAsync(await (await page.request.get(`/api/exports/${job.id}/download`)).body());
    expect(Object.keys(zip.files).filter(name => name.endsWith(".png"))).toHaveLength(2);
  } finally { await page.request.post("http://127.0.0.1:3199/worker/start"); await db.$disconnect(); }
});

test("privileged updates revoke the affected browser session and persist an audit", async ({ page, browser }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    const email = `revoke-${info.project.name}@modelshot.test`;
    const user = await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } });
    await login(page, email);
    const adminPage = await context.newPage();
    await login(adminPage, "m0-admin@modelshot.test");
    const key = crypto.randomUUID(), data = { id: user.id, status: "banned", reason: "Browser session revocation test" };
    const response = await adminPage.request.patch("/api/admin/users", { headers: { "Idempotency-Key": key }, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    expect((await adminPage.request.patch("/api/admin/users", { headers: { "Idempotency-Key": key }, data })).ok()).toBeTruthy();
    expect((await page.request.get("/api/account")).status()).toBe(401);
    expect((await (await page.request.get("/api/auth/session")).json()).user).toBeNull();
    expect(await db.adminAuditLog.count({ where: { targetUserId: user.id } })).toBe(1);
  } finally { await context.close(); await db.$disconnect(); }
});
