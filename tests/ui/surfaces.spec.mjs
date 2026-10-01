import { test, expect } from "@playwright/test";
import sharp from "sharp";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/studio/documents" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { ...body, id: "saved-fixture", version: (body.version || 0) + 1 } });
      return;
    }
    const fixtures = {
      "/api/auth/session": { user: { id: "ui-fixture", name: "UI Test", email: "ui@example.invalid", credits: 500 }, expires: "2099-01-01T00:00:00Z" },
      "/api/studio/capabilities": { imageModels: [{ id: "fixture", label: "GPT Image 2", creditCost: 18, maxReferenceImages: 3 }], imageProvider: "fixture", tools: [], planningAvailable: false },
      "/api/studio/documents": { items: [{ id: "example", name: "一只猫在窗边的创作项目", updatedAt: "2026-10-01T00:00:00Z", kind: "canvas", version: 1 }], nextCursor: null },
      "/api/studio/jobs": [],
      "/api/library": { items: [], nextCursor: null },
      "/api/library/categories": [],
      "/api/account": { orders: [], transactions: [], subscriptions: [], subscriptionChanges: [] },
      "/api/assets": { items: [] },
      "/api/exports": [],
      "/api/catalog": { products: [], paymentsEnabled: false },
      "/api/usage": { credits: 500, remaining: 0 },
    };
    let response = fixtures[path] ?? {};
    if (path === "/api/studio/documents" && !new URL(route.request().url()).searchParams.has("paged")) response = response.items;
    await route.fulfill({ json: response });
  });
});

async function open(page, path, theme = "dark") {
  await page.goto(`/zh/${path}`);
  await page.getByRole("button", { name: /ui@example.invalid|生图模型/ }).first().waitFor();
  await page.evaluate(async theme => {
    document.documentElement.setAttribute("data-theme", theme);
    await document.fonts.ready;
  }, theme);
}

async function expectContained(locator, page) {
  const rect = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(rect).not.toBeNull();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectOpaque(locator) {
  const frames = await locator.evaluate(el => {
    const animations = el.getAnimations();
    const frames = [0, 30, 90, 170].map(time => {
      animations.forEach(animation => { animation.pause(); animation.currentTime = time; });
      const css = getComputedStyle(el);
      return { opacity: css.opacity, background: css.backgroundColor };
    });
    animations.forEach(animation => animation.finish());
    return frames;
  });
  for (const frame of frames) {
    expect(frame.opacity).toBe("1");
    expect(frame.background).toMatch(/^rgb\(/);
  }
}

for (const intent of ["hover", "focus"]) {
  test(`navigation ${intent}: dynamic page is fetched before clicking and reused`, async ({ page }) => {
    const destinationRequests = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/zh/commerce") destinationRequests.push(request);
    });
    await open(page, "");
    await page.waitForLoadState("networkidle");
    // Merely displaying the sidebar should not fetch the heavy destination.
    expect(destinationRequests).toHaveLength(0);
    const link = page.getByRole("navigation", { name: "创作导航" }).getByRole("link", { name: "电商套图 Agent", exact: true });
    // Next fetches the route tree first, then the dynamic page payload.
    const prefetched = page.waitForResponse(response => new URL(response.url()).pathname === "/zh/commerce" && response.request().headers()["next-router-prefetch"] !== "1");
    await link[intent]();
    await prefetched;
    // Wait for browser network quiescence before verifying cache reuse below.
    // response.finished() can remain pending for a cancelled RSC prefetch stream.
    await page.waitForLoadState("networkidle");
    expect(destinationRequests.length).toBeGreaterThan(0);
    const beforeClick = destinationRequests.length;
    await link.click();
    await expect(page.locator(".cm-workspace")).toBeVisible();
    expect(destinationRequests).toHaveLength(beforeClick);
  });
}

