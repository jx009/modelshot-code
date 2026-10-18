import { test, expect } from "@playwright/test";
import sharp from "sharp";
import http from "node:http";

for (const cors of [true, false]) test(`canvas draws and exports with COS CORS ${cors ? "enabled" : "missing (proxy fallback)"}`, async ({ page }) => {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#17b786" } }).png().toBuffer();
  const counts = { auto: 0, cos: 0, proxy: 0 };
  // Redirected requests are served by a real second origin, not route interception.
  const server = http.createServer((_req, res) => {
    counts.cos++;
    res.writeHead(200, { "Content-Type": "image/png", ...(cors ? { "Access-Control-Allow-Origin": "*" } : {}) });
    res.end(png);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${server.address().port}/private.png?fixture-signature=1`;
  try {
  await page.addInitScript(() => {
    window.cosDraws = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (args[0] instanceof HTMLImageElement && args[0].naturalWidth === 400) window.cosDraws++;
      return original.apply(this, args);
    };
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const reply = json => route.fulfill({ json });
    if (url.pathname === "/api/auth/session") return reply({ user: { id: "fixture-user", name: "Creator", credits: 100 }, expires: "2099-01-01" });
    if (url.pathname === "/api/studio/documents/cos-doc") return reply({ id: "cos-doc", version: 1, name: "COS canvas", content: { schemaVersion: 1, layers: [{ id: "image", type: "image", assetId: "cos-asset-fixture", name: "COS test image", x: 100, y: 100, width: 400, height: 300, pixelWidth: 400, pixelHeight: 300, visible: true, opacity: 1 }], messages: [], jobs: [], appliedJobs: [] } });
    if (url.pathname === "/api/studio/documents/cos-doc/view") return reply({ camera: { x: 0, y: 0, scale: 1 } });
    if (url.pathname === "/api/studio/capabilities") return reply({ imageProvider: "fixture", imageModels: [{ id: "fixture", label: "Fixture", creditCost: 1 }], tools: [] });
    if (url.pathname === "/api/studio/jobs") return reply([]);
    if (url.pathname === "/api/assets/cos-asset-fixture") {
      if (url.searchParams.get("delivery") === "auto") { counts.auto++; return route.fulfill({ status: 307, headers: { Location: target, "Cache-Control": "private, no-store" }, body: "" }); }
      if (url.searchParams.get("delivery") === "proxy") counts.proxy++;
      return route.fulfill({ body: png, contentType: "image/png" });
    }
    return reply({ items: [], credits: 100 });
  });
  await page.goto("/zh/studio-v2?document=cos-doc");
  await expect.poll(() => page.evaluate(() => window.cosDraws)).toBeGreaterThan(0);
  expect(counts.auto).toBeGreaterThan(0); expect(counts.cos).toBeGreaterThan(0);
  expect(counts.proxy).toBe(cors ? 0 : 1);
  // A successfully displayed but tainted canvas would throw here.
  const exported = await page.locator(".konvajs-content canvas").first().evaluate(canvas => canvas.toDataURL("image/png"));
  expect(exported).toMatch(/^data:image\/png;base64,/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
