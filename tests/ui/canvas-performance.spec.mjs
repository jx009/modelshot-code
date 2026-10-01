import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("64-layer canvas prompt editing retains all layers", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const picture = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#dbb991" } }).png().toBuffer();
  const layers = Array.from({ length: 64 }, (_, i) => ({ id: `perf-layer-${i}`, type: "image", name: `Image ${i}`, assetId: "fixture", x: i % 8 * 220, y: Math.floor(i / 8) * 170, width: 200, height: 150, pixelWidth: 200, pixelHeight: 150, visible: true, opacity: 1, rotation: 0 }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.addInitScript(() => {
    window.artworkDraws = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      window.artworkDraws++;
      return draw.apply(this, args);
    };
  });
  let saved;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith("/api/assets/")) return route.fulfill({ contentType: "image/png", body: picture });
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (path === "/api/studio/documents" && body) saved = body;
    const responses = {
      "/api/auth/session": { user: { id: "perf-user", email: "perf@example.invalid", name: "Performance", credits: 500 }, expires: "2099-01-01" },
      "/api/studio/documents/perf": { id: "perf", version: 1, name: "Performance", layerCount: 64, content: { schemaVersion: 1, layers, messages: [], jobs: [], appliedJobs: [] } },
      "/api/studio/documents": body ? { ...body, id: "perf", version: (body.version || 0) + 1 } : [],
      "/api/studio/capabilities": { imageModels: [{ id: "fixture", label: "Fixture", maxReferenceImages: 3 }], imageProvider: "fixture", tools: [{ id: "inpaint", available: true }] },
      "/api/studio/jobs": [], "/api/usage": { credits: 500 },
    };
    await route.fulfill({ json: responses[path] || {} });
  });
  await page.goto("/zh/studio-v2?document=perf");
  await expect(page.locator(".ms-stage canvas").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.evaluate(() => window.artworkDraws)).toBeGreaterThan(0);
  const drawsBeforeTyping = await page.evaluate(() => window.artworkDraws);
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
  await page.getByRole("textbox", { name: "创作描述" }).pressSequentially("Changing the prompt", { delay: 20 });
  await expect.poll(() => saved?.content?.layers?.length).toBe(64);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => window.artworkDraws)).toBe(drawsBeforeTyping);
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
  const workload = { scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, taskMs: (after.TaskDuration - before.TaskDuration) * 1000 };
  console.log(workload);
  await info.attach("canvas-workload", { body: JSON.stringify(workload), contentType: "application/json" });
  const stage = page.locator(".ms-stage");
  const box = await stage.boundingBox();
  const camera = JSON.parse(await stage.getAttribute("data-camera"));
  const start = { x: box.x + camera.x + 100 * camera.scale, y: box.y + camera.y + 75 * camera.scale };
  await page.mouse.click(start.x, start.y);
  await expect(stage).toHaveAttribute("data-selection-frame", /width/);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Release over a disabled contextual tool: it must not swallow drag end.
  const disabledTool = page.locator(".ms-context-scroll button:disabled").first();
  const toolBox = await disabledTool.boundingBox();
  await page.mouse.move(toolBox.x + toolBox.width / 2, toolBox.y + toolBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => saved?.content.layers[0].x).toBeGreaterThan(0);
  expect(saved.content.layers).toHaveLength(64);
  await page.keyboard.press("Control+z");
  await expect.poll(() => saved?.content.layers[0].x).toBe(0);
  await page.locator(".ms-context-scroll").getByRole("button", { name: "局部修改", exact: true }).click();
  await expect(stage).toHaveAttribute("data-mode", "mask");
  await expect(stage).toHaveAttribute("data-camera-moving", "false");
  const selection = JSON.parse(await stage.getAttribute("data-selection-frame"));
  const frame = await stage.boundingBox();
  await page.mouse.move(frame.x + selection.left + selection.width * .2, frame.y + selection.top + selection.height * .3);
  await page.mouse.down();
  for (let i = 0; i < 100; i++) {
    await page.mouse.move(frame.x + selection.left + selection.width * (.2 + i % 20 * .025), frame.y + selection.top + selection.height * (.3 + Math.floor(i / 20) * .08));
  }
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-mode", "mask");
  await expect(page.locator(".ms-notice")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("dense-mask.png") });

  // Narrow screens hide the canvas under chat. Preserve its backing buffer
  // and restore exactly the same camera when returning to the artwork.
  await page.setViewportSize({ width: 540, height: 900 });
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("data-camera-moving", "false");
  const backing = page.locator(".ms-stage canvas").first();
  await expect.poll(() => backing.evaluate(c => c.width)).toBeGreaterThan(0);
  const bufferSize = await backing.evaluate(c => ({ width: c.width, height: c.height }));
  const view = await stage.getAttribute("data-camera");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(stage).toBeHidden();
  expect(await backing.evaluate(c => ({ width: c.width, height: c.height }))).toEqual(bufferSize);
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("data-camera", view);
});
