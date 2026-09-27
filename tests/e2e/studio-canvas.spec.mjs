import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("canvas upload, crop through durable worker, layers, export and cloud restore", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `canvas-${info.project.name}-${Date.now()}@modelshot.test`;
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    await page.goto("/en/login?callbackUrl=/en/studio-v2");
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/studio-v2$/);
    await expect(page.locator(".ms-studio")).toBeVisible();
    await expect(page.locator(".site-nav")).toHaveCount(0);
    await expect(page.locator(".ms-avatar")).toBeVisible();
    await expect(page.locator(".ms-stage canvas").first()).toBeAttached();
    await expect.poll(() => page.locator(".ms-empty-art img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath("canvas-empty.png"), fullPage: true });
    const image = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#879d8f" } }).composite([{ input: await sharp({ create: { width: 140, height: 200, channels: 3, background: "#e9d0b3" } }).png().toBuffer(), left: 130, top: 150 }]).png().toBuffer();
    await page.getByLabel("Upload image files").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: image });
    await expect(page.locator(".ms-image-menu")).toBeVisible();
    await expect(page.locator(".ms-stage canvas").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("canvas-selected.png"), fullPage: true });
    await page.getByRole("button", { name: /AI expand/ }).click();
    await expect(page.locator(".ms-edge-readout")).toContainText("R 256");
    const expandStage = await page.locator(".ms-stage").boundingBox();
    const expandScale = Math.min(1.5, (expandStage.width - 110) / 912, (expandStage.height - 180) / 1012);
    const expandRight = {
      x: expandStage.x + expandStage.width / 2 + 912 * expandScale / 2,
      y: expandStage.y + expandStage.height / 2,
    };
    await page.mouse.move(expandRight.x, expandRight.y);
    await page.mouse.down();
    await page.mouse.move(expandRight.x + 35, expandRight.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".ms-edge-readout")).not.toContainText("R 256");
    await page.getByRole("button", { name: "Close tool", exact: true }).click();
    await page.getByRole("button", { name: /Move object/ }).click();
    const stage = await page.locator(".ms-stage").boundingBox();
    // The mobile tool sheet intentionally overlays the right side of the canvas.
    // Paint and drag through the visible image strip instead of clicking through it.
    const moveAnchor = info.project.name === "mobile"
      ? { x: stage.x + stage.width * 0.22, y: stage.y + stage.height * 0.45 }
      : { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    await page.mouse.move(moveAnchor.x - 35, moveAnchor.y - 45);
    await page.mouse.down();
    await page.mouse.move(moveAnchor.x + 35, moveAnchor.y + 45, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("Drag the detected object", { exact: false })).toBeVisible();
    await page.mouse.move(moveAnchor.x, moveAnchor.y);
    await page.mouse.down();
    await page.mouse.move(moveAnchor.x + 60, moveAnchor.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".ms-move-offset")).not.toContainText("ΔX 0px");
    await page.screenshot({ path: info.outputPath("move-object-drag.png"), fullPage: true });
    await page.getByRole("button", { name: "Close tool", exact: true }).click();
    await expect(page.locator(".ms-image-menu")).toBeVisible();
    await page.getByRole("button", { name: /Crop image/ }).click();
    const cropStage = await page.locator(".ms-stage").boundingBox();
    const cropScale = Math.min(1.5, (cropStage.width - 110) / 400, (cropStage.height - 180) / 500);
    const cropTopLeft = {
      x: cropStage.x + (cropStage.width - 400 * cropScale) / 2,
      y: cropStage.y + (cropStage.height - 500 * cropScale) / 2,
    };
    await page.mouse.move(cropTopLeft.x, cropTopLeft.y);
    await page.mouse.down();
    await page.mouse.move(cropTopLeft.x + 70, cropTopLeft.y + 80, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".ms-direct-hint")).not.toContainText("400 × 500");
    const submitted = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Apply Free" }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const job = await response.json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${job.id}`)).json()).status, { timeout: 45000 }).toBe("succeeded");
    await expect(page.locator(".ms-canvas-label")).toContainText("2 layers");
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.locator(".ms-layer")).toHaveCount(2);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page.getByLabel("Layer text").fill("NEW COLLECTION");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("modelshot-canvas.png");
    await page.locator(".ms-project-trigger").click();
    await page.getByLabel("Current project name").fill("Canvas acceptance");
    const saved = page.waitForResponse(r => r.url().endsWith("/api/studio/documents") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    const document = await (await saved).json();
    expect(document.content.layers).toHaveLength(3);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator(".ms-project-trigger").click();
    await page.locator(".ms-project-list button").filter({ hasText: "Canvas acceptance" }).click();
    if (info.project.name === "mobile") await page.locator(".ms-mobile-toggle").click();
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    await page.screenshot({ path: info.outputPath("canvas-restored.png"), fullPage: true });
    if (info.project.name === "mobile") await page.locator(".ms-mobile-toggle").click();
    await page.getByRole("tab", { name: "Quick generation", exact: true }).click();
    await page.getByLabel("Creative prompt").fill("A minimal product still life");
    const generated = page.waitForResponse(r => r.url().endsWith("/api/studio/jobs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Generate · 18 credits", exact: true }).click();
    const generatedResponse = await generated;
    expect(generatedResponse.status()).toBe(202);
    const imageJob = await generatedResponse.json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${imageJob.id}`)).json()).status, { timeout: 45000 }).toBe("succeeded");
    await expect.poll(async () => (await (await page.request.get("/api/usage")).json()).credits).toBe(82);
    if (info.project.name === "mobile") await page.locator(".ms-mobile-toggle").click();
    await expect(page.locator(".ms-canvas-label")).toContainText("4 layers");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    await page.waitForResponse(r => r.url().includes("/api/studio/jobs?"));
    await expect(page.locator(".ms-canvas-label")).toContainText("3 layers");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator(".ms-canvas-label")).toContainText("4 layers");
    await page.goto("/zh/studio-v2");
    if (info.project.name === "mobile") await page.locator(".ms-mobile-toggle").click();
    await expect(page.locator(".ms-canvas-label")).toContainText("4 个图层");
    await page.getByRole("button", { name: "适应画布", exact: true }).click();
    await page.screenshot({ path: info.outputPath("canvas-zh.png"), fullPage: true });
    const owner = await db.user.findUnique({ where: { email } });
    const videoId = randomUUID(), bytes = Buffer.from("0000ftypisom-PRIVATE-VIDEO-RANGE-FIXTURE");
    const objectKey = `${owner.id}/original/${videoId}.mp4`;
    const storage = new S3Client(getTestEnvironment().storage);
    try { await storage.send(new PutObjectCommand({ Bucket: "modelshot-e2e", Key: objectKey, Body: bytes, ContentType: "video/mp4" })); }
    finally { storage.destroy(); }
    await db.asset.create({ data: { id: videoId, userId: owner.id, objectKey, kind: "original", contentType: "video/mp4", width: 0, height: 0, bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") } });
    const range = await page.request.get(`/api/assets/${videoId}`, { headers: { Range: "bytes=4-11" } });
    expect(range.status()).toBe(206); expect((await range.body()).toString()).toBe("ftypisom");
    expect(range.headers()["content-type"]).toBe("video/mp4");
    expect((await page.request.get(`/api/assets/${videoId}`, { headers: { Range: "bytes=999-" } })).status()).toBe(416);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
