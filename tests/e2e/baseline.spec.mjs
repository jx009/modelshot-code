import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { E2E_PASSWORD, E2E_USERS } from "../support/e2e-users.mjs";
import { getTestEnvironment } from "../support/environment.mjs";

async function signIn(page, email, destination = "/en/studio") {
  await page.goto(`/en/login?callbackUrl=${encodeURIComponent(destination)}`);
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect.poll(async () => (await (await page.request.get("/api/auth/session")).json()).user?.email).toBe(email);
}

for (const locale of ["en", "zh"]) {
  test(`${locale} public workspace renders without runtime errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(`/${locale}/studio`);
    expect(response.status()).toBe(200);
    await expect(page.locator("h1")).toContainText(locale === "en" ? "Commerce visual studio" : "电商视觉工作台");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    // Language names in the navigation remain in their native language.
    if (locale === "en") expect(await page.locator(".studio-shell").innerText()).not.toMatch(/\p{Script=Han}/u);
    expect(errors).toEqual([]);
  });
}

test("email sign-in restores the workspace and exposes no credential", async ({ page }, testInfo) => {
  await signIn(page, E2E_USERS[0].email);
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.user.email).toBe(E2E_USERS[0].email);
  expect(session.user.role).toBe("user");
  expect(session.user).not.toHaveProperty("customApiKey");
  await page.reload();
  expect((await (await page.request.get("/api/auth/session")).json()).user.email).toBe(E2E_USERS[0].email);
  await page.screenshot({ path: testInfo.outputPath("studio.png"), fullPage: true });
  await page.goto("/en/gallery");
  await expect(page.getByText("No shots yet", { exact: true })).toBeVisible();
});

test("a normal account cannot access admin data", async ({ page }) => {
  await signIn(page, E2E_USERS[0].email);
  const response = await page.request.get("/api/admin/users");
  expect(response.status()).toBe(403);
});

test("admin filtering and refresh use the actual protected API", async ({ page }) => {
  await signIn(page, E2E_USERS[1].email, "/en/admin/orders");
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
  const pending = page.waitForResponse(response => response.url().includes("/api/admin/orders?") && new URL(response.url()).searchParams.get("status") === "paid");
  await page.locator("select").first().selectOption("paid");
  expect((await pending).status()).toBe(200);
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("暂无订单", { exact: true })).toBeVisible();
});

test("root can create multiple model channels with public aliases and a planning model", async ({ page }, testInfo) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `providers-${testInfo.project.name}-${Date.now()}@modelshot.test`;
  let providerId, plannerId;
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), role: "root", credits: 0, emailVerified: new Date() } });
    await signIn(page, email, "/en/admin/providers");
    await expect(page.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增模型", exact: true })).toBeVisible();

    const created = await page.request.put("/api/admin/providers", {
      headers: { "Idempotency-Key": `provider-create-${randomUUID()}` },
      data: {
        kind: "openai",
        displayName: "ModelShot Showcase",
        model: "gpt-image-2-internal",
        scope: "public",
        studioCapability: "image",
        apiKey: "e2e-provider-key",
        baseURL: "",
        costPerImage: 0.123,
        reason: "verify model channel creation",
      },
    });
    expect(created.status()).toBe(201);
    providerId = (await created.json()).id;

    const language = await page.request.put("/api/admin/providers", {
      headers: { "Idempotency-Key": `language-create-${randomUUID()}` },
      data: { kind: "openai", displayName: "ModelShot Backend Language", model: "vision-planner-internal", scope: "language", studioCapability: "language", apiKey: "e2e-language-key", creditCost: 2, reason: "verify independent backend language channel" },
    });
    expect(language.status()).toBe(201);
    plannerId = (await language.json()).id;

    const promoted = await page.request.patch("/api/admin/providers", {
      headers: { "Idempotency-Key": `provider-planner-${randomUUID()}` },
      data: { id: plannerId, isPlanner: true, reason: "verify planning channel selection" },
    });
    expect(promoted.ok()).toBe(true);

    const providers = await (await page.request.get("/api/admin/providers")).json();
    expect(providers).toEqual(expect.arrayContaining([expect.objectContaining({
      id: providerId,
      kind: "openai",
      displayName: "ModelShot Showcase",
      isPlanner: false,
      costPerImage: 0.123,
      config: expect.objectContaining({ model: "gpt-image-2-internal", scope: "public", hasKey: true }),
    }), expect.objectContaining({
      id: plannerId,
      isPlanner: true,
      creditCost: 2,
      config: expect.objectContaining({ model: "vision-planner-internal", scope: "language", hasKey: true }),
    })]));
    expect(JSON.stringify(providers)).not.toMatch(/e2e-provider-key|e2e-language-key/);
    const capabilities = await (await page.request.get("/api/studio/capabilities")).json();
    expect(capabilities.imageModels.some(model => model.label === "ModelShot Showcase")).toBe(true);
    expect(capabilities.imageModels.some(model => model.label === "ModelShot Backend Language")).toBe(false);
    expect(capabilities.planningCost).toBe(2);

    await page.reload();
    await expect(page.getByText("ModelShot Showcase", { exact: true }).first()).toBeVisible();
    await expect(page.locator('input[value="gpt-image-2-internal"]')).toBeVisible();
    await page.getByRole("tab", { name: "后台大语言模型", exact: true }).click();
    await expect(page.locator('input[value="vision-planner-internal"]')).toBeVisible();
    await expect(page.getByText("后台自动调用", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("provider-channels.png"), fullPage: true });

    const repriced = await page.request.patch("/api/admin/studio-tools", {
      headers: { "Idempotency-Key": `tool-price-${randomUUID()}` },
      data: { toolId: "upscale", creditCost: 9, isEnabled: true, reason: "verify configurable tool pricing" },
    });
    expect(repriced.ok()).toBe(true);
    const tools = await (await page.request.get("/api/admin/studio-tools")).json();
    expect(tools.tools).toEqual(expect.arrayContaining([expect.objectContaining({ id: "upscale", creditCost: 9, isEnabled: true })]));
    await page.goto("/en/admin/studio-tools");
    await expect(page.getByRole("heading", { name: "工具配置", exact: true })).toBeVisible();
    await expect(page.getByText("AI 超清放大", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("tool-pricing.png"), fullPage: true });
  } finally {
    if (providerId) await db.modelProvider.deleteMany({ where: { id: providerId } });
    if (plannerId) await db.modelProvider.deleteMany({ where: { id: plannerId } });
    await db.studioToolConfig.updateMany({ where: { toolId: "upscale" }, data: { creditCost: 4, isEnabled: true } });
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  }
});

test("unsafe legacy entry points are unavailable", async ({ request }) => {
  const providers = await (await request.get("/api/auth/providers")).json();
  expect(providers).not.toHaveProperty("credentials");
  expect((await request.post("/api/checkout", { data: { planId: "basic" } })).status()).toBe(503);
  expect((await request.post("/api/user/apikey", { data: { apiKey: "same-suffix" } })).status()).toBe(404);
  expect((await request.post("/api/user/credentials", { data: { provider: "openai", secret: "unused" } })).status()).toBe(404);
  expect((await request.get("/uploads/legacy.png")).status()).toBe(404);
});
