import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("admin owns tool models, has no page scrollbar, and decomposition remains editable", async ({ page }, info) => {
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
    await expect(page.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增模型", exact: true }).click();
    await expect(page.getByLabel("配置预设")).toBeVisible();
    await page.getByLabel("配置预设").selectOption("2");
    await expect(page.getByLabel("协议类型")).toHaveValue("volcengine");
    await expect(page.getByLabel("Base URL", { exact: true }).first()).toHaveValue("https://ark.cn-beijing.volces.com/api/v3");
    const channels = [];
    for (const input of [
      { kind: "dashscope", displayName: "Fixture Ali Edit", model: "qwen-image-edit-max", baseURL: "https://dashscope.aliyuncs.com", scope: "tool", studioCapability: "image", imageMode: "edit", creditCost: 8 },
      { kind: "volcengine", displayName: "Fixture Ark Edit", model: "ep-fixture", baseURL: "https://ark.cn-beijing.volces.com/api/v3", studioCapability: "image", imageMode: "both", creditCost: 9 },
      { kind: "fal", displayName: "Fixture Qwen Layers", model: "fal-ai/qwen-image-layered", baseURL: "https://fal.run", studioCapability: "split", creditCost: 20 },
      { kind: "openai", displayName: "Fixture Backend Language", model: "fixture-language", baseURL: "https://api.openai.com/v1", studioCapability: "language", scope: "language", creditCost: 3 },
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
    for (const row of [channels[1], channels[2]]) {
      const response = await page.request.patch("/api/admin/providers", { headers: { "Idempotency-Key": randomUUID() }, data: { id: row.id, studioDefault: true, reason: "Verify independent capability defaults" } });
      expect(response.ok()).toBe(true);
    }
    const caps = await (await page.request.get("/api/studio/capabilities")).json();
    expect(caps.imageProvider).toBe(channels[1].name); expect(caps.splitProvider).toBeUndefined();
    expect(caps.imageModels.some(m => m.id === channels[0].name)).toBe(false);
    expect(JSON.stringify(caps)).not.toContain("fixture-only");
    expect(caps.planningCost).toBe(3);
    expect(caps.imageModels.some(m => m.id === channels[3].name)).toBe(false);
    await page.goto("/en/admin/studio-tools");
    await expect(page.getByRole("heading", { name: "工具配置", exact: true })).toBeVisible();
    await expect(page.locator(".site-nav")).toHaveCount(0);
    if (info.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 560 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
    const moveCard = page.getByRole("heading", { name: "物体移动", exact: true }).locator("xpath=ancestor::div[contains(@class, 'rounded-[14px]')][1]");
    const moveSelect = label => moveCard.locator("label").filter({ hasText: label }).last().locator("select");
    await moveSelect("背景修复模型").selectOption("dedicated");
    await moveSelect("专用模型").selectOption(channels[0].name);
    const configured = page.waitForResponse(r => r.url().endsWith("/api/admin/studio-tools") && r.request().method() === "PATCH");
    await moveCard.getByRole("button", { name: "保存", exact: true }).click();
    expect((await configured).ok()).toBe(true);
    await expect(moveSelect("专用模型")).toHaveValue(channels[0].name);
    await page.locator("[data-admin-content]").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole("heading", { name: "生成视频", exact: true })).toBeVisible();
    if (info.project.name === "desktop") {
      await expect(page.getByRole("link", { name: "Back to App", exact: false })).toBeVisible();
      const menu = page.locator("aside nav");
      await menu.getByRole("link", { name: "Prompt 模板", exact: true }).scrollIntoViewIfNeeded();
      await expect(menu.getByRole("link", { name: "Prompt 模板", exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: info.outputPath("admin-independent-scroll.png"), fullPage: true });
    if (info.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/en/studio-v2");
    await expect(page.getByLabel("Image model")).toHaveValue(channels[1].name);
    await page.getByLabel("Image model").selectOption(channels[1].name);
    await expect(page.getByLabel("Image model")).toHaveValue(channels[1].name);
    const source = await sharp({ create: { width: 320, height: 480, channels: 3, background: "#879d8f" } }).png().toBuffer();
    await page.getByLabel("Upload image files").setInputFiles({ name: "cloud-source.png", mimeType: "image/png", buffer: source });
    await expect(page.locator(".ms-image-menu")).toBeVisible();
    await page.getByRole("button", { name: /Split layers/ }).click();
    await expect(page.getByLabel("Layer model", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Segmentation model", { exact: true })).toHaveCount(0);
    const submitted = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Apply 20 credits", exact: true }).click({ force: true });
    const response = await submitted;
    expect(response.status()).toBe(202);
    const job = await response.json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${job.id}`)).json()).status, { timeout: 45000 }).toBe("succeeded");
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    const readDraft = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("modelshot-studio-v1:")))));
    const draft = await readDraft();
    expect(draft.layers[0].visible).toBe(true);
    for (const layer of draft.layers.slice(1)) expect(layer).toMatchObject({ x: draft.layers[0].x + draft.layers[0].width + 50, y: draft.layers[0].y, width: 320, height: 480, groupId: job.id });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("1 layers");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.locator(".ms-layer")).toHaveCount(3);
    await page.screenshot({ path: info.outputPath("cloud-aligned-layers.png"), fullPage: true });
    if (info.project.name === "mobile") await page.locator(".ms-mobile-toggle").click();
    await page.getByRole("tab", { name: "Planned chat", exact: true }).click();
    await page.getByLabel("Creative prompt").fill("Plan a product photo");
    const planning = page.waitForResponse(r => r.url().endsWith("/api/studio/plan") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create plan · 3 credits", exact: true }).click();
    expect((await planning).ok()).toBe(true);
    await expect(page.getByText("Fixture plan", { exact: true })).toBeVisible();
    expect((await (await page.request.get("/api/usage")).json()).credits).toBe(77);
    const savedPlan = page.waitForResponse(r => r.url().includes("/api/studio/documents") && ["PUT", "POST"].includes(r.request().method()));
    await page.keyboard.press("Control+s");
    expect((await savedPlan).ok()).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await db.studioToolConfig.deleteMany({ where: { toolId: "move" } });
    await db.modelProvider.deleteMany({ where: { id: { in: providerIds } } });
    await db.$disconnect();
  }
});
