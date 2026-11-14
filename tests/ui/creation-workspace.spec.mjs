import { test, expect } from "@playwright/test";
import { layoutDocumentSchema, layoutOperationsSchema } from "../../src/lib/creation/contracts/layout.js";
import { applyLayoutOperations } from "../../src/lib/creation/layout-operations.js";
import { officeFile } from "../fixtures/creation-office-reference.mjs";
import { writeFile } from "node:fs/promises";
import { htmlDocumentSchema } from "../../src/lib/creation/html/document.js";
import { applyArtworkOperations } from "../../src/lib/creation/artwork-codec.js";

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
  await page.getByRole("tab", { name: "PPT", exact: true }).click();
  await expect(page.locator(".cr-creation-launcher")).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-ppt-selected.png") });
  expect(observed.calls.some(call => call.method !== "GET" || /\/artifacts\//.test(call.path))).toBe(false);
  expect(observed.scripts.filter(url => /univer|layout-canvas|native-office-runtime/i.test(url))).toEqual([]);
  expect(observed.errors).toEqual([]);
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
