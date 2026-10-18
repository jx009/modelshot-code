import { test, expect } from "@playwright/test";
import http from "node:http";
import sharp from "sharp";

async function setup(page, { failFirst = false } = {}) {
  const preview = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#17b786" } }).png().toBuffer();
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
    if (path === "/api/studio/documents/preview-doc") return reply({ id: "preview-doc", version: 1, name: "Preview", content: { schemaVersion: 1, layers: ["first", "second"].map((id, i) => ({ id, type: "image", assetId: id, name: `Image ${id}`, x: 50 + i * 410, y: 100, width: 400, height: 300, pixelWidth: 2400, pixelHeight: 1800, visible: true, opacity: 1 })), messages: [], jobs: [], appliedJobs: [] } });
    if (path === "/api/studio/documents/preview-doc/view") return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (path === "/api/studio/capabilities") return reply({ imageProvider: "fixture", imageModels: [{ id: "fixture", label: "Fixture", creditCost: 1 }], tools: [] });
    if (path === "/api/studio/jobs") return reply([]);
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
    expect(box.height).toBeGreaterThan(600);
    expect(box.height).toBeLessThanOrEqual(viewport.height + 1);
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
    await expect(page.locator(".ms-preview-body")).toHaveAttribute("data-asset-id", "second");
    await expect(page.locator(".ms-preview-body img")).toHaveAttribute("src", /\/second\?preview=/);
    await expect.poll(() => fixture.aborted).toContain("first");
    await expect.poll(() => fixture.pending.has("second")).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
    await expect.poll(() => fixture.aborted).toContain("second");
  } finally { await page.close(); await fixture.close(); }
});
