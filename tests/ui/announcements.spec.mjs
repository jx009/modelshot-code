import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { DEFAULT_LAYOUT } from "../../src/lib/inspiration/gallery.js";

const notice = { id: "notice_001", revision: "version1", title: "来塔绘梦 全新升级", content: "让每一个灵感，都成为好作品。", titleEn: "Create something remarkable", contentEn: "New tools for your next idea.", buttonText: "立即查看", buttonTextEn: "Explore", buttonUrl: "/explore", style: "info", closable: true };
async function fixtures(page, state = { item: notice }) {
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/announcements/current") return route.fulfill({ json: { announcement: state.item } });
    if (url.pathname === "/api/inspiration") return route.fulfill({ json: { items: [], layout: DEFAULT_LAYOUT } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: { user: { id: "fixture-user", email: "fixture@example.invalid", credits: 500 }, expires: "2099-01-01T00:00:00Z" } });
    if (url.pathname === "/api/studio/documents") return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === "/api/studio/capabilities") return route.fulfill({ json: { imageModels: [], tools: [], planningAvailable: false } });
    return route.fulfill({ json: {} });
  });
}
for (const width of [1440, 390]) test(`announcement offsets home, projects and canvas without overflow (${width})`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await fixtures(page);
  for (const path of ["/zh", "/zh/projects", "/zh/studio-v2"]) {
    await page.goto(path);
    const banner = page.getByRole("region", { name: "网站公告" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "立即查看" })).toHaveAttribute("href", "/zh/explore");
    const rect = await banner.boundingBox();
    const shell = page.locator(path.includes("studio-v2") ? ".ms-studio" : ".cr-sidebar");
    await expect(shell).toBeVisible();
    const box = await shell.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(rect.height - 1);
    if (path.includes("studio-v2")) {
      const body = await page.locator(".ms-body").boundingBox();
      expect(body.y + body.height).toBeLessThanOrEqual(901);
      expect(body.height).toBeGreaterThan(400);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (path === "/zh" || path.includes("studio-v2")) await page.screenshot({ path: info.outputPath(`announcement-${width}-${path.includes("studio-v2") ? "canvas" : "home"}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "关闭公告", exact: true }).click();
  await expect(page.getByRole("region", { name: "网站公告" })).toHaveCount(0);
  await expect.poll(async () => (await page.locator(".ms-studio").boundingBox()).y).toBe(0);
});
test("dismissal persists for the session and an updated notice reappears; disabled notices leave no gap", async ({ page }) => {
  const state = { item: notice };
  await fixtures(page, state);
  await page.goto("/zh");
  await page.getByRole("button", { name: "关闭公告", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("region", { name: "网站公告" })).toHaveCount(0);
  state.item = { ...notice, revision: "version2", title: "新公告" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("region", { name: "网站公告" })).toContainText("新公告");
  state.item = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("region", { name: "网站公告" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--site-announcement-height").trim())).toBe("0px");
});
test("English content and non-dismissible announcements", async ({ page }) => {
  await fixtures(page, { item: { ...notice, closable: false } });
  await page.goto("/en");
  const banner = page.getByRole("region", { name: "Site announcement" });
  await expect(banner).toContainText("Create something remarkable");
  await expect(banner.getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/en/explore");
  await expect(banner.getByRole("button")).toHaveCount(0);
});

for (const width of [1440, 390]) test(`QR announcement loads COS image only on click and supports retry (${width})`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await fixtures(page, { item: { ...notice, buttonAction: "qr", buttonText: "点击加群", buttonUrl: "" } });
  const png = await sharp({ create: { width: 400, height: 500, channels: 3, background: "white" } }).png().toBuffer();
  let signing = 0, images = 0;
  await page.route("**/api/announcements/qr?*", route => {
    signing++;
    return signing === 1 ? route.fulfill({ status: 503, json: { code: "REQUEST_FAILED" } })
      : route.fulfill({ json: { url: `https://fixture-1250000000.cos.ap-guangzhou.myqcloud.com/qr.png?v=${signing}` } });
  });
  await page.route("https://fixture-1250000000.cos.ap-guangzhou.myqcloud.com/**", route => { images++; return route.fulfill({ body: png, contentType: "image/png" }); });
  await page.goto("/zh");
  const button = page.getByRole("button", { name: "点击加群", exact: true });
  await expect(button).toBeVisible(); expect(signing).toBe(0); expect(images).toBe(0);
  await button.click();
  const modal = page.getByRole("dialog", { name: "扫码加群" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "重新加载" }).click();
  const image = modal.getByRole("img", { name: "加群二维码" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const rect = await modal.boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`announcement-qr-${width}.png`) });
  await page.keyboard.press("Escape"); await expect(modal).toHaveCount(0); await expect(button).toBeFocused();
  await button.click(); await expect.poll(() => signing).toBe(3);
  await modal.getByRole("button", { name: "关闭二维码" }).click(); await expect(modal).toHaveCount(0);
});
