import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("ROOT saves global resolution surcharges while model base credits remain unchanged", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `prices-${randomUUID()}@modelshot.test`;
  try {
    await db.user.create({ data: { email, role: "root", passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), emailVerified: new Date() } });
    const before = await db.modelProvider.findMany({ select: { id: true, creditCost: true, config: true }, orderBy: { id: "asc" } });
    expect((await page.request.get("/api/admin/resolution-pricing")).status()).toBe(401);
    await page.goto("/en/login?callbackUrl=/zh/admin/resolution-pricing");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "分辨率积分", exact: true })).toBeVisible();
    for (const [resolution, value] of [["1K", "1"], ["2K", "2"], ["4K", "4"]]) await page.getByLabel(`${resolution} 附加积分`, { exact: false }).fill(value);
    const response = page.waitForResponse(r => r.url().endsWith("/api/admin/resolution-pricing") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存分辨率积分", exact: true }).click();
    expect((await response).ok()).toBe(true);
    expect(JSON.parse((await db.systemConfig.findUnique({ where: { key: "image_resolution_pricing" } })).value)).toEqual({ "1K": 1, "2K": 2, "4K": 4 });
    expect(await db.modelProvider.findMany({ select: { id: true, creditCost: true, config: true }, orderBy: { id: "asc" } })).toEqual(before);
    const caps = await (await page.request.get("/api/studio/capabilities")).json();
    expect(caps.imageModels.length).toBeGreaterThan(0);
    for (const model of caps.imageModels) expect(model.resolutionSurcharges).toEqual({ "1K": 1, "2K": 2, "4K": 4 });
    await page.reload();
    await expect(page.getByLabel("4K 附加积分", { exact: false })).toHaveValue("4");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.screenshot({ path: info.outputPath("admin-resolution-pricing.png") });
  } finally {
    await db.systemConfig.deleteMany({ where: { key: "image_resolution_pricing" } });
    await db.$disconnect();
  }
});
