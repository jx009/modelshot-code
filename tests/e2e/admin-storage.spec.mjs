import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("ROOT configures private COS in a responsive admin page without exposing credentials", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `cos-admin-${info.project.name}-${randomUUID()}@modelshot.test`;
  try {
    await db.user.create({ data: { email, role: "root", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } });
    expect((await page.request.get("/api/admin/storage")).status()).toBe(401);
    await page.goto("/en/login?callbackUrl=/en/admin/storage");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "云存储与图片加速", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存配置" })).toBeEnabled();
    await page.getByLabel(/^存储桶名称/).fill("fixture-1250000000");
    await page.getByLabel(/^SecretId/).fill("fixture-private-id");
    await page.getByLabel(/^SecretKey/).fill("fixture-private-secret");
    // Disabled synthetic configuration: no external COS requests in this test.
    await page.getByLabel("启用图片加速").uncheck();
    const saved = page.waitForResponse(r => r.url().endsWith("/api/admin/storage") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存配置" }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByLabel(/^SecretKey/)).toHaveValue("");
    const row = await db.systemConfig.findUnique({ where: { key: "cos_delivery" } });
    expect(row.value).not.toContain("fixture-private-secret"); expect(row.value).not.toContain("fixture-private-id");
    const safe = await (await page.request.get("/api/admin/storage")).text();
    expect(safe).not.toContain("fixture-private-secret"); expect(safe).not.toContain("fixture-private-id");
    expect(JSON.parse(safe).config.credentialsConfigured).toBe(true);
    await expect(page.getByText("首次配置", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath("cos-admin-settings.png"), fullPage: true });
  } finally {
    await db.systemConfig.deleteMany({ where: { key: "cos_delivery" } });
    await db.$disconnect();
  }
});
