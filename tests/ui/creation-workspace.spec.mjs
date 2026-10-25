import { test, expect } from "@playwright/test";
import { layoutDocumentSchema, layoutOperationsSchema } from "../../src/lib/creation/contracts/layout.js";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { applyWebOperations } from "../../src/lib/creation/web-operations.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { officeFile } from "../fixtures/creation-office-reference.mjs";
import { writeFile } from "node:fs/promises";
import { htmlDocumentSchema } from "../../src/lib/creation/html/document.js";
import { applyArtworkOperations } from "../../src/lib/creation/artwork-codec.js";

test("HTML poster edits actual DOM, saves, reloads and keeps source clean", async ({ page }, info) => {
  const state = await fixtures(page);
  let revision = 1;
  let artwork = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-poster", kind: "poster", title: "城市咖啡 · 秋日新店", theme: { name: "Coffee", primary: "#234b3b", accent: "#d9a66b", background: "#f7f0df", fontFamily: "sans" }, pages: [{ id: "poster", width: 1080, height: 1440, html: '<!DOCTYPE html><html><head><meta name="vimg-width" content="1080"><meta name="vimg-height" content="1440"><style>body{margin:0;width:1080px;height:1440px;background:#f7f0df;color:#234b3b;font-family:Arial,sans-serif;box-sizing:border-box;padding:90px;display:flex;flex-direction:column;justify-content:space-between}.top{display:flex;justify-content:space-between;font-size:22px;letter-spacing:5px}h1{font-size:126px;line-height:1.1;letter-spacing:-6px;margin:0}.sub{font-size:30px;line-height:1.8;max-width:700px}.disc{width:400px;height:400px;border-radius:50%;background:#d9a66b;margin:30px auto;display:flex;align-items:center;justify-content:center}.cup{width:210px;height:190px;background:#f7f0df;border-radius:15px 15px 90px 90px;box-shadow:20px 20px 0 #234b3b}.foot{border-top:2px solid #234b3b;padding-top:30px;display:flex;justify-content:space-between;font-size:24px}</style></head><body><div class="top" data-node-id="top"><span data-node-id="brand">CITY COFFEE</span><span data-node-id="season">AUTUMN / 2026</span></div><section data-node-id="intro"><h1 data-node-id="headline">让日常，<br>慢下来。</h1><p class="sub" data-node-id="copy">一杯好咖啡，一段属于自己的时间。<br>新店开业，邀你共赴秋日。</p></section><div class="disc" data-node-id="disc"><div class="cup" data-node-id="cup"></div></div><footer class="foot" data-node-id="foot"><span data-node-id="date">11月1日 · 正式开业</span><span data-node-id="address">城市街角 108 号</span></footer></body></html>' }] });
  const respond = json => route => route.fulfill({ json: typeof json === "function" ? json() : json });
  await page.route("**/api/creation/projects/demo", respond(() => ({ id: "demo", kind: "poster", name: artwork.title, sessions: [{ id: "session" }], artifacts: [{ id: "deck", name: artwork.title, kind: "poster", currentRevision: revision }], artifactsNextCursor: null })));
  await page.route("**/api/creation/artifacts/deck", respond(() => ({ id: "deck", revision, content: artwork })));
  await page.route("**/api/creation/artifacts/deck/operations", async route => {
    const body = route.request().postDataJSON();
    if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
    artwork = applyArtworkOperations(artwork, body.operations); revision++;
    return route.fulfill({ json: { artifactId: "deck", revision, baseRevision: body.baseRevision } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/zh/creation?project=demo");
  const frame = page.frameLocator('iframe[title="可编辑作品"]');
  await expect(frame.locator('[data-node-id="date"]')).toHaveText("11月1日 · 正式开业");
  await expect(page.getByRole("button", { name: "模板", exact: true })).toHaveCount(0);
  await frame.locator('[data-node-id="date"]').dblclick();
  await frame.locator('[data-node-id="date"]').fill("11月8日 · 正式开业");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => artwork.pages[0].html).toContain("11月8日");
  expect(artwork.pages[0].html).not.toContain("contenteditable");
  expect(artwork.pages[0].html).not.toContain("data-cw-");
  expect(artwork.pages[0].html).toContain("justify-content:space-between");
  await page.reload();
  await expect(frame.locator('[data-node-id="date"]')).toHaveText("11月8日 · 正式开业");
  for (const [width, height] of [[1920,1080], [1440,900], [1440,720], [1024,768], [390,844]]) {
    await page.setViewportSize({ width, height });
    if (width === 390) await page.getByRole("button", { name: "作品", exact: true }).click();
    await expect(frame.locator('[data-node-id="date"]')).toBeVisible();
    const stage = await page.locator(".cw-html-stage").boundingBox();
    expect(stage.height).toBeGreaterThan(height * .65);
    expect(await page.locator(".cw-workspace").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`html-poster-${width}x${height}.png`) });
  }
  // Playwright init scripts are deliberately denied inside the scriptless edit frame.
  expect(state.errors.filter(error => !error.includes("favicon") && !error.startsWith("Blocked script execution in "))).toEqual([]);
});

const content = layoutDocumentSchema.parse({ schemaVersion: 1, kind: "slides", title: "城市咖啡 · 品牌发布方案",
  theme: { name: "Coffee", primary: "#33443b", accent: "#cb985e", background: "#faf7ef", fontFamily: "sans" },
  pages: Array.from({ length: 4 }, (_, index) => ({ id: `page-${index}`, title: ["品牌故事", "产品定位", "门店体验", "推广计划"][index], width: 1920, height: 1080, background: "#faf7ef", nodes: [
    { id: "accent", name: "Accent", type: "shape", shape: "rectangle", x: 140, y: 170, width: 80, height: 8, fill: "#cb985e" },
    { id: "title", name: "标题", type: "text", x: 140, y: 270, width: 1500, height: 160, text: index === 0 ? "每一杯，都值得慢下来。" : ["", "用好咖啡连接城市", "为日常留出一点空白", "让品牌被更多人看见"][index], style: { fontSize: 88, fill: "#33443b", fontWeight: "bold" } },
    { id: "subtitle", name: "副标题", type: "text", x: 145, y: 510, width: 1300, height: 150, text: "CITY COFFEE / 2026\n品牌发布与增长计划", style: { fontSize: 32, fill: "#6e766d", lineHeight: 1.6 } },
  ] })),
});

async function fixtures(page, office = null, beforeNativeSave = null) {
  const calls = [], errors = [], scripts = [], saves = [], saveAttempts = [];
  let nativeContent = office, nativeRevision = 1;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem("theme", "light");
    window.creationWorkerCounts = { started: 0, terminated: 0 };
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      constructor(url, options) {
        super(url, options);
        this.creationFormula = options?.name === "creation-formula";
        if (this.creationFormula) window.creationWorkerCounts.started++;
      }
      terminate() {
        if (this.creationFormula) { window.creationWorkerCounts.terminated++; this.creationFormula = false; }
        super.terminate();
      }
    };
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    calls.push({ path, q: url.searchParams.get("q"), method: route.request().method() });
    const reply = json => route.fulfill({ json });
    if (path === "/api/auth/session") return reply({ user: { id: "creation-ui-user", name: "创作测试", email: "creation@example.invalid", credits: 500 }, expires: "2099-01-01T00:00:00Z" });
    if (path === "/api/creation/capabilities") return reply({ slides: true, poster: true, document: true, sheet: true, web: true, languageUnitCost: 2 });
    if (path === "/api/creation/project-library") return reply({ items: [{ id: "demo", source: "creation", name: office?.title || content.title, kind: office?.kind || "slides", updatedAt: "2026-10-24T00:00:00Z" }], nextCursor: null });
    if (path === "/api/creation/projects/demo") return reply({ id: "demo", name: office?.title || content.title, kind: office?.kind || "slides", sessions: [{ id: "session" }], artifacts: [{ id: "deck", name: office?.title || content.title, kind: office?.kind || "slides", currentRevision: nativeRevision }], artifactsNextCursor: null });
    if (path === "/api/creation/sessions/session/messages") return reply({ items: [
      { id: "m1", role: "user", text: office ? `帮我准备城市咖啡的${office.title}，方便后续编辑。` : "帮我制作一份城市咖啡的品牌发布方案，暖白底色，墨绿标题，文字可编辑。", references: [] },
      { id: "m2", role: "assistant", text: office ? "作品已生成，可以在右侧编辑，或选择需要修改的内容继续对话。" : "演示文稿已生成，共 4 页。你可以在右侧调整文字、版式，或选择需要修改的内容继续对话。", references: [{ type: "artifact", artifactId: "deck", revision: 1 }] },
    ], nextCursor: null });
    if (path === "/api/creation/artifacts/deck") return reply({ id: "deck", revision: 1, content });
    if (path === "/api/creation/artifacts/deck/format") return reply({ id: "deck", kind: office.kind, schemaVersion: 2, canReferenceNative: true });
    if (path === "/api/creation/artifacts/deck/native") {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        saveAttempts.push(body);
        const failure = await beforeNativeSave?.(body);
        if (failure) return route.fulfill(failure);
        if (body.baseRevision !== nativeRevision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
        nativeContent = body.content; nativeRevision++; saves.push(body);
        return reply({ artifactId: "deck", baseRevision: body.baseRevision, revision: nativeRevision });
      }
      return reply({ id: "deck", revision: nativeRevision, content: nativeContent });
    }
    if (path === "/api/creation/projects/demo/files") return reply({ items: url.searchParams.get("q") === "不存在" ? [] : [{ id: "deck", name: office?.title || content.title, kind: office?.kind || "slides", currentRevision: nativeRevision }], nextCursor: null });
    if (path === "/api/studio/capabilities") return reply({ imageModels: [{ id: "fixture", label: "测试模型", creditCost: 10 }], imageProvider: "fixture", tools: [] });
    if (path === "/api/inspiration") return reply({ items: [], layout: { mode: "masonry", columns: 4, gap: 16 } });
    if (path === "/api/studio/jobs" || path === "/api/library/categories") return reply([]);
    return reply({ items: [], nextCursor: null, credits: 500, products: [], paymentsEnabled: false });
  });
  return { calls, errors, scripts, saves, saveAttempts };
}

