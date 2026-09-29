import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import fs from "node:fs/promises";
import { getTestEnvironment } from "../support/environment.mjs";
import { E2E_PASSWORD } from "../support/e2e-users.mjs";

test("paint selection survives pan; shape crop and six export formats produce real files", async ({ page }, info) => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  const email = `formats-${info.project.name}-${Date.now()}@modelshot.test`;
  try {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(E2E_PASSWORD, 10), credits: 100, emailVerified: new Date() } });
    await page.goto("/en/login?callbackUrl=/en/studio-v2");
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".ms-stage canvas").first()).toBeAttached();
    const bytes = await sharp({ create: { width: 240, height: 240, channels: 4, background: "#c89d87" } }).png().toBuffer();
    await page.getByLabel("Upload image files").setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: bytes });
    await expect(page.locator(".ms-image-menu")).toBeVisible();
    await page.getByRole("button", { name: /Local edit/ }).click();
    await page.getByLabel("Local edit instruction", { exact: true }).fill("Make it blue");
    await expect(page.getByRole("button", { name: /Apply edit/ })).toBeDisabled();
    const stage = await page.locator(".ms-stage").boundingBox(), rect = JSON.parse(await page.locator(".ms-stage").getAttribute("data-selection-frame"));
    const center = { x: stage.x + rect.left + rect.width / 2, y: stage.y + rect.top + rect.height / 2 };
    await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 20, center.y, { steps: 5 }); await page.mouse.up();
    await expect(page.getByRole("button", { name: /Apply edit/ })).toBeEnabled();
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 35, center.y + 10, { steps: 5 }); await page.mouse.up();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByRole("button", { name: /Apply edit/ })).toBeEnabled();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("button", { name: /Apply edit/ })).toBeDisabled();
    await page.getByRole("button", { name: "Close tool", exact: true }).click();
    await page.getByRole("button", { name: /Crop image/ }).click();
    await page.getByRole("button", { name: "Heart", exact: true }).click();
    const submitted = page.waitForResponse(response => response.url().endsWith("/api/studio/jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Apply Free", exact: true }).click();
    const response = await submitted; expect(response.status()).toBe(202);
    const job = await response.json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${job.id}`)).json()).status).toBe("succeeded");
    await expect(page.locator(".ms-canvas-label")).toContainText("2 layers");
    await page.screenshot({ path: info.outputPath("heart-crop.png"), fullPage: true, animations: "disabled" });
    for (const format of ["png", "jpeg", "webp", "psd", "svg-layers", "svg-bitmap"]) {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByLabel("File format", { exact: true }).selectOption(format);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export file", exact: true }).click();
      const file = await download, path = info.outputPath(`result-${format}.${format.startsWith("svg") ? "svg" : format}`);
      await file.saveAs(path);
      const data = await fs.readFile(path);
      if (format === "psd") expect(data.toString("ascii", 0, 4)).toBe("8BPS");
      else { const meta = await sharp(data).metadata(); expect(meta.width).toBeGreaterThan(240); expect(meta.height).toBe(240); if (format !== "jpeg") expect(meta.hasAlpha).toBe(true); }
    }
    await page.getByRole("button", { name: /Crop image/ }).click();
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    const gridStage = await page.locator(".ms-stage").boundingBox(), frame = JSON.parse(await page.locator(".ms-stage").getAttribute("data-selection-frame"));
    const point = { x: gridStage.x + frame.left + frame.width / 2, y: gridStage.y + frame.top + frame.height / 2 };
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + frame.width * .1, point.y + frame.height * .1, { steps: 5 }); await page.mouse.up();
    const cuts = JSON.parse(await page.locator(".ms-stage").getAttribute("data-crop")).grid;
    expect(cuts.x[0]).toBeGreaterThan(.55); expect(cuts.y[0]).toBeGreaterThan(.55);
    await page.screenshot({ path: info.outputPath("grid-crop.png"), fullPage: true, animations: "disabled" });
    const gridSubmit = page.waitForResponse(response => response.url().endsWith("/api/studio/jobs") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Apply Free", exact: true }).click();
    const gridJob = await (await gridSubmit).json();
    await expect.poll(async () => (await (await page.request.get(`/api/studio/jobs/${gridJob.id}`)).json()).resultData?.assets?.length).toBe(4);
    await expect(page.locator(".ms-canvas-label")).toContainText("6 layers");
  } finally { await db.$disconnect(); }
});
