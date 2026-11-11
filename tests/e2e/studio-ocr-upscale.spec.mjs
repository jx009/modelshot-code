import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

for (const ocrKind of ["volcengine", "openai"]) test(`admin saves ${ocrKind} OCR and upscale purposes and binds them without exposing credentials`, async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `ocr-upscale-${info.project.name}-${Date.now()}@modelshot.test`;
  const previous = await db.studioToolConfig.findMany({ where: { toolId: { in: ["ocr", "upscale"] } } });
  const planner = await db.modelProvider.findFirst({ where: { isPlanner: true } });
  const ids = [], providers = [];
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), role: "root", credits: 100, emailVerified: new Date() } });
    await page.goto("/en/login?callbackUrl=/en/admin/providers");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible();
    for (const purpose of ["ocr", "upscale"]) {
      await page.goto(`/en/admin/providers?category=tool&purpose=${purpose}`);
      const form = page.locator("form");
      await expect(form.getByRole("combobox", { name: "用途", exact: true })).toHaveValue(purpose);
      if (purpose === "ocr") {
        await form.getByRole("combobox", { name: "协议类型", exact: true }).selectOption(ocrKind);
        await expect(form.getByRole("combobox", { name: "用途", exact: true })).toHaveValue("ocr");
        await form.getByLabel("OCR 视觉模型 ID / Endpoint ID").fill("fixture-ocr");
        await form.getByLabel("API Key", { exact: true }).fill("fixture-ocr-secret");
      } else {
        await form.getByLabel("Access Key ID (AK)", { exact: true }).fill("fixture-upscale-ak");
        await form.getByLabel("Secret Access Key (SK)", { exact: true }).fill("fixture-upscale-sk");
      }
      await page.screenshot({ path: info.outputPath(`admin-${purpose}.png`), fullPage: true });
      const created = page.waitForResponse(r => r.url().endsWith("/api/admin/providers") && r.request().method() === "PUT");
      await form.getByRole("button", { name: "保存新模型", exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(201);
      const id = (await response.json()).id; ids.push(id);
      const row = await db.modelProvider.findUnique({ where: { id } }); providers.push(row);
      expect(row.kind).toBe(purpose === "ocr" ? ocrKind : "volc-visual");
      expect(row.isPlanner).toBe(false);
      expect(row.config).not.toMatch(/fixture-ocr-secret|fixture-upscale-ak|fixture-upscale-sk/);
      // The browser and worker can only call the loopback test supplier.
      await db.modelProvider.update({ where: { id }, data: { config: JSON.stringify({ ...JSON.parse(row.config), baseURL: `http://127.0.0.1:${process.env.TEST_PROVIDER_PORT || 3199}/cloud` }) } });
      const tested = await page.request.post("/api/admin/providers", { data: { id } });
      expect(tested.status(), await tested.text()).toBe(200);
      expect((await tested.json()).ok).toBe(true);
    }
    expect((await db.modelProvider.findFirst({ where: { isPlanner: true } }))?.id).toBe(planner?.id);
    const safe = await (await page.request.get("/api/admin/providers")).text();
    expect(safe).not.toMatch(/fixture-ocr-secret|fixture-upscale-ak|fixture-upscale-sk|apiKeyEnc|secretAccessKeyEnc/);
    for (const [index, purpose] of ["ocr", "upscale"].entries()) {
      await page.goto("/en/admin/studio-tools");
      const card = page.getByRole("heading", { name: purpose === "ocr" ? "文字识别" : "AI 超清放大", exact: true }).locator("xpath=ancestor::div[contains(@class, 'rounded-[14px]')][1]");
      await card.getByRole("combobox", { name: "专用模型", exact: true }).selectOption(providers[index].name);
      await card.getByLabel("单次处理积分").fill(String(index + 6));
      const saved = page.waitForResponse(r => r.url().endsWith("/api/admin/studio-tools") && r.request().method() === "PATCH");
      await card.getByRole("button", { name: "保存", exact: true }).click();
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(card.getByRole("combobox", { name: "专用模型", exact: true })).toHaveValue(providers[index].name);
    }
    const invalid = await page.request.patch("/api/admin/studio-tools", { headers: { "Idempotency-Key": randomUUID() }, data: { toolId: "ocr", reason: "Verify capability isolation", routing: { mode: "dedicated", channelName: providers[1].name, segmentMode: "default", segmentChannelName: null } } });
    expect(invalid.status()).toBe(422);
    const caps = await (await page.request.get("/api/studio/capabilities")).json();
    expect(caps.tools.find(t => t.id === "ocr")).toMatchObject({ available: true, cost: 6 });
    expect(caps.tools.find(t => t.id === "upscale")).toMatchObject({ available: true, cost: 7, supportedScales: [2] });
    expect(caps.imageModels.some(m => providers.some(p => p.name === m.id))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    for (const toolId of ["ocr", "upscale"]) {
      const old = previous.find(row => row.toolId === toolId);
      if (old) await db.studioToolConfig.upsert({ where: { toolId }, create: old, update: { routing: old.routing, creditCost: old.creditCost, isEnabled: old.isEnabled } });
      else await db.studioToolConfig.deleteMany({ where: { toolId } });
    }
    await db.modelProvider.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