test("legacy object poster remains editable without a template workflow", async ({ page }, info) => {
  const observed = await fixtures(page);
  let current = layoutDocumentSchema.parse({ ...content, kind: "poster", pages: [{ ...content.pages[0], width: 1080, height: 1440 }] }), revision = 1;
  const original = structuredClone(current), saves = [];
  await page.route("**/api/creation/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/creation/projects/demo") return route.fulfill({ json: { id: "demo", name: current.title, kind: "poster", sessions: [{ id: "session" }], artifacts: [{ id: "deck", name: current.title, kind: "poster", currentRevision: revision }], artifactsNextCursor: null } });
    if (path === "/api/creation/artifacts/deck") return route.fulfill({ json: { id: "deck", revision, content: current } });
    if (path === "/api/creation/artifacts/deck/operations") {
      const body = route.request().postDataJSON();
      if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
      current = layoutDocumentSchema.parse(applyLayoutOperations(current, layoutOperationsSchema.parse(body.operations)));
      saves.push(body); revision++;
      return route.fulfill({ json: { artifactId: "deck", revision, baseRevision: revision - 1 } });
    }
    return route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-layout-canvas canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "模板", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "作品属性", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("legacy-poster-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".cw-layout-canvas canvas").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("legacy-poster-mobile.png") });
  expect(await page.locator(".cw-workspace").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "作品属性", exact: true }).click();
  const layers = page.locator("details").filter({ has: page.locator("summary", { hasText: /图层 ·/ }) });
  await layers.locator("summary").click();
  await layers.getByRole("button", { name: "title", exact: true }).click();
  await page.getByRole("textbox", { name: "内容", exact: true }).fill("旧版海报仍可编辑");
  await expect.poll(() => saves.length).toBe(1);
  expect(current.pages[0].nodes.some(node => node.text === "旧版海报仍可编辑")).toBe(true);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(current).toEqual(original);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(() => saves.length).toBe(3);
  const applied = structuredClone(current);
  await page.reload();
  await expect(page.locator(".cw-layout-canvas canvas").first()).toBeVisible();
  expect(current).toEqual(applied);
  await page.getByRole("textbox", { name: "内容", exact: true }).fill("重新打开后仍能修改");
  await expect.poll(() => saves.length).toBe(4);
  expect(current.pages[0].nodes.some(node => node.text === "重新打开后仍能修改")).toBe(true);
  expect(observed.errors).toEqual([]);
});

