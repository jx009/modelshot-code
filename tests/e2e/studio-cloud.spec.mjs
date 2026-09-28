import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("cloud channels switch by capability and decomposition stays aligned and editable", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `cloud-${info.project.name}-${Date.now()}@modelshot.test`, providerIds = [];
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), role: "root", credits: 100, emailVerified: new Date() } });
    await page.goto("/en/login?callbackUrl=/en/admin/providers");
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "模型通道", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增模型", exact: true }).click();
    await expect(page.getByLabel("配置预设")).toBeVisible();
    await page.getByLabel("配置预设").selectOption("2");
    await expect(page.getByLabel("协议类型")).toHaveValue("volcengine");
    await expect(page.getByLabel("Base URL", { exact: true }).first()).toHaveValue("https://ark.cn-beijing.volces.com/api/v3");
    const channels = [];
    for (const input of [
      { kind: "dashscope", displayName: "Fixture Ali Edit", model: "qwen-image-edit-max", baseURL: "https://dashscope.aliyuncs.com", studioCapability: "image", imageMode: "edit", creditCost: 8 },
      { kind: "volcengine", displayName: "Fixture Ark Edit", model: "ep-fixture", baseURL: "https://ark.cn-beijing.volces.com/api/v3", studioCapability: "image", imageMode: "both", creditCost: 9 },
      { kind: "fal", displayName: "Fixture Qwen Layers", model: "fal-ai/qwen-image-layered", baseURL: "https://fal.run", studioCapability: "split", creditCost: 20 },
    ]) {
      const response = await page.request.put("/api/admin/providers", { headers: { "Idempotency-Key": randomUUID() }, data: { ...input, apiKey: "fixture-only-no-real-upstream-key", reason: "Verify cloud protocol settings" } });
      expect(response.status()).toBe(201);
      const { id } = await response.json(); providerIds.push(id);
      const row = await db.modelProvider.findUnique({ where: { id } });
      const config = JSON.parse(row.config);
      // Confine all generated work to the isolated local HTTP supplier.
      await db.modelProvider.update({ where: { id }, data: { config: JSON.stringify({ ...config, baseURL: "http://127.0.0.1:3199/cloud" }) } });
      channels.push(row);
    }
    for (const row of [channels[0], channels[2]]) {
      const response = await page.request.patch("/api/admin/providers", { headers: { "Idempotency-Key": randomUUID() }, data: { id: row.id, studioDefault: true, reason: "Verify independent capability defaults" } });
      expect(response.ok()).toBe(true);
    }
    const caps = await (await page.request.get("/api/studio/capabilities")).json();
    expect(caps.imageProvider).toBe(channels[0].name); expect(caps.splitProvider).toBe(channels[2].name);
    expect(JSON.stringify(caps)).not.toContain("fixture-only");
    await page.goto("/en/studio-v2");
    await expect(page.getByLabel("Image model")).toHaveValue(channels[0].name);
    await page.getByLabel("Image model").selectOption(channels[1].name);
    await expect(page.getByLabel("Image model")).toHaveValue(channels[1].name);
    const source = await sharp({ create: { width: 320, height: 480, channels: 3, background: "#879d8f" } }).png().toBuffer();
    await page.getByLabel("Upload image files").setInputFiles({ name: "cloud-source.png", mimeType: "image/png", buffer: source });
    await expect(page.locator(".ms-image-menu")).toBeVisible();
    await page.getByRole("button", { name: /Split layers/ }).click();
    await expect(page.getByLabel("Layer model", { exact: true })).toHaveValue(channels[2].name);
    const submitted = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Apply 20 credits", exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const job = await response.json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${job.id}`)).json()).status, { timeout: 45000 }).toBe("succeeded");
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    const readDraft = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("modelshot-studio-v1:")))));
    const draft = await readDraft();
    expect(draft.layers[0].visible).toBe(false);
    for (const layer of draft.layers.slice(1)) expect(layer).toMatchObject({ x: draft.layers[0].x, y: draft.layers[0].y, width: 320, height: 480, groupId: job.id });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("1 layers");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.locator(".ms-layer")).toHaveCount(3);
    await page.screenshot({ path: info.outputPath("cloud-aligned-layers.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await db.modelProvider.deleteMany({ where: { id: { in: providerIds } } });
    await db.$disconnect();
  }
});
