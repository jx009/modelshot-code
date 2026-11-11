import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";
import { createImage } from "../../src/lib/domain/assets/service.js";

test("root promotes a user and audits full prompts, source images, OCR and multi-image results", async ({ page }, info) => {
  const environment = getTestEnvironment();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.databaseUrl }) });
  const s3 = new S3Client(environment.storage), keys = [], ids = [];
  const email = `audit-root-${info.project.name}-${Date.now()}@modelshot.test`;
  const store = { put: async (key, body, contentType) => { keys.push(key); await s3.send(new PutObjectCommand({ Bucket: "modelshot-e2e", Key: key, Body: body, ContentType: contentType })); } };
  const runtimeErrors = []; page.on("pageerror", error => runtimeErrors.push(error.message));
  try {
    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
    const root = await db.user.create({ data: { email, name: "审计管理员", role: "root", passwordHash, emailVerified: new Date() } }); ids.push(root.id);
    const user = await db.user.create({ data: { email: `creator-${email}`, name: "视觉创作者", role: "user" } }); ids.push(user.id);
    const images = [];
    for (const color of ["#c3b29e", "#47665e", "#d5b981"]) {
      const png = await sharp(Buffer.from(`<svg width="480" height="640"><rect width="480" height="640" fill="${color}"/><ellipse cx="240" cy="520" rx="145" ry="28" fill="#000" opacity=".1"/><rect x="156" y="190" width="168" height="330" rx="28" fill="#eee8dc"/><rect x="181" y="145" width="118" height="70" rx="14" fill="#303c35"/><rect x="175" y="315" width="130" height="110" fill="${color}"/></svg>`)).png().toBuffer();
      images.push(await createImage(user.id, png, {}, db, store));
    }
    const prompt = "为护肤品制作柔和自然光下的产品静物摄影，保留包装文字，米白背景。".repeat(24);
    const failed = await db.tryOn.create({ data: { userId: user.id, requestId: randomUUID(), personImage: "", clothesImage: `/api/assets/${images[0].id}`, prompt: `${prompt}\n任务执行补充：保持瓶身比例。`, status: "failed", errorCode: "INVALID_IMAGE_SIZE", provider: "fixture-channel",
      snapshot: { kind: "studio", tool: "edit", assetId: images[0].id, referenceAssetIds: [images[1].id], params: { prompt, size: "1024x1536" }, imageModel: "fixture-image" } } });
    const ocr = await db.tryOn.create({ data: { userId: user.id, requestId: randomUUID(), personImage: "", clothesImage: `/api/assets/${images[0].id}`, prompt: "读取瓶身上的所有文字", status: "succeeded", provider: "fixture-ocr",
      snapshot: { kind: "studio", tool: "ocr", assetId: images[0].id, imageModel: "dedicated-ocr" },
      resultData: { text: "自然光护肤系列\n净含量 120 ml", assets: images.slice(1).map(image => ({ id: image.id, contentType: "image/png" })) } } });
    expect((await page.request.get(`/api/admin/tryons/${failed.id}`)).status()).toBe(401);
    await page.goto("/en/login?callbackUrl=/en/admin/users");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "用户管理", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "修改 视觉创作者 的角色" }).click();
    await page.getByLabel("用户角色", { exact: true }).selectOption("root");
    await page.getByLabel("操作原因", { exact: true }).fill("授权团队超级管理员");
    const patched = page.waitForResponse(response => response.url().endsWith("/api/admin/users") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    expect((await patched).ok()).toBe(true);
    await expect.poll(async () => (await db.user.findUnique({ where: { id: user.id } })).role).toBe("root");
    await page.screenshot({ path: info.outputPath("root-role-selection.png"), fullPage: true });

    await page.goto("/en/admin/tryons");
    const search = page.getByRole("textbox", { name: "搜索邮箱 / 昵称 / 提示词 / 任务 ID（回车）", exact: true });
    await search.fill(failed.id); await search.press("Enter");
    await expect(page.getByRole("button", { name: "查看详情", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "查看详情", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "生成任务审计详情" });
    await expect(dialog.getByText(prompt, { exact: true })).toBeVisible();
    await expect(dialog.getByText("INVALID_IMAGE_SIZE", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "打开原文件" })).toHaveCount(2);
    await expect.poll(() => dialog.locator("img").evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath("audit-detail.png"), fullPage: true });
    const close = dialog.getByRole("button", { name: "关闭审计详情" });
    const before = await close.boundingBox();
    await dialog.getByText("生成参数", { exact: true }).click();
    await dialog.getByText("完整输入快照", { exact: true }).scrollIntoViewIfNeeded();
    const after = await close.boundingBox();
    expect(Math.abs(before.y - after.y)).toBeLessThan(2);
    await close.click();
    await expect(dialog).not.toBeVisible();

    await search.fill(ocr.id); await search.press("Enter");
    await expect(page.getByText("文字识别", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "查看详情", exact: true }).click();
    await expect(dialog.getByText("自然光护肤系列\n净含量 120 ml", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "打开原文件" })).toHaveCount(3);
    await expect(dialog.getByText("dedicated-ocr", { exact: true })).toBeVisible();
    const response = await page.request.get(`/api/admin/tryons/${ocr.id}`);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await db.adminAuditLog.count({ where: { adminId: root.id, action: "READ_GENERATION", targetUserId: user.id } })).toBeGreaterThanOrEqual(2);
    expect(runtimeErrors).toEqual([]);
  } finally {
    await db.adminAuditLog.deleteMany({ where: { adminId: { in: ids } } });
    await db.tryOn.deleteMany({ where: { userId: { in: ids } } });
    await db.asset.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: "modelshot-e2e", Delete: { Objects: keys.map(Key => ({ Key })) } }));
    s3.destroy(); await db.$disconnect();
  }
});