test("PPT workspace keeps usable canvas space, searchable files and mobile views", async ({ page }, info) => {
  const observed = await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-layout-canvas canvas").first()).toBeVisible();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  await expect(page.locator(".site-nav")).toHaveCount(0);
  await expect(page.locator(".cw-slide-thumbnail img").first()).toBeVisible();
  await expect(page.getByRole("complementary", { name: "作品属性" })).toHaveCount(0);
  const prompt = page.getByRole("textbox", { name: "创作需求" });
  expect((await prompt.boundingBox()).height).toBeLessThanOrEqual(60);
  await prompt.fill("修改要求\n".repeat(40));
  expect((await prompt.boundingBox()).height).toBeLessThanOrEqual(134);
  await prompt.fill("");
  expect((await prompt.boundingBox()).height).toBeLessThanOrEqual(60);
  await page.screenshot({ path: info.outputPath("workspace-1440.png") });
  const originalCanvas = await page.locator(".cw-layout-canvas canvas").first().elementHandle();
  const artworkBeforeFocus = await page.locator(".cw-artwork-area").boundingBox();
  const readsBeforeFocus = observed.calls.filter(call => call.path === "/api/creation/artifacts/deck").length;
  await prompt.fill("保留这段未发送的修改要求");
  await page.getByRole("button", { name: "收起创作对话", exact: true }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(async () => (await page.locator(".cw-artwork-area").boundingBox()).width).toBeGreaterThan(artworkBeforeFocus.width + 290);
  expect(await originalCanvas.evaluate(element => element.isConnected)).toBe(true);
  await page.screenshot({ path: info.outputPath("workspace-focused-1440.png") });
  await page.getByRole("button", { name: "展开创作对话", exact: true }).click();
  await expect(prompt).toHaveValue("保留这段未发送的修改要求");
  expect(observed.calls.filter(call => call.path === "/api/creation/artifacts/deck").length).toBe(readsBeforeFocus);
  await prompt.fill("");
  await originalCanvas.dispose();
  const separator = page.getByRole("separator");
  await separator.focus(); await separator.press("End");
  const artwork = page.locator(".cw-artwork-area"), canvas = page.locator(".cw-layout-canvas");
  const narrow = await artwork.boundingBox();
  if (narrow.width <= 800) {
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(narrow.width - 8);
    expect(box.height).toBeGreaterThan(200);
  }
  await page.screenshot({ path: info.outputPath("workspace-chat-expanded.png") });
  const filesReadBefore = observed.calls.filter(call => call.path.endsWith("/files")).length;
  await page.getByRole("button", { name: "展开文件列表" }).click();
  await page.getByRole("searchbox", { name: "文件名" }).fill("不存在");
  expect(observed.calls.filter(call => call.path.endsWith("/files"))).toHaveLength(filesReadBefore);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有匹配的文件")).toBeVisible();
  await expect(canvas.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "清除文件搜索" }).click();
  await expect(page.locator(".cw-file-items button")).toHaveCount(1);
  await page.getByRole("button", { name: "收起文件列表" }).click();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await page.getByRole("button", { name: "作品", exact: true }).click();
      await expect(page.locator(".cw-file-tree")).toHaveCount(0);
      await page.getByRole("button", { name: "展开文件列表" }).click();
      await expect(page.getByRole("searchbox", { name: "文件名" })).toBeVisible();
      await page.getByRole("button", { name: "收起文件列表" }).click();
    }
    await expect(canvas.locator("canvas").first()).toBeVisible();
    const area = await artwork.boundingBox(), box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(area.width - 8);
    expect(await page.locator(".cw-workspace").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`) });
  }
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "创作需求" })).toBeVisible();
  expect(observed.errors).toEqual([]);
  expect(observed.calls.some(call => call.method !== "GET")).toBe(false);
});

test("theme bindings survive palette changes, custom edits, undo and saved reopen", async ({ page }, info) => {
  const observed = await fixtures(page), writes = [];
  let saved = structuredClone(content), revision = 1;
  await page.route("**/api/creation/artifacts/deck", route => route.fulfill({ json: { id: "deck", revision, content: saved } }));
  await page.route("**/api/creation/artifacts/deck/operations", route => {
    const body = route.request().postDataJSON();
    if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
    saved = layoutDocumentSchema.parse(applyLayoutOperations(saved, layoutOperationsSchema.parse(body.operations)));
    writes.push(body); revision++;
    return route.fulfill({ json: { revision } });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  await page.getByRole("button", { name: "作品属性", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "作品属性" });
  const selectTitle = async () => {
    if (!await inspector.isVisible()) await page.getByRole("button", { name: "作品属性", exact: true }).click();
    await inspector.locator("summary").filter({ hasText: "图层" }).click();
    await inspector.getByRole("button", { name: "标题", exact: true }).click();
  };
  await selectTitle();
  const source = inspector.getByLabel("文字配色来源"), paint = inspector.getByLabel("文字颜色", { exact: true });
  await source.selectOption("accent"); await expect(paint).toHaveValue("#cb985e");
  const theme = async name => {
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "应用到整个作品", exact: true }).click();
  };
  await theme("暖调咖啡"); await expect(paint).toHaveValue("#b87940");
  await paint.fill("#35251b"); await expect(source).toHaveValue("custom");
  await theme("森林"); await expect(paint).toHaveValue("#35251b");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(source).toHaveValue("custom");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(source).toHaveValue("accent"); await expect(paint).toHaveValue("#b87940");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByTitle("保存作品", { exact: true }).click();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  expect(writes.length).toBeGreaterThan(0);
  expect(saved.pages[0].nodes[1].style).toMatchObject({ fill: "#35251b", fillRole: "custom" });
  expect(saved.pages[0].nodes[1].x).toBe(content.pages[0].nodes[1].x);
  await page.reload(); await expect(page.locator(".cw-save-state")).toContainText("已保存");
  await selectTitle(); await expect(source).toHaveValue("custom"); await expect(paint).toHaveValue("#35251b");
  await source.selectOption("primary"); await expect(paint).toHaveValue("#163d32");
  await page.getByTitle("保存作品", { exact: true }).click();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  await source.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("theme-binding-desktop.png") });
  expect(saved.pages[0].nodes[1].style.fillRole).toBe("primary");
  // Changing pages reuses the canvas but must commit text to the old page,
  // even when both pages have an object named "title".
  const canvas = page.locator(".cw-layout-canvas"), box = await canvas.boundingBox();
  const scale = Math.min((box.width - 80) / 1920, (box.height - 80) / 1080);
  await canvas.dblclick({ position: { x: (box.width - 1920 * scale) / 2 + 400 * scale, y: (box.height - 1080 * scale) / 2 + 330 * scale } });
  const textInput = page.getByRole("textbox", { name: "编辑选中文字 / Edit selected text" });
  await expect(textInput).toBeVisible(); await textInput.fill("只修改第一页标题");
  await page.locator('[data-slide-id="page-1"]').click();
  await expect(textInput).toHaveCount(0);
  await page.getByTitle("保存作品", { exact: true }).click();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  expect(saved.pages[0].nodes[1].text).toBe("只修改第一页标题");
  expect(saved.pages[1].nodes[1].text).toBe(content.pages[1].nodes[1].text);
  expect(observed.errors).toEqual([]);
});

test("native text and rectangle nodes preserve frame picking, drag, resize, lock and undo", async ({ page }, info) => {
  const observed = await fixtures(page);
  let saved = layoutDocumentSchema.parse({ ...content, pages: [{ ...content.pages[0], nodes: [
    { id: "title", name: "标题", type: "text", x: 200, y: 180, width: 600, height: 180, text: "测试文字", style: { fontSize: 64, fill: "#33443b" } },
    { id: "rect", name: "透明矩形", type: "shape", shape: "rectangle", x: 1000, y: 580, width: 320, height: 200, fill: "#00000000", stroke: "#cb985e", strokeWidth: 4, radius: 20 },
    { id: "ellipse", name: "圆形", type: "shape", shape: "ellipse", x: 200, y: 650, width: 200, height: 200, fill: "#cb985e" },
  ] }] }), revision = 1;
  await page.route("**/api/creation/artifacts/deck", route => route.fulfill({ json: { id: "deck", revision, content: saved } }));
  await page.route("**/api/creation/artifacts/deck/operations", route => {
    const body = route.request().postDataJSON();
    if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
    saved = layoutDocumentSchema.parse(applyLayoutOperations(saved, layoutOperationsSchema.parse(body.operations))); revision++;
    return route.fulfill({ json: { revision } });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  const canvas = page.locator(".cw-layout-canvas"), inspector = page.getByRole("complementary", { name: "作品属性" });
  await expect(canvas.locator("canvas")).toBeVisible();
  const point = async (x, y) => {
    const box = await canvas.boundingBox(), scale = Math.min((box.width - 80) / 1920, (box.height - 80) / 1080);
    return { x: box.x + (box.width - 1920 * scale) / 2 + x * scale, y: box.y + (box.height - 1080 * scale) / 2 + y * scale, scale };
  };
  const clickAt = async (x, y) => { const p = await point(x, y); await page.mouse.click(p.x, p.y); };
  const drag = async (x, y, dx, dy) => {
    const p = await point(x, y), startX = Math.round(p.x), startY = Math.round(p.y);
    const endX = Math.round(p.x + dx * p.scale), endY = Math.round(p.y + dy * p.scale);
    await page.mouse.move(startX, startY); await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 }); await page.mouse.up();
    return { dx: (endX - startX) / p.scale, dy: (endY - startY) / p.scale };
  };
  const save = async () => { await page.getByTitle("保存作品", { exact: true }).click(); await expect(page.locator(".cw-save-state")).toContainText("已保存"); };
  // Empty space below/beyond the glyphs remains selectable as an object frame.
  await clickAt(760, 330); await expect(inspector.locator("header")).toHaveText("标题");
  const textDelta = await drag(760, 330, 80, 40);
  await expect.poll(async () => Number(await inspector.getByLabel("X", { exact: true }).inputValue())).toBeCloseTo(200 + textDelta.dx, 1);
  await expect.poll(async () => Number(await inspector.getByLabel("Y", { exact: true }).inputValue())).toBeCloseTo(180 + textDelta.dy, 1);
  await save(); expect(saved.pages[0].nodes[0].x).toBeCloseTo(200 + textDelta.dx, 4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(inspector.getByLabel("X", { exact: true })).toHaveValue("200");
  // Resize the bottom-right Transformer anchor. Text remains editable text.
  await drag(800, 360, 120, 36);
  await save(); expect(saved.pages[0].nodes[0].width).toBeGreaterThan(650);
  expect(saved.pages[0].nodes[0].text).toBe("测试文字");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(inspector.getByLabel("宽", { exact: true })).toHaveValue("600");
  // A transparent rounded rectangle retains a full-frame hit area.
  await clickAt(1160, 680); await expect(inspector.locator("header")).toHaveText("透明矩形");
  const rectDelta = await drag(1160, 680, 80, -40); await save();
  expect(saved.pages[0].nodes[1].x).toBeCloseTo(1000 + rectDelta.dx, 4);
  expect(saved.pages[0].nodes[1].y).toBeCloseTo(580 + rectDelta.dy, 4);
  await inspector.getByRole("button", { name: "锁定", exact: true }).click();
  await drag(1240, 640, 80, 80); await save();
  expect(saved.pages[0].nodes[1]).toMatchObject({ locked: true, fill: "#00000000", radius: 20 });
  expect(saved.pages[0].nodes[1].x).toBeCloseTo(1000 + rectDelta.dx, 4);
  await inspector.getByRole("button", { name: "解锁", exact: true }).click();
  await inspector.getByLabel("旋转", { exact: true }).fill("30"); await save();
  expect(saved.pages[0].nodes[1].rotation).toBe(30);
  await clickAt(300, 750); await expect(inspector.locator("header")).toHaveText("圆形");
  const ellipseDelta = await drag(300, 750, 40, 0); await save(); expect(saved.pages[0].nodes[2].x).toBeCloseTo(200 + ellipseDelta.dx, 4);
  await page.screenshot({ path: info.outputPath("native-node-gestures.png") });
  expect(observed.errors).toEqual([]);
});

test("30-slide 100-object fixture records theme and page interaction cost without mounting every canvas", async ({ page }, info) => {
  const observed = await fixtures(page);
  let saved = layoutDocumentSchema.parse({ ...content, pages: Array.from({ length: 30 }, (_, index) => ({ ...content.pages[index % 4], id: `sample-${index}`, title: `页面 ${index + 1}`, backgroundRole: "background", nodes: [
    { ...content.pages[0].nodes[1], style: { ...content.pages[0].nodes[1].style, fillRole: "primary", fontRole: "theme" } },
    ...Array.from({ length: 99 }, (_, n) => ({ ...content.pages[0].nodes[0], id: `shape-${n}`, x: 140 + n % 11 * 130, y: 500 + Math.floor(n / 11) * 40, width: 70, height: 18, fillRole: "accent" })),
  ] })) }), revision = 1;
  await page.route("**/api/creation/artifacts/deck", route => route.fulfill({ json: { id: "deck", revision, content: saved } }));
  await page.route("**/api/creation/artifacts/deck/operations", route => {
    const body = route.request().postDataJSON();
    if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
    saved = layoutDocumentSchema.parse(applyLayoutOperations(saved, layoutOperationsSchema.parse(body.operations))); revision++;
    return route.fulfill({ json: { revision } });
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-layout-canvas canvas").first()).toBeVisible();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  await expect(page.locator(".cw-slide-thumbnail img").first()).toBeVisible();
  await page.evaluate(() => {
    window.creationMeasurements = { since: performance.now(), longTasks: [], heapBefore: performance.memory?.usedJSHeapSize || null };
    window.creationInitialCanvas = document.querySelector(".cw-layout-canvas canvas");
    window.creationObserver = new PerformanceObserver(list => { window.creationMeasurements.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration }))); });
    window.creationObserver.observe({ type: "longtask" });
  });
  const toPaint = async locator => locator.evaluate(element => new Promise(resolve => {
    const start = performance.now(); element.click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
  }));
  const themeMs = [], pageMs = [];
  for (const name of ["暖调咖啡", "森林", "暗夜紫"]) {
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    themeMs.push(await toPaint(page.getByRole("button", { name: "应用到整个作品", exact: true })));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const profiler = process.env.CREATION_UI_PROFILE === "true" ? await page.context().newCDPSession(page) : null;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  for (let index = 1; index <= 20; index++) {
    const target = page.locator(`[data-slide-id="sample-${index}"]`);
    pageMs.push(await toPaint(target));
    await expect(target).toHaveAttribute("aria-current", "page");
  }
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    await writeFile(info.outputPath("layout-page-switch.cpuprofile"), JSON.stringify(profile));
    await profiler.detach();
  }
  await page.getByTitle("保存作品", { exact: true }).click();
  await expect(page.locator(".cw-save-state")).toContainText("已保存");
  const browserMetrics = await page.evaluate(() => {
    window.creationMeasurements.longTasks.push(...window.creationObserver.takeRecords().map(entry => ({ startTime: entry.startTime, duration: entry.duration })));
    window.creationObserver.disconnect();
    return { ...window.creationMeasurements, heapAfter: performance.memory?.usedJSHeapSize || null, reusedCanvas: window.creationInitialCanvas === document.querySelector(".cw-layout-canvas canvas"), mountedCanvases: document.querySelectorAll(".cw-layout-canvas canvas").length, thumbnails: document.querySelectorAll(".cw-slide-thumbnail img").length, browser: navigator.userAgent };
  });
  const sorted = [...pageMs].sort((a, b) => a - b);
  const report = { mode: "local Next development, mocked API, no CPU/network throttle; diagnostic, not production baseline or INP", profiled: Boolean(profiler), pages: 30, nodesPerPage: 100, themeMs, pageMs, pageP95Ms: sorted[Math.ceil(sorted.length * .95) - 1], ...browserMetrics };
  await writeFile(info.outputPath("layout-interaction-metrics.json"), JSON.stringify(report, null, 2));
  expect(browserMetrics.mountedCanvases).toBe(1);
  expect(browserMetrics.reusedCanvas).toBe(true);
  expect(browserMetrics.thumbnails).toBeLessThan(30);
  expect(saved.pages).toHaveLength(30); expect(saved.pages[29].nodes[0].style.fillRole).toBe("primary");
  expect(observed.errors).toEqual([]);
});

test("Office references upload once, offer original download links and are reused on desktop and mobile", async ({ page }, info) => {
  const observed = await fixtures(page), posts = [], submissions = [];
  const bytes = await officeFile("docx");
  const item = { id: "brief", name: "城市咖啡品牌资料.docx", fileType: "docx", bytes: bytes.length, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  await page.route("**/api/creation/sessions/session/references", route => {
    if (route.request().method() === "POST") { posts.push(route.request().postDataBuffer()); return route.fulfill({ json: { item } }); }
    return route.fulfill({ json: { items: posts.length ? [item] : [], officeEnabled: true } });
  });
  await page.route("**/api/creation/sessions/session/messages", route => {
    if (route.request().method() !== "POST") return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "reference-run" } });
  });
  await page.route("**/api/creation/runs/reference-run", route => route.fulfill({ json: { id: "reference-run", status: "succeeded", eventSequence: 1, steps: [], input: {}, maxCredits: 22, committedCredits: 0 } }));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/creation?project=demo");
  const upload = page.getByLabel("上传参考文档", { exact: true });
  await expect(upload).toHaveAttribute("accept", /\.docx/);
  await upload.setInputFiles({ name: item.name, mimeType: item.contentType, buffer: bytes });
  const download = page.getByRole("link", { name: `下载原文件 ${item.name}` });
  await expect(download).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0].includes(bytes)).toBe(true);
  // Chromium's download attribute bypasses Playwright route interception in
  // this environment. Verify the link here; authenticated bytes/headers are
  // checked in creation-reference-download.test.mjs without a live database.
  await expect(download).toHaveAttribute("href", "/api/creation/sessions/session/references/brief");
  await expect(download).toHaveAttribute("download", "");
  await page.screenshot({ path: info.outputPath("office-reference-desktop.png") });
  await page.getByRole("button", { name: "移除参考文件 1" }).click();
  await expect(download).toHaveCount(0);
  await page.getByText("已上传的文档", { exact: true }).click();
  await page.getByRole("button", { name: `引用 ${item.name}` }).click();
  await expect(download).toBeVisible(); expect(posts).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(download).toBeVisible();
  expect(await page.locator(".cw-workspace").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("office-reference-mobile.png") });
  await page.getByRole("textbox", { name: "创作需求" }).fill("根据品牌资料整理发布方案");
  await page.getByRole("button", { name: "开始创作", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].referenceIds).toEqual(["brief"]);
  await expect(page.getByRole("textbox", { name: "创作需求" })).toHaveValue("");
  expect(observed.scripts.filter(url => /office-text|office-zip|saxes|office-child/i.test(url))).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test("home type selection defers editors and project creation until submission", async ({ page }, info) => {
  const observed = await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh");
  await expect(page.getByRole("button", { name: "海报设计", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "演示文稿", exact: true }).click();
  await expect(page.locator(".cr-creation-launcher")).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-ppt-selected.png") });
  expect(observed.calls.some(call => call.method !== "GET" || /\/artifacts\//.test(call.path))).toBe(false);
  expect(observed.scripts.filter(url => /univer|layout-canvas|native-office-runtime/i.test(url))).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test.describe("inert website frames", () => {
test.use({ serviceWorkers: "allow" }); // Playwright's block shim reads a forbidden property in opaque frames.
test("website preview fits the workspace and preserves viewport, selection and draft through inspector resizing", async ({ page }, info) => {
  let saved = webSchema.parse({ schemaVersion: 1, kind: "web", title: "城市咖啡官网", entryPath: "index.html", theme: { primary: "#33443b", accent: "#cb985e", background: "#faf7ef", fontFamily: "sans" }, files: [
    { id: "home", path: "index.html", kind: "html", content: '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main><h1>每一杯，都值得慢下来。</h1><p>城市咖啡 / CITY COFFEE</p></main></body></html>' },
    { id: "css", path: "style.css", kind: "css", content: 'body{margin:0;background:#faf7ef;color:#33443b;font-family:sans-serif}main{padding:8vw}h1{font-size:4vw}p{font-size:2vw}@media(max-width:500px){h1{font-size:28px}p{font-size:16px}}' },
  ] }), revision = 1;
  const observed = await fixtures(page, saved);
  await page.route("**/api/creation/artifacts/deck/web", route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      if (body.baseRevision !== revision) return route.fulfill({ status: 409, json: { code: "ARTIFACT_VERSION_CONFLICT" } });
      saved = applyWebOperations(saved, body.operations); revision++;
      return route.fulfill({ json: { revision } });
    }
    return route.fulfill({ json: { id: "deck", revision, content: saved } });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/creation?project=demo");
  const preview = page.getByTitle("网页预览", { exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("sandbox", "");
  await expect(preview).not.toHaveAttribute("srcdoc", /<script\b/i);
  await expect.poll(() => page.frameLocator('iframe[title="网页预览"]').locator("body").evaluate(() => window.innerWidth)).toBe(1440);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByRole("button", { name: "作品", exact: true }).click();
    await expect.poll(async () => {
      const area = await page.locator(".cw-web-preview").boundingBox(), frame = await preview.boundingBox();
      return frame.width <= area.width + 1 && frame.height <= area.height + 1 && frame.height > 200;
    }).toBe(true);
    expect(await page.locator(".cw-workspace").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`web-fit-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "可视化", exact: true }).click();
  const visual = page.getByTitle("网页可视化编辑", { exact: true });
  await expect(visual).toBeVisible();
  await expect(page.getByRole("complementary", { name: "元素属性" })).toHaveCount(0);
  await page.frameLocator('iframe[title="网页可视化编辑"]').locator("h1").click();
  await page.getByRole("textbox", { name: "元素文字", exact: true }).fill("城市咖啡，新店开业");
  await page.getByRole("button", { name: "收起元素属性", exact: true }).click();
  await page.getByRole("button", { name: "展开元素属性", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "元素文字", exact: true })).toHaveValue("城市咖啡，新店开业");
  await page.getByRole("button", { name: "应用修改", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved.files[0].content).toContain("城市咖啡，新店开业");
  // Chromium reports the test runner's injected frame scripts as blocked.
  // Keep every product error visible and verify the inert document above.
  expect(observed.errors.filter(error => error !== "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.")).toEqual([]);
});
});

