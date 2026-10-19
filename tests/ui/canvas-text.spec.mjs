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

for (const nextDraft of ["", "下一张画一只狮子"]) test(`canvas clears sent text immediately and preserves the next draft: ${nextDraft || "empty"}`, async ({ page }) => {
  const f = await fixture(page);
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/studio/jobs", async route => {
    if (route.request().method() === "POST") { requests++; await gate; }
    await route.fallback();
  });
  try {
    await openCanvas(page);
    const composer = page.getByLabel("创作描述", { exact: true });
    await composer.fill("生成一只老虎");
    await composer.press("Control+Enter");
    await expect.poll(() => requests).toBe(1);
    await expect(composer).toHaveValue("");
    await expect(page.locator(".ms-message.user")).toHaveText("生成一只老虎");
    if (nextDraft) await composer.fill(nextDraft);
    release();
    await expect(page.locator(".ms-message.assistant img")).toHaveCount(1);
    await expect(composer).toHaveValue(nextDraft);
    await expect.poll(() => f.getDoc().content.composer?.text).toBe(nextDraft);
    await page.reload();
    await expect(composer).toHaveValue(nextDraft);
    expect(requests).toBe(1);
    expect(f.posted).toHaveLength(1);
    expect(f.errors).toEqual([]);
  } finally { release(); }
});

test("canvas restores a rejected submission for retry without duplicating the message or key", async ({ page }) => {
  const f = await fixture(page);
  const keys = [];
  await page.route("**/api/studio/jobs", async route => {
    if (route.request().method() === "POST") {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) return route.fulfill({ status: 503, json: { code: "TEMPORARILY_UNAVAILABLE" } });
    }
    await route.fallback();
  });
  await openCanvas(page);
  const composer = page.getByLabel("创作描述", { exact: true });
  await composer.fill("生成一只老虎");
  await composer.press("Control+Enter");
  await expect(page.locator(".ms-notice")).toContainText("TEMPORARILY_UNAVAILABLE");
  await expect(composer).toHaveValue("生成一只老虎");
  await composer.press("Control+Enter");
  await expect(page.locator(".ms-message.assistant img")).toHaveCount(1);
  await expect(page.locator(".ms-message.user")).toHaveCount(1);
  await expect(composer).toHaveValue("");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(f.posted).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("OCR entry follows live pan, image drag and zoom before pointer release", async ({ page }, info) => {
  const f = await fixture(page, { archivedOcr: true });
  const stage = await openCanvas(page);
  const entry = page.getByRole("button", { name: "查看文字 · 原始图片", exact: true });
  await expect(entry).toBeVisible();
  await expect.poll(async () => (await entry.boundingBox()).x - (await stage.boundingBox()).x).toBeCloseTo(80, 0);
  const start = await entry.boundingBox(), frame = await stage.boundingBox();
  expect(start.width).toBe(28);
  expect(start.x - frame.x).toBeCloseTo(80, 0);
  expect(start.y - frame.y).toBeCloseTo(358, 0);
  await expect(entry.locator("span")).not.toBeVisible();
  await entry.focus();
  await expect(entry.locator("span")).toBeVisible();
  await entry.evaluate(node => node.blur());

  // Middle-button panning changes Konva immediately, before saved camera state.
  await page.mouse.move(frame.x + 480, frame.y + 400);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(frame.x + 560, frame.y + 440, { steps: 8 });
  await expect.poll(async () => (await entry.boundingBox()).x - start.x).toBeCloseTo(80, 0);
  await expect.poll(async () => (await entry.boundingBox()).y - start.y).toBeCloseTo(40, 0);
  expect(f.getDoc().content.layers[0]).toEqual(f.source);
  await page.screenshot({ path: info.outputPath("ocr-follow-pan-held.png") });
  await page.mouse.up({ button: "middle" });
  const panned = await entry.boundingBox();
  await expect.poll(async () => (await entry.boundingBox()).x).toBeCloseTo(panned.x, 0);

  // Moving an image must move its entry without creating document writes per frame.
  await page.mouse.move(panned.x + 90, panned.y - 90);
  await page.mouse.down();
  await page.mouse.move(panned.x + 180, panned.y - 60, { steps: 8 });
  await expect.poll(async () => (await entry.boundingBox()).x - panned.x).toBeCloseTo(90, 0);
  await expect.poll(async () => (await entry.boundingBox()).y - panned.y).toBeCloseTo(30, 0);
  expect(f.getDoc().content.layers[0]).toEqual(f.source);
  await page.mouse.up();
  await expect.poll(() => f.getDoc().content.layers[0].x).toBe(f.source.x + 90);

  const beforeZoom = await entry.boundingBox();
  const pointer = { x: frame.x + 500, y: frame.y + 350 };
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await entry.boundingBox()).x).toBeCloseTo(pointer.x + (beforeZoom.x - pointer.x) * 1.07, 0);
  await expect.poll(async () => (await entry.boundingBox()).y).toBeCloseTo(pointer.y + (beforeZoom.y - 8 - pointer.y) * 1.07 + 8, 0);
  expect((await entry.boundingBox()).width).toBe(28);
  // Resizing uses live node bounds too, while the document still has old sizes.
  const zoomed = await entry.boundingBox();
  await page.mouse.click(zoomed.x + 100, zoomed.y - 100);
  const selection = JSON.parse(await stage.getAttribute("data-selection-frame"));
  const oldWidth = f.getDoc().content.layers[0].width;
  await page.mouse.move(frame.x + selection.left + selection.width + 3, frame.y + selection.top + selection.height + 3);
  await page.mouse.down();
  await page.mouse.move(frame.x + selection.left + selection.width + 35, frame.y + selection.top + selection.height + 27, { steps: 8 });
  await expect.poll(async () => (await entry.boundingBox()).y - zoomed.y).toBeGreaterThan(10);
  expect(f.getDoc().content.layers[0].width).toBe(oldWidth);
  await page.mouse.up();
  await expect.poll(() => f.getDoc().content.layers[0].width).toBeGreaterThan(oldWidth);
  await entry.click();
  await expect(page.getByLabel("第 1 段文字", { exact: true })).toHaveValue("很久之前识别的文字");
  expect(f.posted).toEqual([]);
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
