import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { DEFAULT_LAYOUT } from "../../src/lib/inspiration/gallery.js";

const notice = { id: "notice_001", revision: "version1", title: "来塔绘梦 全新升级", content: "让每一个灵感，都成为好作品。", titleEn: "Create something remarkable", contentEn: "New tools for your next idea.", buttonText: "立即查看", buttonTextEn: "Explore", buttonUrl: "/explore", style: "info", closable: true };
const launchNotice = { ...notice, title: "让想象，一键成真", content: "来塔绘梦上线内测中，新用户注册赠送 100 积分，加群再送 50 积分。", buttonAction: "qr", buttonText: "点击加群", buttonUrl: "" };
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

test("first visit defaults to dark even on a light OS and preserves a manual theme choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await fixtures(page);
  const response = await page.goto("/zh");
  expect(await response.text()).toMatch(/<html[^>]*data-theme="dark"/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

for (const theme of ["light", "dark"]) for (const width of [1440, 390]) {
  test(`launch announcement stays readable in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    const state = { item: launchNotice };
    await fixtures(page, state);
    await page.goto("/zh");
    const banner = page.getByRole("region", { name: "网站公告" });
    await expect(banner).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const style of ["info", "success", "warning", "error"]) {
      state.item = { ...launchNotice, style, revision: style };
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(banner.locator(".announcement-content")).toHaveAttribute("data-style", style);
      const contrasts = await banner.evaluate(element => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        function luminance(color) {
          ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const channels = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => {
            const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        }
        function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
        const surface = getComputedStyle(element.querySelector(".announcement-content"));
        return [".announcement-copy strong", ".announcement-copy span", ".announcement-link"].map(selector => {
          const css = getComputedStyle(element.querySelector(selector));
          return { selector, ratio: contrast(css.color, selector === ".announcement-link" ? css.backgroundColor : surface.backgroundColor) };
        });
      });
      for (const value of contrasts) expect(value.ratio, `${theme} ${style} ${value.selector}`).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const box = await banner.boundingBox();
      expect((await page.locator(".cr-topbar").boundingBox()).y).toBeGreaterThanOrEqual(box.height - 1);
      if (style === "info") await page.screenshot({ path: info.outputPath(`announcement-${theme}-${width}.png`), animations: "disabled" });
    }
  });
}

for (const theme of ["dark", "light"]) for (const width of [1440, 800, 390]) {
  test(`workspace topbar stays pinned while scrolling in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 500 });
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await fixtures(page, { item: launchNotice });
    await page.goto("/zh");
    const topbar = page.locator(".cr-topbar");
    const banner = page.getByRole("region", { name: "网站公告" });
    await expect(banner).toBeVisible();
    await expect(topbar.getByRole("button", { name: "最近项目", exact: true })).toBeVisible();
    const mobileNav = 0;
    const expectedTop = (await banner.boundingBox()).height + mobileNav;
    const heroBefore = await page.locator(".cr-creation-hero").boundingBox();
    const surface = topbar.locator(".cr-topbar-surface");
    await expect(topbar).not.toHaveAttribute("data-scrolled");
    const initialSurface = await surface.boundingBox();
    await page.screenshot({ path: info.outputPath(`topbar-at-top-${theme}-${width}.png`), animations: "disabled" });
    await page.mouse.move(width - 10, 450);
    await page.mouse.wheel(0, 260);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
    await expect(topbar).toHaveAttribute("data-scrolled", "true");
    await expect.poll(async () => Math.abs((await topbar.boundingBox()).y - expectedTop)).toBeLessThan(1);
    await expect(topbar.getByRole("button", { name: "积分充值" })).toContainText("500");
    await expect(topbar.getByRole("button", { name: "fixture@example.invalid" })).toBeVisible();
    const floating = await surface.boundingBox();
    expect(floating.height).toBeLessThan(initialSurface.height);
    if (width > 600) expect(floating.width).toBeLessThan(initialSurface.width * 0.65);
    const visual = await surface.evaluate(element => {
      const css = getComputedStyle(element);
      return { blur: css.backdropFilter, rounded: parseFloat(css.borderRadius), background: css.backgroundColor };
    });
    expect(visual.blur).toContain("blur(");
    expect(visual.rounded).toBeGreaterThanOrEqual(16);
    expect(visual.background).toMatch(/rgba\(/);
    if (width > 600) expect(await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(target && !target.closest(".cr-topbar"));
    }, { x: (await topbar.boundingBox()).x + 8, y: expectedTop + 20 })).toBe(true);
    expect((await page.locator(".cr-creation-hero").boundingBox()).y).toBeLessThan(heroBefore.y - 100);
    await page.screenshot({ path: info.outputPath(`pinned-topbar-${theme}-${width}.png`), animations: "disabled" });
    await topbar.getByRole("button", { name: "最近项目", exact: true }).click();
    const recent = page.getByRole("region", { name: "我的项目库" });
    await expect(recent).toBeVisible();
    const bar = await topbar.boundingBox(), menu = await recent.boundingBox();
    const trigger = await topbar.getByRole("button", { name: "最近项目", exact: true }).boundingBox();
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    expect(menu.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
    expect(menu.y + menu.height).toBeLessThanOrEqual(500);
    await page.keyboard.press("Escape");
    await expect(recent).toHaveCount(0);
    await topbar.getByRole("button", { name: "fixture@example.invalid" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "关闭公告", exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => Math.abs((await topbar.boundingBox()).y - mobileNav)).toBeLessThan(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Math.abs((await topbar.boundingBox()).y - mobileNav)).toBeLessThan(1);
    await topbar.getByRole("button", { name: "切换明暗主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme === "dark" ? "light" : "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(topbar).not.toHaveAttribute("data-scrolled");
    await expect.poll(async () => Math.abs((await topbar.boundingBox()).y - mobileNav)).toBeLessThan(1);
    expect((await page.locator(".cr-creation-hero").boundingBox()).y).toBeGreaterThanOrEqual(mobileNav + bar.height - 1);
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
    const shell = page.locator(path.includes("studio-v2") ? ".ms-studio" : ".cr-topbar");
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
