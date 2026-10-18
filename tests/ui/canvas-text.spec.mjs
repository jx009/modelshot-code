import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { TOOLS, contentSchema } from "../../src/lib/studio/tools.js";
import { chooseImageTool } from "./helpers/image-tool.mjs";

async function fixture(page, { result = null, archivedOcr = false, empty = false } = {}) {
  const png = await sharp({ create: { width: 600, height: 450, channels: 4, background: "#c6a67d" } }).png().toBuffer();
  const source = { id: "source", type: "image", assetId: "source-image", name: "原始图片", x: 60, y: 90, width: 320, height: 240, pixelWidth: 600, pixelHeight: 450, rotation: 0, visible: true, opacity: 1, ...(archivedOcr ? { ocrJobId: "older-ocr" } : {}) };
  let doc = { id: "text-doc", version: 1, name: "画布交互测试", content: { schemaVersion: 1, layers: empty ? [] : [source], messages: [], jobs: [], appliedJobs: [] } };
  let rows = result ? [{ ...result, documentId: doc.id, targetId: source.id }] : [];
  const errors = [], posted = [], saves = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /TypeError|ReferenceError/.test(message.text())) errors.push(message.text()); });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path.startsWith("/api/assets/")) return route.fulfill({ contentType: "image/png", body: png });
    if (path === "/api/auth/session") return reply({ user: { id: "canvas-text-user", name: "Creator", email: "canvas@example.invalid", credits: 500 }, expires: "2099-01-01" });
    if (path === "/api/studio/capabilities") return reply({ imageProvider: "fixture", imageModels: [{ id: "fixture", label: "Fixture", creditCost: 18 }], planningAvailable: true, tools: TOOLS.map(tool => ({ ...tool, available: true })) });
    if (path === "/api/studio/documents" && request.method() === "POST") {
      const body = request.postDataJSON();
      const validated = contentSchema.safeParse(body.content);
      if (!validated.success) { errors.push(validated.error.message); return route.fulfill({ status: 400, json: { code: "INVALID_DOCUMENT" } }); }
      doc = { ...doc, ...body, id: "text-doc", version: doc.version + 1 }; saves.push(doc.content);
      return reply(doc);
    }
    if (path === "/api/studio/documents/text-doc") return reply(doc);
    if (path === "/api/studio/documents/text-doc/view") return reply({ camera: { x: 20, y: 20, scale: 1 } });
    if (path === "/api/studio/documents") return reply([]);
    if (path === "/api/studio/jobs" && request.method() === "POST") {
      const body = request.postDataJSON(); posted.push(body);
      const job = { ...body, id: `submitted-${posted.length}`, status: "succeeded", createdAt: new Date().toISOString(), resultData: body.tool === "describe" ? { text: "自然光下的静物摄影，保持玻璃瓶的材质与通透感。" } : body.tool === "ocr" ? { ocr: { boxes: [{ text: "产品说明", rect: null }] } } : { assets: [{ id: "generated-image", width: 600, height: 450, contentType: "image/png" }] } };
      rows = [job, ...rows]; return reply(job);
    }
    if (path === "/api/studio/jobs") return reply(rows);
    if (path === "/api/studio/jobs/older-ocr") return reply({ id: "older-ocr", documentId: doc.id, targetId: "source", tool: "ocr", status: "succeeded", resultData: { ocr: { boxes: [{ text: "很久之前识别的文字", rect: null }] } } });
    return reply({ items: [], credits: 500 });
  });
  return { errors, posted, saves, getDoc: () => doc, source };
}

async function openCanvas(page, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/zh/studio-v2?document=text-doc");
  if (width < 760) await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(page.getByLabel("创作描述", { exact: true })).toBeEnabled();
  await expect(page.locator(".ms-stage")).toHaveAttribute("data-camera-scale", "1");
  return page.locator(".ms-stage");
}

async function pixel(stage) {
  return stage.locator("canvas").first().evaluate(canvas => {
    const scale = canvas.width / canvas.clientWidth;
    return Array.from(canvas.getContext("2d").getImageData(150 * scale, 180 * scale, 1, 1).data);
  });
}