test("slow navigation shows a themed loading state until the destination arrives", async ({ page }) => {
  await open(page, "");
  const sidebar = await page.locator(".cr-sidebar").elementHandle();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/zh/commerce?*", async route => {
    if (route.request().headers()["next-router-prefetch"] !== "1") await gate;
    await route.continue();
  });
  try {
    const link = page.getByRole("navigation", { name: "创作导航" }).getByRole("link", { name: "电商套图 Agent", exact: true });
    const dynamicRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/zh/commerce" && request.headers()["next-router-prefetch"] !== "1");
    await link.hover();
    await dynamicRequest;
    await link.click();
    await expect(page.getByRole("status", { name: "正在打开…", exact: true })).toBeVisible();
    await expect(page.locator(".route-loading")).toHaveCSS("display", "flex");
    await expect(page.locator(".route-loading-grid")).toHaveCSS("display", "grid");
    await expectContained(page.locator(".route-loading"), page);
    expect(await sidebar.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.getByRole("button", { name: "切换明暗主题" })).toBeEnabled();
  } finally {
    release();
  }
  await expect(page.locator(".cm-workspace")).toBeVisible();
  await expect(page.locator(".route-loading")).toHaveCount(0);
  expect(await sidebar.evaluate(el => el.isConnected)).toBe(true);
});

test("search keeps asset categories; explore skips model discovery", async ({ page }) => {
  let categories = 0, capabilities = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/library/categories") categories++;
    if (path === "/api/studio/capabilities") capabilities++;
  });
  await open(page, "assets");
  await page.waitForLoadState("networkidle");
  expect(categories).toBe(1);
  const searched = page.waitForResponse(response => new URL(response.url()).pathname === "/api/library" && new URL(response.url()).searchParams.get("q") === "cat");
  await page.getByRole("searchbox").fill("cat");
  await searched;
  expect(categories).toBe(1);
  await page.getByRole("navigation", { name: "创作导航" }).getByRole("link", { name: "灵感发现", exact: true }).click();
  await expect(page.locator(".cr-explore-heading")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(capabilities).toBe(0);
});

test("canvas loads model once and autosaving does not restart idle jobs", async ({ page }) => {
  let capabilities = 0, jobQueries = 0, saves = 0;
  let releaseUsage;
  const usageGate = new Promise(resolve => { releaseUsage = resolve; });
  await page.route("**/api/usage", async route => {
    await usageGate;
    await route.fulfill({ json: { credits: 500, remaining: 0 } });
  });
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/studio/capabilities") capabilities++;
    if (path === "/api/studio/jobs") jobQueries++;
    if (path === "/api/studio/documents" && request.method() === "POST") saves++;
  });
  await page.route("**/api/studio/documents/perf-project?*", route => route.fulfill({ json: {
    id: "perf-project", version: 1, name: "Performance fixture", nameSource: "prompt", layerCount: 0,
    content: { schemaVersion: 1, layers: [], messages: [{ id: "m1", role: "user", text: "First prompt" }], jobs: [], appliedJobs: [] },
  } }));
  await page.route("**/api/studio/documents", async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { ...body, id: "perf-project", version: (body.version || 0) + 1 } });
  });
  await open(page, "studio-v2?document=perf-project");
  try {
    // A slow balance endpoint must not hold up model selection.
    await expect(page.getByRole("button", { name: "生图模型：GPT Image 2", exact: true })).toBeEnabled();
  } finally { releaseUsage(); }
  await expect.poll(() => jobQueries).toBe(1);
  await page.waitForLoadState("networkidle");
  expect(capabilities).toBe(1);
  await page.getByRole("textbox", { name: "创作描述" }).fill("Keep editing without submitting");
  await expect.poll(() => saves).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  expect(jobQueries).toBe(1);
});

