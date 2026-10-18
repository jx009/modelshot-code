import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";
import { createImage } from "../../src/lib/domain/assets/service.js";
import { DEFAULT_ITEMS, inspirationImage } from "../../src/lib/inspiration/gallery.js";

test("curates generated inspiration, publishes a site output and reuses its full prompt", async ({ page, request }, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  const env = getTestEnvironment(), db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });
  const s3 = new S3Client(env.storage), keys = [], ids = [], errors = [];
  const key = "inspiration_gallery_v1", original = await db.systemConfig.findUnique({ where: { key } });
  const prompt = "A refined editorial glass sculpture in soft blue studio lighting. Original composition, clean optical glass, no text.";
  page.on("pageerror", e => errors.push(e.message));
  try {
    await db.systemConfig.deleteMany({ where: { key } });
    const admin = await db.user.create({ data: { email: `inspiration-${randomUUID()}@modelshot.test`, name: "灵感策展管理员", role: "root", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } }); ids.push(admin.id);
    const creator = await db.user.create({ data: { email: `creator-${randomUUID()}@modelshot.test`, name: "灵感测试创作者" } }); ids.push(creator.id);
    const asset = await createImage(creator.id, await readFile(`public${inspirationImage(DEFAULT_ITEMS.find(i => i.id === "tea-ceremony"))}`), {}, db, { put: async (Key, Body, ContentType) => { keys.push(Key); await s3.send(new PutObjectCommand({ Bucket: "modelshot-e2e", Key, Body, ContentType })); } });
    const job = await db.tryOn.create({ data: { userId: creator.id, requestId: randomUUID(), personImage: "", clothesImage: "", prompt, status: "succeeded", deliveryAssetId: asset.id, provider: "fixture", snapshot: { kind: "studio", tool: "generate", imageModel: "test-model", params: { prompt } } } });
    expect((await request.get("/api/admin/inspiration")).status()).toBe(401);
    expect((await request.get("/api/inspiration/not-published/image")).status()).toBe(404);
    await page.goto("/zh/explore");
    await expect(page.locator(".ig-card")).toHaveCount(20);
    await expect(page.locator(".ig-masonry")).toBeVisible();
    await loadGalleryImages(page);
    await assertNativeImages(page);
    await page.screenshot({ path: info.outputPath("inspiration-default-native.png"), fullPage: true });
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.goto("/zh");
    await expect(page.locator(".ig-card")).toHaveCount(20);
    await loadGalleryImages(page);
    await assertNativeImages(page);
    await page.screenshot({ path: info.outputPath("inspiration-home-light.png"), fullPage: true });
    await page.goto("/zh/explore");
    await page.getByRole("button", { name: "漫画叙事", exact: true }).click();
    await expect(page.locator(".ig-card")).toHaveCount(DEFAULT_ITEMS.filter(i => i.category === "manga").length);
    await page.getByRole("button", { name: "全部灵感", exact: true }).click();
    await page.getByLabel("搜索灵感", { exact: true }).fill("玻璃引力");
    await expect(page.locator(".ig-card")).toHaveCount(1);
    await page.locator(".ig-card").click();
    await expect(page.getByRole("heading", { name: "玻璃引力", exact: true })).toBeVisible();
    await expect(page.locator(".ig-prompt p")).toHaveText(DEFAULT_ITEMS.find(i => i.id === "glass-orbit").prompt);
    await page.screenshot({ path: info.outputPath("inspiration-detail.png"), fullPage: true });

    await page.goto("/en/login?callbackUrl=/en/admin/inspiration");
    await page.getByLabel("Email", { exact: true }).fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "灵感管理", exact: true })).toBeVisible();
    await expect(page.locator(".ig-admin-row")).toHaveCount(20);
    await page.getByRole("button", { name: "下移 雨停之前", exact: true }).click();
    await expect(page.locator(".ig-admin-select strong").first()).toHaveText("一口夏日");
    await page.getByLabel("展示方式", { exact: true }).selectOption("masonry");
    await page.getByLabel("桌面密度", { exact: true }).selectOption("5");
    await page.getByRole("button", { name: "从生成记录新增", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "从站内生成记录选图", exact: true });
    await picker.getByLabel("搜索站内生成图片").fill(job.id);
    await picker.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(picker.getByRole("button", { name: `选择图片 ${asset.id}`, exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "搜索", exact: true }).click();
    await picker.getByRole("button", { name: `选择图片 ${asset.id}`, exact: true }).click();
    await expect(picker).not.toBeVisible();
    await page.getByLabel("作品标题", { exact: true }).fill("站内创作示例");
    await expect(page.getByLabel("完整提示词（会公开展示，用户可一键带入画布）", { exact: true })).toHaveValue(prompt);
    await expect(page.getByLabel("生成尺寸", { exact: true })).toHaveValue("1024x1536");
    await page.getByLabel("发布到前台", { exact: true }).check();
    const publish = page.waitForResponse(r => r.url().endsWith("/api/admin/inspiration") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存并发布", exact: true }).click();
    expect((await publish).status()).toBe(200);
    await expect(page.getByText("灵感库已保存，首页与灵感发现会读取最新内容。", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("inspiration-admin.png"), fullPage: true });
    const publicData = await (await request.get("/api/inspiration")).json();
    expect(publicData.items).toHaveLength(21);
    expect(publicData.layout).toMatchObject({ mode: "masonry", columns: 5 });
    expect(publicData.items.slice(1, 3).map(i => i.id)).toEqual(["citrus-burst", "rainy-comic"]);
    const custom = publicData.items[0];
    expect((await request.get(`/api/inspiration/${custom.id}/image`)).status()).toBe(200);
    expect((await request.get(`/api/assets/${asset.id}`)).status()).toBe(401);
    await page.goto("/zh/explore");
    await expect(page.locator(".ig-card")).toHaveCount(21);
    await loadGalleryImages(page);
    await assertNativeImages(page);
    await page.screenshot({ path: info.outputPath("inspiration-gallery.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.goto(`/zh/explore/${custom.id}`);
    const create = page.waitForResponse(r => r.url().endsWith("/api/studio/cases") && r.request().method() === "POST");
    await page.getByRole("button", { name: "以此创作", exact: true }).click();
    const created = await create; expect(created.status()).toBe(200);
    const { documentId } = await created.json();
    const doc = await db.studioDocument.findUnique({ where: { id: documentId } });
    expect(doc.content.composer.text).toBe(prompt);
    expect(doc.content.composer.size).toBe("1024x1536");
    expect(doc.content.layers).toEqual([]);
    expect(await db.tryOn.count({ where: { userId: admin.id } })).toBe(0);

    await page.goto("/zh/admin/inspiration");
    await expect(page.locator(".ig-admin-row")).toHaveCount(21);
    await page.getByRole("button", { name: "删除当前案例", exact: true }).click();
    const remove = page.waitForResponse(r => r.url().endsWith("/api/admin/inspiration") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存并发布", exact: true }).click();
    expect((await remove).status()).toBe(200);
    expect((await request.get(`/api/inspiration/${custom.id}/image`)).status()).toBe(404);
    expect((await db.asset.findUnique({ where: { id: asset.id } })).status).toBe("active");
    expect(await db.assetReference.count({ where: { kind: "inspiration", assetId: asset.id } })).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await db.assetReference.deleteMany({ where: { kind: "inspiration" } });
    if (original) await db.systemConfig.upsert({ where: { key }, create: original, update: { value: original.value } });
    else await db.systemConfig.deleteMany({ where: { key } });
    await db.studioDocument.deleteMany({ where: { userId: { in: ids } } });
    await db.adminAuditLog.deleteMany({ where: { adminId: { in: ids } } });
    await db.tryOn.deleteMany({ where: { userId: { in: ids } } });
    await db.assetReference.deleteMany({ where: { asset: { userId: { in: ids } } } });
    await db.asset.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: "modelshot-e2e", Delete: { Objects: keys.map(Key => ({ Key })) } }));
    s3.destroy(); await db.$disconnect();
  }
});

async function assertNativeImages(page) {
  const images = await page.locator(".ig-card img").evaluateAll(images => images.map(image => {
    const box = image.getBoundingClientRect(), cover = image.parentElement.getBoundingClientRect();
    return { ratio: image.naturalWidth / image.naturalHeight, rendered: box.width / box.height, full: Math.abs(box.height - cover.height) < 1 };
  }));
  for (const image of images) {
    expect(image.rendered).toBeCloseTo(image.ratio, 2);
    expect(image.full).toBe(true);
  }
  expect(images.some(i => i.ratio < .8)).toBe(true);
  expect(images.some(i => i.ratio > 1.2)).toBe(true);
  expect(images.some(i => Math.abs(i.ratio - 1) < .01)).toBe(true);
}

async function loadGalleryImages(page) {
  for (const card of await page.locator(".ig-card").all()) await card.scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".ig-card img").evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
}