for (const width of [1440, 390]) test(`double-click writes text in place without losing images or moving the camera at ${width}px`, async ({ page }, info) => {
  const f = await fixture(page);
  const stage = await openCanvas(page, width);
  await expect.poll(() => pixel(stage)).toEqual([198, 166, 125, 255]);
  const originalCamera = await stage.getAttribute("data-camera");
  await expect(page.getByRole("button", { name: "添加文字", exact: true })).toHaveCount(0);
  await stage.dblclick({ position: { x: width < 760 ? 55 : 520, y: 440 } });
  const editor = page.getByRole("textbox", { name: "画布文字", exact: true });
  await expect(editor).toBeFocused();
  const editorBox = await editor.boundingBox();
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(width);
  await editor.fill("这是一段画布文字\n保留原图，记录灵感");
  await editor.dispatchEvent("compositionstart");
  await editor.press("Control+Enter");
  await expect(editor).toBeVisible();
  await editor.dispatchEvent("compositionend");
  await editor.press("Control+Enter");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => f.getDoc().content.layers.length).toBe(2);
  expect(f.getDoc().content.layers[0]).toEqual(f.source);
  expect(await stage.getAttribute("data-camera")).toBe(originalCamera);
  expect(f.errors).toEqual([]);
  await expect(stage.locator("canvas").first()).toBeVisible();
  expect(await pixel(stage)).toEqual([198, 166, 125, 255]);
  await page.screenshot({ path: info.outputPath(`text-canvas-${width}.png`) });

  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => f.getDoc().content.layers.length).toBe(1);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(() => f.getDoc().content.layers.length).toBe(2);
  const text = f.getDoc().content.layers[1], camera = JSON.parse(originalCamera);
  await stage.dblclick({ position: { x: camera.x + text.x * camera.scale + 12, y: camera.y + text.y * camera.scale + 12 } });
  await expect(editor).toHaveValue(text.text);
  await editor.fill("取消这次修改"); await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  expect(f.getDoc().content.layers[1].text).toBe(text.text);
  await page.reload();
  await expect(page.getByLabel("创作描述", { exact: true })).toBeEnabled();
  if (width < 760) await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await expect(page.locator(".ms-layer")).toHaveCount(2);
  expect(f.errors).toEqual([]);
});

test("a prompt result is editable canvas text and enters the composer without submitting", async ({ page }, info) => {
  const prompt = "自然光透过窗户洒在玻璃瓶上，柔和的阴影与留白构图。";
  const f = await fixture(page, { result: { id: "describe-job", tool: "describe", origin: "canvas", status: "succeeded", resultData: { text: prompt } } });
  await openCanvas(page);
  await expect.poll(() => f.getDoc().content.layers.some(layer => layer.text === prompt)).toBe(true);
  await expect(page.locator(".ms-message")).toHaveCount(0);
  await expect(page.locator(".ms-job-list,.ms-task-center")).toHaveCount(0);
  await page.getByLabel("创作描述", { exact: true }).fill("在此基础上改成暖色调：");
  await page.getByRole("button", { name: "作为提示词", exact: true }).click();
  await expect(page.getByLabel("创作描述", { exact: true })).toHaveValue(`在此基础上改成暖色调：\n${prompt}`);
  expect(f.posted).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("canvas-prompt-result.png") });
  await page.reload();
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await page.locator(".ms-layer-select").filter({ hasText: "反推提示词" }).click();
  await expect(page.getByRole("button", { name: "作为提示词", exact: true })).toBeVisible();
  expect(f.errors).toEqual([]);
});

test("toolbar tasks remain on canvas while chat generation keeps its conversation", async ({ page }) => {
  const f = await fixture(page);
  await openCanvas(page);
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await page.locator(".ms-layer-select").filter({ hasText: "原始图片" }).click();
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await chooseImageTool(page, "反推提示词");
  await page.locator(".ms-editor").getByRole("button", { name: /生成/ }).click();
  await expect.poll(() => f.posted.length).toBe(1);
  expect(f.posted[0].origin).toBe("canvas");
  await expect.poll(() => f.getDoc().content.layers.some(layer => layer.textKind === "prompt")).toBe(true);
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await page.locator(".ms-layer-select").filter({ hasText: "反推提示词" }).click();
  await page.getByRole("button", { name: "图层", exact: true }).click();
  await expect(page.getByRole("button", { name: "作为提示词", exact: true })).toBeVisible();
  await expect(page.locator(".ms-message")).toHaveCount(0);
  await page.getByLabel("创作描述", { exact: true }).fill("生成一张森林摄影");
  await page.getByLabel("创作描述", { exact: true }).press("Control+Enter");
  await expect.poll(() => f.posted.length).toBe(2);
  expect(f.posted[1].origin).toBe("chat");
  await expect(page.locator(".ms-message.user")).toHaveCount(1);
  await expect(page.locator(".ms-message.assistant")).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test("saved OCR entry reopens a result older than the recent job list", async ({ page }) => {
  const f = await fixture(page, { archivedOcr: true });
  await openCanvas(page);
  await page.getByRole("button", { name: "查看文字 · 原始图片", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片中的文字" })).toBeVisible();
  await expect(page.getByLabel("第 1 段文字", { exact: true })).toHaveValue("很久之前识别的文字");
  await expect(page.locator(".ms-message")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("double-click blank canvas creates no empty layer when cancelled", async ({ page }) => {
  const f = await fixture(page, { empty: true });
  const stage = await openCanvas(page);
  await stage.dblclick({ position: { x: 120, y: 180 } });
  const editor = page.getByRole("textbox", { name: "画布文字", exact: true });
  await expect(editor).toBeFocused();
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  expect(f.getDoc().content.layers).toEqual([]);
  expect(f.posted).toEqual([]);
  expect(f.errors).toEqual([]);
});