for (const kind of ["document", "sheet"]) test(`native ${kind} initializes its real engine in the workspace`, async ({ page }, info) => {
  const native = kind === "document" ? toNativeDocumentArtifact({ schemaVersion: 1, kind, title: "品牌发布计划", sections: [{ id: "section", title: "品牌概述", blocks: [
    { id: "heading", type: "heading", level: 1, runs: [{ text: "城市咖啡品牌发布计划", marks: {} }] },
    { id: "paragraph", type: "paragraph", runs: [{ text: "以一杯好咖啡连接日常生活，打造温暖、有品质的城市空间。", marks: {} }] },
  ] }] }, "native-document") : toNativeSheetArtifact({ schemaVersion: 1, kind, title: "发布预算", sheets: [{ id: "budget", name: "预算", cells: [
    { address: "A1", value: "项目", style: { bold: true } }, { address: "B1", value: "预算", style: { bold: true } },
    { address: "A2", value: "视觉设计" }, { address: "B2", value: 3000 }, { address: "A3", value: "活动物料" }, { address: "B3", value: 2000 },
    { address: "A4", value: "合计" }, { address: "B4", formula: "=SUM(B2:B3)" },
  ].map(cell => ({ ...cell, id: `cell-${cell.address}` })) }] }, "native-sheet");
  const observed = await fixtures(page, native);
  await page.setViewportSize({ width: 1660, height: 1000 });
  await page.goto("/zh/creation?project=demo");
  await expect(page.locator(".cw-native-toolbar").getByRole("button", { name: "保存", exact: true })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator(".cw-native-office canvas").first()).toBeVisible();
  await expect(page.locator('.cw-native-office [data-u-comp="workbench-skeleton-content"]')).toHaveCount(0);
  await expect(page.locator(".cw-native-office button").first()).toBeVisible();
  await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText("已保存", { timeout: 5000 });
  // Observe a complete 5-second autosave interval after real engine readiness.
  const unexpectedWrite = await page.waitForRequest(request => request.method() === "PUT", { timeout: 5500 }).catch(error => {
    if (error.name !== "TimeoutError") throw error;
    return null;
  });
  expect(unexpectedWrite).toBeNull();
  await page.screenshot({ path: info.outputPath(`native-${kind}.png`) });
  expect(observed.errors).toEqual([]);
  expect(observed.calls.some(call => call.method !== "GET")).toBe(false);
  if (kind === "sheet") {
    const address = page.locator('.cw-native-office [data-u-comp="defined-name"] input');
    await address.fill("B2"); await address.press("Enter");
    await page.keyboard.press("F2");
    await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText("输入待确认");
    await page.keyboard.press("Control+A"); await page.keyboard.insertText("4200"); await page.keyboard.press("Enter");
  } else {
    await page.locator('.cw-native-office [data-u-comp="editor"][contenteditable="true"]').first().focus();
    await page.keyboard.insertText("测试修改：");
  }
  await expect(page.locator(".cw-native-toolbar").getByRole("status")).not.toContainText("已保存");
  await page.locator(".cw-native-toolbar").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText("已保存 · V2");
  expect(observed.saves).toHaveLength(1);
  const snapshot = observed.saves[0].content.snapshot;
  if (kind === "sheet") {
    expect(snapshot.sheets.sheet0.cellData[1][1].v).toBe(4200);
    expect(snapshot.sheets.sheet0.cellData[3][1].f).toBe("=SUM(B2:B3)");
  } else expect(snapshot.body.dataStream).toContain("测试修改：");
  await page.getByRole("link", { name: "创作首页", exact: true }).click();
  await expect(page.getByRole("button", { name: "图片创作", exact: true })).toBeVisible();
  await expect(page.locator(".cr-home-composer")).toHaveCSS("opacity", "1");
  await expect(page.locator(".cw-native-office")).not.toBeVisible();
  if (kind === "sheet") {
    const workers = await page.evaluate(() => window.creationWorkerCounts);
    expect(workers.started).toBeGreaterThan(0); expect(workers.terminated).toBe(workers.started);
  }
  await page.screenshot({ path: info.outputPath(`home-after-${kind}.png`) });
  await page.evaluate(() => history.back());
  await expect(page.locator(".cw-native-office button").first()).toBeVisible();
  await expect(page.locator('.cw-native-office [data-u-comp="workbench-skeleton-content"]')).toHaveCount(0);
  await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText("已保存 · V2");
  if (kind === "sheet") {
    const address = page.locator('.cw-native-office [data-u-comp="defined-name"] input');
    await address.fill("B2"); await address.press("Enter"); await page.keyboard.press("F2");
    await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText("输入待确认");
    await page.evaluate(() => history.forward());
    await expect(page.locator(".cw-error").first()).toContainText("请先按 Enter");
    await expect(page).toHaveURL(/\/zh\/creation\?project=demo$/);
    await expect(page.locator(".cw-workspace")).not.toHaveAttribute("inert", "");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cw-native-toolbar").getByRole("status")).not.toContainText("输入待确认");
    await page.goForward({ waitUntil: "commit" }).catch(error => {
      if (!/ERR_ABORTED/.test(error.message)) throw error;
    });
    await expect(page).toHaveURL(/\/zh$/);
    const workers = await page.evaluate(() => window.creationWorkerCounts);
    expect(workers.started).toBe(workers.terminated);
  }
  expect(observed.errors).toEqual([]);
});

