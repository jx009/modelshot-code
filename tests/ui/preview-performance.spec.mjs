import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";

test("story preview rendering workload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.addInitScript(() => {
    window.previewDraws = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      window.previewDraws++;
      return original.apply(this, args);
    };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
  await page.goto("/zh/explore/quiet-living");
  await expect(page.locator(".cm-preview-render")).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => window.previewDraws)).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  const initial = await page.evaluate(() => ({ draws: window.previewDraws, pixels: [...document.querySelectorAll('.cm-preview-render')].reduce((n,c) => n+c.width*c.height,0) }));
  expect(initial.draws).toBeLessThan(12);
  expect(initial.pixels).toBeLessThan(3883500);
  await page.screenshot({ path: info.outputPath("case-preview.png") });
  // Copy is below the fold; invoke through the visible control after scrolling.
  await page.getByRole("button", { name: "复制", exact: true }).scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  const beforeCopy = await page.evaluate(() => window.previewDraws);
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await page.waitForTimeout(200);
  const afterCopy = await page.evaluate(() => window.previewDraws);
  expect(afterCopy).toBe(beforeCopy);
  for (const canvas of await page.locator(".cm-preview-render").all()) {
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
  }
  await expect(page.locator(".cm-render-error")).toHaveCount(0);
  console.log(JSON.stringify({ initial, beforeCopy, afterCopy }));
  await info.attach("preview-workload", { body: JSON.stringify({ initial, beforeCopy, afterCopy }), contentType: "application/json" });
});

for (const [platform, width, height] of [["taobao", 750, 5178], ["amazon", 970, 6696], ["shopify", 1200, 8280]]) {
  test(`${platform}: preview sizing preserves native export resolution and edited copy`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/**", route => route.fulfill({ json: {} }));
    await page.goto("/zh/commerce?case=quiet-living");
    await page.getByLabel("目标平台", { exact: true }).selectOption(platform);
    await page.getByRole("button", { name: "生成可编辑分镜", exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill("更轻的预览");
    await page.getByLabel("版式", { exact: true }).selectOption("inset");
    const canvas = page.locator(".cm-preview-render").first();
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    expect(await canvas.evaluate(c => c.width)).toBeLessThan(width);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出原图排版", exact: true }).click();
    const zip = await JSZip.loadAsync(await fs.readFile(await (await download).path()));
    const project = JSON.parse(await zip.file("project.json").async("string"));
    expect(project.sections[0].title).toBe("更轻的预览");
    const full = await sharp(await zip.file("detail-page.png").async("nodebuffer")).metadata();
    expect(full.width).toBe(width);
    expect(full.height).toBe(height);
  });
}
