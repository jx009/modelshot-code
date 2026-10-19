import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { DEFAULT_ITEMS, DEFAULT_LAYOUT } from "../../src/lib/inspiration/gallery.js";

for (const fail of [false, true]) test(`gallery loads COS directly${fail ? " and falls back on COS failure" : " without the US optimizer"}`, async ({ page }) => {
  const bytes = await sharp({ create: { width: 640, height: 960, channels: 3, background: "#cba180" } }).webp().toBuffer();
  const item = { ...DEFAULT_ITEMS[0], imageUrl: "https://gallery-fixture.invalid/original?sign=1", thumbnailUrl: "https://gallery-fixture.invalid/640.webp?sign=1" };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: null });
    if (url.pathname === "/api/inspiration") return route.fulfill({ json: { items: [item], layout: DEFAULT_LAYOUT } });
    return route.fulfill({ json: {} });
  });
  const requested = [];
  page.on("request", req => requested.push(req.url()));
  await page.route("https://gallery-fixture.invalid/**", route => fail ? route.fulfill({ status: 403, body: "expired" }) : route.fulfill({ contentType: "image/webp", body: bytes }));
  await page.route("**/inspiration/generated/**", route => route.fulfill({ contentType: "image/webp", body: bytes }));
  await page.goto("/zh/explore");
  const img = page.locator(".ig-cover img");
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(requested).toContain(item.thumbnailUrl);
  expect(requested.some(url => url.includes("/_next/image"))).toBe(false);
  await expect(img).toHaveAttribute("src", fail ? /\/inspiration\/generated\// : item.thumbnailUrl);
});

test("the first visitor adopts the mirrored thumbnail without reloading the page", async ({ page }) => {
  const bytes = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#339988" } }).webp().toBuffer();
  let requests = 0;
  const item = { ...DEFAULT_ITEMS[0], cover: { type: "asset", assetId: "test-asset" } };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: null });
    if (url.pathname === "/api/inspiration") {
      requests++;
      return route.fulfill({ json: { items: [requests === 1 ? item : { ...item, imageUrl: "https://gallery-fixture.invalid/original", thumbnailUrl: "https://gallery-fixture.invalid/640.webp" }], layout: DEFAULT_LAYOUT, deliveryPending: requests === 1 } });
    }
    if (url.pathname.endsWith("/image")) return route.fulfill({ contentType: "image/webp", body: bytes });
    return route.fulfill({ json: {} });
  });
  await page.route("https://gallery-fixture.invalid/**", route => route.fulfill({ contentType: "image/webp", body: bytes }));
  await page.goto("/zh/explore");
  await expect(page.locator(".ig-cover img")).toHaveAttribute("src", /\/api\/inspiration\//);
  await expect(page.locator(".ig-cover img")).toHaveAttribute("src", "https://gallery-fixture.invalid/640.webp");
});