test("browser Back and Forward preserve native edits across delayed saves, failure and remount", async ({ page }, info) => {
  const native = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "历史导航保存验证", sections: [{ id: "section", title: "计划", blocks: [
    { id: "paragraph", type: "paragraph", runs: [{ text: "原始文档内容。", marks: {} }] },
  ] }] }, "history-document");
  let releaseSave;
  const observed = await fixtures(page, native, () => new Promise(resolve => { releaseSave = resolve; }));
  await page.setViewportSize({ width: 1660, height: 1000 });
  await page.goto("/zh/projects");
  const initialEntry = await page.evaluate(() => navigation.currentEntry.key);
  await page.getByRole("link", { name: native.title, exact: true }).click();
  const ready = async revision => {
    await expect(page.locator('.cw-native-office [data-u-comp="workbench-skeleton-content"]')).toHaveCount(0);
    await expect(page.locator(".cw-native-office button").first()).toBeVisible();
    await expect(page.locator(".cw-native-toolbar").getByRole("status")).toContainText(`已保存 · V${revision}`);
  };
  const type = async text => {
    // Click the real document page to establish the engine's text selection;
    // focusing its hidden input alone can precede the initial selection setup.
    const canvas = await page.locator(".cw-native-office canvas").first().boundingBox();
    await page.mouse.click(canvas.x + 150, canvas.y + 100);
    await expect(page.locator('.cw-native-office [data-u-comp="editor"][contenteditable="true"]').first()).toBeFocused();
    await page.keyboard.insertText(text);
    await expect(page.locator(".cw-native-toolbar").getByRole("status")).not.toContainText("已保存");
  };
  await ready(1);
  const editorEntry = await page.evaluate(() => navigation.currentEntry.key);
  const entriesBefore = await page.evaluate(() => navigation.entries().map(entry => entry.key));
  await page.evaluate(() => {
    window.creationTraversals = [];
    navigation.addEventListener("navigate", event => {
      if (event.navigationType === "traverse") queueMicrotask(() => window.creationTraversals.push({ prevented: event.defaultPrevented, key: event.destination.key }));
    });
  });
  await type("后退时保存：");
  await page.evaluate(() => history.back());
  await expect.poll(() => observed.saveAttempts.length).toBe(1);
  await expect(page.locator(".cw-workspace")).toHaveAttribute("inert", "");
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(editorEntry);
  await page.screenshot({ path: info.outputPath("history-saving.png") });
  releaseSave({ status: 503, json: { code: "REQUEST_FAILED" } });
  await expect(page.locator(".cw-workspace")).not.toHaveAttribute("inert", "");
  await expect(page.locator(".cw-error").first()).toBeVisible();
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(editorEntry);
  expect(observed.saves).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("history-save-failed.png") });
  // A retry remains on the editor while saving; a second Back is coalesced.
  await page.evaluate(() => history.back());
  await expect.poll(() => observed.saveAttempts.length).toBe(2);
  await page.evaluate(() => history.back());
  await expect.poll(() => page.evaluate(() => window.creationTraversals.filter(item => item.prevented).length)).toBe(3);
  expect(observed.saveAttempts).toHaveLength(2);
  releaseSave(null);
  await expect(page).toHaveURL(/\/zh\/projects$/);
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(initialEntry);
  expect(await page.evaluate(() => navigation.entries().map(entry => entry.key))).toEqual(entriesBefore);
  expect(observed.saves[0].content.snapshot.body.dataStream).toContain("后退时保存：");
  await page.evaluate(() => history.forward());
  await ready(2);
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(editorEntry);
  // Create a real forward destination through the existing site link.
  await page.getByRole("link", { name: "创作首页", exact: true }).click();
  await expect(page).toHaveURL(/\/zh$/);
  const homeEntry = await page.evaluate(() => navigation.currentEntry.key);
  await page.evaluate(() => history.back());
  await ready(2);
  await type("前进时保存：");
  await page.evaluate(() => history.forward());
  await expect.poll(() => observed.saveAttempts.length).toBe(3);
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(editorEntry);
  releaseSave(null);
  await expect(page).toHaveURL(/\/zh$/);
  expect(await page.evaluate(() => navigation.currentEntry.key)).toBe(homeEntry);
  expect(observed.saves[1].content.snapshot.body.dataStream).toContain("前进时保存：");
  await page.evaluate(() => history.back());
  await ready(3);
  expect(observed.saves).toHaveLength(2);
  // The single HTTP console error is the deliberately rejected save above.
  expect(observed.errors).toHaveLength(1);
  expect(observed.errors[0]).toContain("503 (Service Unavailable)");
});


