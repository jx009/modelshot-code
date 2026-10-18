import { test, expect } from "@playwright/test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

async function setup(page, { failFirst = false, artwork = false, plan = null } = {}) {
  const preview = artwork
    ? await sharp(await readFile(new URL("../../public/studio/scene-03.webp", import.meta.url))).resize(640, 480).png().toBuffer()
    : await sharp({ create: { width: 640, height: 480, channels: 3, background: "#17b786" } }).png().toBuffer();
  const original = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#df8151" } }).png().toBuffer();
  const pending = new Map(), requests = [], aborted = [];
  const state = { failFirst };
  const server = http.createServer((req, res) => {
    const id = new URL(req.url, "http://fixture").pathname.slice(1);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": original.length, "Access-Control-Allow-Origin": "*", "Cache-Control": "private, no-store" });
    const split = Math.floor(original.length / 2);
    res.write(original.subarray(0, split));
    pending.set(id, () => res.end(original.subarray(split)));
    res.on("close", () => { if (!res.writableEnded) aborted.push(id); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${server.address().port}`;
  await page.addInitScript(() => {
    window.previewDraws = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (args[0] instanceof HTMLImageElement) window.previewDraws++;
      return draw.apply(this, args);
    };
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/auth/session") return reply({ user: { id: "preview-user", name: "Creator", credits: 100 }, expires: "2099-01-01" });
    if (path === "/api/studio/documents/preview-doc") return reply({ id: "preview-doc", version: 1, name: "Preview", content: { schemaVersion: 1, ...(plan ? { plan } : {}), layers: ["first", "second"].map((id, i) => ({ id, type: "image", assetId: id, name: `Image ${id}`, x: 50 + i * 410, y: 100, width: 400, height: 300, pixelWidth: 2400, pixelHeight: 1800, visible: true, opacity: 1 })), messages: [], jobs: [], appliedJobs: [] } });
    if (path === "/api/studio/documents/preview-doc/view") return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (path === "/api/studio/capabilities") {
      const imageModels = [
        { id: "fixture", label: "Fixture", creditCost: 7, resolutionSurcharges: { "1K": 0, "2K": 6, "4K": 22 } },
        { id: "second-model", label: "Second model", creditCost: 10, resolutionSurcharges: { "1K": 0, "2K": 6, "4K": 22 } },
      ];
      const model = imageModels.find(m => m.id === url.searchParams.get("imageProvider")) || imageModels[0];
      return reply({ imageProvider: model.id, imageModels, tools: ["generate", "edit", "expand"].map(id => ({ id, available: true, dependency: "image", cost: model.creditCost, resolutionSurcharges: model.resolutionSurcharges })) });
    }
    if (path === "/api/studio/jobs") return reply([]);
    if (path === "/api/inspiration") return reply({ items: [], layout: { mode: "masonry", columns: 4, gap: 16 } });
    if (path.startsWith("/api/assets/")) {
      const id = path.split("/").at(-1);
      requests.push({ id, preview: url.searchParams.get("preview"), delivery: url.searchParams.get("delivery") });
      if (url.searchParams.has("preview")) return route.fulfill({ body: preview, contentType: "image/png" });
      if (state.failFirst && id === "first") return route.fulfill({ status: 503, json: { error: "fixture" } });
      return route.fulfill({ status: 307, headers: { Location: `${target}/${id}`, "Cache-Control": "private, no-store" }, body: "" });
    }
    return reply({ items: [], credits: 100 });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/zh/studio-v2?document=preview-doc");
  await expect.poll(() => page.evaluate(() => window.previewDraws)).toBeGreaterThan(0);
  return { pending, requests, aborted, state, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function openFirst(page) {
  const stage = page.locator(".ms-stage"), box = await stage.boundingBox();
  const camera = JSON.parse(await stage.getAttribute("data-camera"));
  await page.mouse.dblclick(box.x + camera.x + 250 * camera.scale, box.y + camera.y + 250 * camera.scale);
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
}

test("double-click shows a complete preview during a partial original download and reuses the decoded original on reopen", async ({ page }, info) => {
  const fixture = await setup(page);
  try {
    await openFirst(page);
    const body = page.locator(".ms-preview-body"), image = body.locator("img");
    await expect(body).toHaveAttribute("data-quality", "preview");
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth === 640)).toBe(true);
    await expect.poll(() => fixture.pending.has("first")).toBe(true);
    const box = await image.boundingBox(), viewport = await page.locator(".ms-preview-image").boundingBox();
    expect(box.width / box.height).toBeCloseTo(4 / 3, 2);
    expect(box.height).toBeGreaterThan(400);
    expect(box.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.locator(".ms-preview-controls")).toContainText("75%");
    expect(box.height / viewport.height).toBeCloseTo(.75, 2);
    expect(Math.abs(box.x + box.width / 2 - viewport.x - viewport.width / 2)).toBeLessThan(1);
    expect(Math.abs(box.y + box.height / 2 - viewport.y - viewport.height / 2)).toBeLessThan(1);
    expect(await page.locator(".ms-preview-image").evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(body.getByRole("status")).toContainText("正在加载原图");
    await page.screenshot({ path: info.outputPath("preview-during-slow-original.png") });
    fixture.pending.get("first")();
    await expect(body).toHaveAttribute("data-quality", "original");
    expect(await image.evaluate(img => img.naturalWidth)).toBe(2400);
    expect(fixture.requests.filter(r => !r.preview)).toEqual([{ id: "first", preview: null, delivery: "auto" }]);
    await page.getByTitle("放大预览", { exact: true }).click();
    expect((await image.boundingBox()).height).toBeGreaterThan(box.height);
    await page.getByTitle("关闭预览", { exact: true }).click();
    await openFirst(page);
    await expect(body).toHaveAttribute("data-quality", "original");
    await expect(page.locator(".ms-preview-controls")).toContainText("75%");
    expect(fixture.requests.filter(r => !r.preview)).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await image.boundingBox()).width).toBeLessThanOrEqual(350);
    await page.screenshot({ path: info.outputPath("preview-mobile.png") });
  } finally { await page.close(); await fixture.close(); }
});

test("failed original keeps the preview and can be retried", async ({ page }) => {
  const fixture = await setup(page, { failFirst: true });
  try {
    await openFirst(page);
    await expect(page.locator(".ms-preview-body").getByRole("status")).toContainText("原图加载失败，已保留预览");
    await expect(page.locator(".ms-preview-body")).toHaveAttribute("data-quality", "preview");
    expect(fixture.requests.filter(r => !r.preview).map(r => r.delivery)).toEqual(["auto", "proxy"]);
    fixture.state.failFirst = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => fixture.pending.has("first")).toBe(true);
    fixture.pending.get("first")();
    await expect(page.locator(".ms-preview-body")).toHaveAttribute("data-quality", "original");
    await expect(page.locator(".ms-preview-body").getByRole("status")).toHaveCount(0);
  } finally { await page.close(); await fixture.close(); }
});

test("switching and closing cancel obsolete downloads without displaying the previous image", async ({ page }) => {
  const fixture = await setup(page);
  try {
    await openFirst(page);
    await expect.poll(() => fixture.pending.has("first")).toBe(true);
    await page.getByRole("button", { name: "Image second", exact: true }).click();
    await expect(page.locator(".ms-preview-controls")).toContainText("75%");
    await expect(page.locator(".ms-preview-body")).toHaveAttribute("data-asset-id", "second");
    await expect(page.locator(".ms-preview-body img")).toHaveAttribute("src", /\/second\?preview=/);
    await expect.poll(() => fixture.aborted).toContain("first");
    await expect.poll(() => fixture.pending.has("second")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
    await expect.poll(() => fixture.aborted).toContain("second");
  } finally { await page.close(); await fixture.close(); }
});

test("wheel zoom anchors at the cursor, drag pans, transforms reset and the viewer never scrolls", async ({ page }, info) => {
  const fixture = await setup(page, { artwork: true });
  try {
    await openFirst(page);
    const viewport = page.locator(".ms-preview-image"), image = page.locator(".ms-preview-body img");
    const initial = await image.boundingBox(), bounds = await viewport.boundingBox();
    const anchor = { x: initial.x + initial.width * .7, y: initial.y + initial.height * .4 };
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -180);
    await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(initial.width * 1.4);
    const enlarged = await image.boundingBox();
    expect((anchor.x - enlarged.x) / enlarged.width).toBeCloseTo(.7, 2);
    expect((anchor.y - enlarged.y) / enlarged.height).toBeCloseTo(.4, 2);
    await page.mouse.down(); await page.mouse.move(anchor.x + 65, anchor.y + 35, { steps: 5 }); await page.mouse.up();
    const panned = await image.boundingBox();
    expect(panned.x - enlarged.x).toBeCloseTo(65, 0);
    expect(panned.y - enlarged.y).toBeCloseTo(35, 0);
    await page.getByTitle("水平翻转", { exact: true }).click();
    await expect(page.getByTitle("水平翻转", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ms-preview-image-content")).toHaveAttribute("style", /scale\(-1, 1\)/);
    await page.getByTitle("垂直翻转", { exact: true }).click();
    await expect(page.locator(".ms-preview-image-content")).toHaveAttribute("style", /scale\(-1, -1\)/);
    await page.getByTitle("向右旋转", { exact: true }).click();
    await expect(page.locator(".ms-preview-image-content")).toHaveAttribute("style", /rotate\(90deg\)/);
    await page.getByTitle("重置预览", { exact: true }).click();
    await expect(page.locator(".ms-preview-controls")).toContainText("75%");
    await expect(page.getByTitle("水平翻转", { exact: true })).toHaveAttribute("aria-pressed", "false");
    expect(await image.boundingBox()).toEqual(initial);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    for (let i = 0; i < 7; i++) await page.mouse.wheel(0, -200);
    await expect.poll(() => page.locator(".ms-preview-percent").textContent()).toBe("800%");
    expect(await viewport.evaluate(el => el.scrollTop)).toBe(0);
    await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.locator(".ms-preview-controls")).toContainText("75%");
    await page.screenshot({ path: info.outputPath("viewer-controls-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    const controls = await page.locator(".ms-preview-controls").boundingBox();
    expect(controls.x).toBeGreaterThanOrEqual(0); expect(controls.x + controls.width).toBeLessThanOrEqual(390);
    await page.getByTitle("垂直翻转", { exact: true }).click();
    await expect(page.getByTitle("垂直翻转", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: info.outputPath("viewer-controls-mobile.png") });
  } finally { await page.close(); await fixture.close(); }
});

test("composer price follows model, resolution and output count on canvas and home", async ({ page }, info) => {
  const fixture = await setup(page);
  try {
    await expect(page.locator(".ms-send .generation-price")).toHaveText("7");
    await expect(page.locator(".ms-composer-hint")).not.toContainText("一次提交");
    await page.getByRole("button", { name: "图片比例", exact: true }).click();
    await page.getByRole("button", { name: "4K", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.locator(".ms-send .generation-price")).toHaveText("29");
    await page.getByRole("combobox", { name: "生成张数" }).selectOption("3");
    await expect(page.locator(".ms-send .generation-price")).toHaveText("87");
    await page.locator(".mpk-trigger").click();
    await expect(page.locator(".mpk-price")).toHaveCount(0);
    await page.getByRole("option", { name: /Second model/ }).click();
    await expect(page.locator(".ms-send .generation-price")).toHaveText("96");
    const sendBox = await page.locator(".ms-send").boundingBox(), composerBox = await page.locator(".ms-composer").boundingBox();
    expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(composerBox.x + composerBox.width);
    await page.screenshot({ path: info.outputPath("canvas-resolution-price.png") });
    await page.getByRole("button", { name: "图层", exact: true }).click();
    await page.locator(".ms-layer-select").filter({ hasText: "Image first" }).click();
    await page.getByRole("button", { name: "图层", exact: true }).click();
    await page.locator(".ms-context-scroll").getByRole("button", { name: "AI 扩图", exact: true }).click();
    const panel = page.locator(".ms-editor-expand");
    await expect(panel.locator(".ms-editor-cost")).toHaveText("32 积分");
    await panel.getByRole("button", { name: "图片比例", exact: true }).click();
    await page.getByRole("button", { name: "2K", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await expect(panel.locator(".ms-editor-cost")).toHaveText("16 积分");
    await expect(page.locator(".ms-send .generation-price")).toHaveText("48");
    await page.goto("/zh");
    await expect(page.locator(".cr-send .generation-price")).toHaveText("7");
    await page.getByRole("button", { name: "图片比例", exact: true }).click();
    await page.getByRole("button", { name: "2K", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByRole("combobox", { name: "生成张数" }).selectOption("4");
    await expect(page.locator(".cr-send .generation-price")).toHaveText("52");
    await page.screenshot({ path: info.outputPath("home-resolution-price.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    const send = await page.locator(".cr-send").boundingBox();
    expect(send.x + send.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath("home-resolution-price-mobile.png") });
  } finally { await page.close(); await fixture.close(); }
});

test("a resumed plan quotes only unsubmitted steps using the selected model tiers", async ({ page }) => {
  const fixture = await setup(page, { plan: {
    id: "pricing-plan", summary: "Create and refine", credits: 2, index: 1, status: "paused", activeJob: null, targetId: "first",
    steps: [
      { tool: "generate", params: { prompt: "Product image", size: "1:1@4K" }, explanation: "Create" },
      { tool: "edit", params: { prompt: "Refine light", size: "1:1@2K" }, explanation: "Refine" },
    ],
  } });
  try {
    await expect(page.locator(".ms-plan .ms-primary")).toContainText("剩余预计 13 积分");
    await page.locator(".mpk-trigger").click();
    await expect(page.locator(".mpk-price")).toHaveCount(0);
    await page.getByRole("option", { name: /Second model/ }).click();
    await expect(page.locator(".ms-plan .ms-primary")).toContainText("剩余预计 16 积分");
  } finally { await page.close(); await fixture.close(); }
});
