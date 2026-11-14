import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT } from "../../src/lib/inspiration/gallery.js";
import { SHOWCASE_IDS } from "../../src/lib/inspiration/display-order.js";

async function galleryFixture(page, { count = 40, onGallery } = {}) {
  const bytes = await sharp({ create: { width: 320, height: 480, channels: 3, background: "#a8b6a1" } }).webp().toBuffer();
  const items = Array.from({ length: count }, (_, i) => ({
    ...DEFAULT_ITEMS[0], id: `fixture-${i}`, title: `作品 ${i}`, size: "1024x1536",
    imageUrl: `https://gallery-fixture.invalid/${i}/original`,
    thumbnailUrl: `https://gallery-fixture.invalid/${i}/640.webp`,
  }));
  const gallery = { items, layout: DEFAULT_LAYOUT, deliveryExpiresAt: Date.now() + 3600000 };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: null });
    if (path === "/api/inspiration") return onGallery ? onGallery(route, gallery) : route.fulfill({ json: gallery });
    return route.fulfill({ json: {} });
  });
  const images = [];
  await page.route("https://gallery-fixture.invalid/**", route => {
    images.push(route.request().url());
    return route.fulfill({ contentType: "image/webp", body: bytes });
  });
  return { gallery, images };
}

for (const width of [1440, 390]) test(`gallery requests images only near the viewport (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const { images } = await galleryFixture(page);
  await page.goto("/zh/explore");
  const cards = page.locator(".ig-card");
  await expect(cards).toHaveCount(40);
  await expect.poll(() => images.length).toBeGreaterThan(0);
  const bottom = await cards.evaluateAll(nodes => nodes.map((node, index) => ({ index, id: new URL(node.href).pathname.split("/").at(-1), top: node.getBoundingClientRect().top })).sort((a, b) => b.top - a.top)[0]);
  const bottomImage = `https://gallery-fixture.invalid/${bottom.id.replace("fixture-", "")}/640.webp`;
  expect(images).not.toContain(bottomImage);
  expect(images.length).toBeLessThan(20);
  await expect(cards.nth(bottom.index).locator("img")).toHaveCount(0);
  await cards.nth(bottom.index).scrollIntoViewIfNeeded();
  await expect.poll(() => images.includes(bottomImage)).toBe(true);
  await expect.poll(() => cards.nth(bottom.index).locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  if (width > 650) {
    await page.getByLabel("搜索灵感").fill("作品 39");
    await expect(cards).toHaveCount(1);
    await cards.first().scrollIntoViewIfNeeded();
    await expect(cards.first().locator("img")).toBeVisible();
  }
});

for (const [width, columns] of [[390, 2], [1000, 3], [1440, 4], [1800, 5]]) test(`new artwork occupies the visible first row (${columns} columns)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const items = DEFAULT_ITEMS.map(item => ({ ...item, imageUrl: `https://gallery-fixture.invalid/${item.id}` }));
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/inspiration" ? { items, layout: { ...DEFAULT_LAYOUT, columns } } : path === "/api/auth/session" ? null : {} });
  });
  await page.route("https://gallery-fixture.invalid/**", async route => {
    const item = DEFAULT_ITEMS.find(item => new URL(route.request().url()).pathname === `/${item.id}`);
    return route.fulfill({ contentType: "image/webp", body: await readFile(`public/inspiration/generated/${item.cover.file}.${item.imageVersion}.webp`) });
  });
  await page.goto("/zh#inspiration");
  await expect(page.locator(".ig-masonry-column")).toHaveCount(columns);
  const firstRow = page.locator(".ig-masonry-column > .ig-card:first-child");
  await expect(firstRow).toHaveCount(columns);
  for (let index = 0; index < columns; index++) {
    await expect(firstRow.nth(index)).toHaveAttribute("href", new RegExp(`/explore/${SHOWCASE_IDS[index]}$`));
    await expect.poll(() => firstRow.nth(index).locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  const tops = await firstRow.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
});

test("reload displays cached gallery while metadata revalidation is pending", async ({ page }) => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  await galleryFixture(page, { count: 1, onGallery: async (route, gallery) => {
    if (++calls > 1) await gate;
    await route.fulfill({ json: gallery });
  } });
  try {
    await page.goto("/zh/explore");
    await expect(page.locator(".ig-cover img")).toBeVisible();
    await page.reload();
    await expect.poll(() => calls).toBeGreaterThan(1);
    await expect(page.locator(".ig-cover img")).toBeVisible();
    await expect(page.getByText("正在加载灵感作品…")).toHaveCount(0);
  } finally { release(); }
});

test("home has two creative modes and does not preload every workspace", async ({ page }) => {
  await galleryFixture(page, { count: 1 });
  const speculative = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (/^\/zh\/(studio-v2|commerce|projects|assets)$/.test(url.pathname)) speculative.push(url.pathname);
  });
  await page.goto("/zh");
  await page.mouse.move(0, 0);
  const tabs = page.getByRole("tablist", { name: "创作类型" });
  await expect(tabs.getByRole("tab", { name: "快速", exact: true })).toHaveCount(0);
  // Previous idle prefetch launched all module routes within four seconds.
  await page.waitForTimeout(5500);
  expect(speculative).toEqual([]);
  await tabs.getByRole("tab", { name: /电商套图/ }).click();
  await expect(page.getByLabel("产品名称", { exact: true })).toBeVisible();
});