test("HTML slides keep one edit frame across 30 pages and repeated panel changes", async ({ page }, info) => {
  const observed = await fixtures(page);
  const artwork = htmlDocumentSchema.parse({ schemaVersion: 3, format: "html-slides", kind: "slides", title: "HTML performance sample", theme: content.theme,
    pages: Array.from({ length: 30 }, (_, index) => ({ id: `html-${index}`, title: `Page ${index + 1}`, width: 1280, height: 720,
      html: `<html><head><style>body{margin:0;background:#faf7ef;font-family:Arial;color:#33443b;padding:40px}h1{font-size:48px}.grid{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}.cell{background:#cb985e;padding:5px}</style></head><body><h1 data-node-id="title">Page ${index + 1}</h1><div class="grid">${Array.from({length:100},(_,n)=>`<div class="cell" data-node-id="cell-${n}">${n}</div>`).join("")}</div></body></html>` })) });
  await page.route("**/api/creation/artifacts/deck", route => route.fulfill({ json: { id: "deck", revision: 1, content: artwork } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/zh/creation?project=demo");
  const frame = page.frameLocator('iframe[title="可编辑作品"]');
  await expect(frame.locator("h1")).toHaveText("Page 1");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Memory.getDOMCounters");
  const timings = [];
  for (let index = 1; index < 30; index++) {
    const elapsed = await page.evaluate(async index => {
      const start = performance.now();
      document.querySelectorAll(".cw-html-pages button")[index].click();
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 10000;
        const check = () => {
          const frame = document.querySelector('.cw-html-stage iframe');
          if (frame?.contentDocument?.querySelector("h1")?.textContent === `Page ${index + 1}`) requestAnimationFrame(resolve);
          else if (performance.now() > deadline) reject(new Error("slide timeout"));
          else requestAnimationFrame(check);
        };
        check();
      });
      return performance.now() - start;
    }, index);
    timings.push(elapsed);
    expect(await page.locator('.cw-html-stage iframe').count()).toBe(1);
  }
  for (let index = 0; index < 10; index++) {
    await page.getByRole("button", { name: "收起创作对话", exact: true }).click();
    await page.getByRole("button", { name: "展开创作对话", exact: true }).click();
  }
  await expect(frame.locator("h1")).toHaveText("Page 30");
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Memory.getDOMCounters");
  const sorted = [...timings].sort((a,b)=>a-b);
  await writeFile(info.outputPath("html-slide-metrics.json"), JSON.stringify({ mode:"local Next development; mocked API; diagnostic only", pages:30, nodesPerPage:101, timings, medianMs: sorted[Math.floor(sorted.length/2)], p95Ms:sorted[Math.ceil(sorted.length*.95)-1], before, after }, null, 2));
  expect(after.documents).toBeLessThanOrEqual(before.documents + 2);
  expect(after.jsEventListeners).toBeLessThanOrEqual(before.jsEventListeners + 30);
  expect(observed.errors.filter(error => !error.startsWith("Blocked script execution in "))).toEqual([]);
  await cdp.detach();
});
