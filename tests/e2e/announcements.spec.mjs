import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("administrator publishes, previews, and disables an announcement through the real API", async ({ page, browser, baseURL }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  let guest;
  const original = await db.systemConfig.findUnique({ where: { key: "announcements" } });
  try {
    const email = `announcements-${randomUUID()}@modelshot.test`;
    const admin = await db.user.create({ data: { email, role: "admin", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } });
    await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined }));
    await page.goto("/en/login?callbackUrl=/zh/admin/announcements");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "公告管理", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "网站公告" })).toHaveCount(0);
    await page.getByRole("button", { name: "新建公告", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("公告发布验证");
    await page.getByRole("textbox", { name: "公告内容（纯文本）", exact: true }).fill("新模型正式上线，欢迎体验。");
    await page.getByLabel("按钮链接（留空隐藏按钮）", { exact: true }).fill("/explore");
    await page.getByLabel("启用公告", { exact: true }).check();
    await page.getByRole("button", { name: "保存所有公告", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("公告已保存");
    await page.screenshot({ path: info.outputPath("announcements-admin.png"), animations: "disabled" });
    const stored = await db.systemConfig.findUnique({ where: { key: "announcements" } });
    expect(JSON.parse(stored.value)[0]).toMatchObject({ title: "公告发布验证", enabled: true });
    expect(await db.adminAuditLog.count({ where: { adminId: admin.id, action: "UPDATE_ANNOUNCEMENTS" } })).toBe(1);
    guest = await browser.newPage({ baseURL });
    const publicResult = await (await guest.request.get("/api/announcements/current")).json();
    expect(publicResult.announcement.title).toBe("公告发布验证");
    expect(publicResult.announcement).not.toHaveProperty("enabled");
    expect((await guest.request.get("/api/admin/announcements")).status()).toBe(401);
    await guest.goto("/zh");
    await expect(guest.getByRole("region", { name: "网站公告" })).toContainText("公告发布验证");
    await page.getByLabel("启用公告", { exact: true }).uncheck();
    await page.getByRole("button", { name: "保存所有公告", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("公告已保存");
    expect((await (await guest.request.get("/api/announcements/current")).json()).announcement).toBeNull();
    await guest.reload();
    await expect(guest.getByRole("region", { name: "网站公告" })).toHaveCount(0);
  } finally {
    if (original) await db.systemConfig.upsert({ where: { key: "announcements" }, create: { key: "announcements", value: original.value }, update: { value: original.value } });
    else await db.systemConfig.deleteMany({ where: { key: "announcements" } });
    await guest?.close(); await db.$disconnect();
  }
});