for (const width of [1440, 390, 320]) {
  for (const theme of ["dark", "light"]) {
    test(`${theme} ${width}px: pages fit viewport, composer stays aligned`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const path of ["", "projects", "assets", "commerce", "explore", "pricing", "account", "studio-v2?new=1"]) {
        await open(page, path, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
        if (path === "assets" && width < 760) {
          const box = await page.locator(".ml-sidebar button").first().boundingBox();
          expect(box.height).toBeLessThan(60);
        }
        if (path.startsWith("studio")) {
          const model = await page.locator(".ms-composer-tools .mpk-trigger").boundingBox();
          const send = await page.locator(".ms-composer-tools > .ms-send").boundingBox();
          expect(Math.abs(model.y - send.y)).toBeLessThan(10);
          expect(await page.locator(".ms-studio").evaluate(el => getComputedStyle(el).getPropertyValue("--primary-text").trim()))
            .toBe(await page.locator("html").evaluate(el => getComputedStyle(el).getPropertyValue("--primary-text").trim()));
        }
        await page.screenshot({ path: testInfo.outputPath(`${path.split("?")[0] || "home"}.png`), animations: "disabled" });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("menus are opaque, keyboard accessible, and fit on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "");
  const user = page.getByRole("button", { name: "ui@example.invalid" });
  await user.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await expectOpaque(menu);
  await expectContained(menu, page);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem").last()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitemradio")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(user).toBeFocused();
  await page.getByRole("button", { name: "最近项目", exact: true }).click();
  const recent = page.locator(".mr-popover");
  await expectOpaque(recent);
  await expectContained(recent, page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /生图模型/ }).click();
  await expectOpaque(page.locator(".mpk-panel"));
  await expectContained(page.locator(".mpk-panel"), page);
  await page.keyboard.press("Escape");
  await open(page, "studio-v2?new=1");
  await page.getByRole("button", { name: "画布", exact: true }).click();
  const task = page.getByRole("button", { name: "任务列表", exact: true });
  await task.click();
  await expectOpaque(page.locator(".ms-task-popover"));
  await expectContained(page.locator(".ms-task-popover"), page);
});

test("project menu Escape, dialog blank space, focus trap and backdrop dismissal", async ({ page }) => {
  await open(page, "projects");
  const trigger = page.getByRole("button", { name: /项目菜单/ }).first();
  await trigger.click();
  await page.getByRole("button", { name: "重命名", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

for (const theme of ["dark", "light"]) {
  test(`${theme}: canvas tools, library and project dialogs remain readable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const picture = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#eecea4" } }).png().toBuffer();
    await page.route("**/api/assets/fixture-image?*", route => route.fulfill({ contentType: "image/png", body: picture }));
    await page.route("**/api/library?*", route => route.fulfill({ json: { items: [{ id: "item", assetId: "fixture-image", name: "界面测试图片", asset: { width: 800, height: 600 } }], nextCursor: null } }));
    await page.route("**/api/studio/capabilities**", route => route.fulfill({ json: {
      imageModels: [{ id: "fixture", label: "GPT Image 2", creditCost: 18, maxReferenceImages: 3 }], imageProvider: "fixture",
      tools: ["move", "inpaint", "erase", "expand", "crop", "upscale", "split", "video", "ocr", "remove-bg", "describe"].map(id => ({ id, available: true, cost: 18 })), planningAvailable: false,
    } }));
    await open(page, "studio-v2?new=1", theme);
    const library = page.getByRole("button", { name: "素材库", exact: true });
    const label = await page.locator(".ms-canvas-label").boundingBox();
    const entry = await library.boundingBox();
    expect(entry.x + entry.width).toBeLessThanOrEqual(label.x);
    await library.click();
    const picker = page.getByRole("dialog", { name: "选择素材", exact: true });
    await expectContained(picker, page);
    await page.getByRole("button", { name: "界面测试图片", exact: true }).first().click();
    await picker.getByRole("button", { name: "确认", exact: true }).click();
    await expect(picker).toHaveCount(0);
    for (const name of ["局部修改", "物体移动", "AI 智能消除", "AI 扩图", "图片裁剪", "AI 超清放大", "图层拆分", "生成视频", "文字识别", "一键抠图", "反推提示词"]) {
      await page.locator(".ms-context-scroll").getByRole("button", { name, exact: true }).click();
      const panel = page.locator(".ms-editor");
      await expectContained(panel, page);
      await expectOpaque(panel.locator(".ms-editor-card"));
      expect(await panel.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
      const layers = await page.locator(".ms-canvas-top-right").boundingBox();
      const zoom = await page.locator(".ms-zoom").boundingBox();
      expect(layers.x + layers.width).toBeLessThanOrEqual(zoom.x);
      await expect(page.locator(".ms-notice")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
      await page.getByRole("button", { name: "关闭工具", exact: true }).click();
    }
    await page.locator(".ms-project-trigger").click();
    const projects = page.getByRole("dialog", { name: "项目管理", exact: true });
    await expectOpaque(projects);
    await expectContained(projects, page);
    await page.keyboard.press("Escape");
    await expect(projects).toHaveCount(0);
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const exportDialog = page.getByRole("dialog", { name: "导出作品", exact: true });
    await expectContained(exportDialog, page);
    await page.keyboard.press("Escape");
    await expect(exportDialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
