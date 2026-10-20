import { test, expect } from "@playwright/test";
import sharp from "sharp";

async function fixtures(page, state, bytes) {
  const items = [];
  const calls = { put: 0, complete: 0, library: 0, proxy: 0 };
  await page.route("https://fixture.cos.ap-guangzhou.myqcloud.com/**", async route => {
    calls.put++;
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["content-type"]).toBe("image/png");
    expect(route.request().postDataBuffer()).toEqual(bytes);
    if (state.blocked) return route.abort("failed");
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.pathname === "/api/upload/direct") {
      if (method === "POST") return route.fulfill({ json: { mode: "cos", url: "https://fixture.cos.ap-guangzhou.myqcloud.com/pending/image.png?fixture", uploadId: "asset-fixture", headers: { "Content-Type": "image/png" } } });
      calls.complete++;
      return route.fulfill({ json: { assetId: "asset-fixture", width: 64, height: 48, url: "/api/assets/asset-fixture" } });
    }
    if (url.pathname === "/api/upload") { calls.proxy++; return route.fulfill({ status: 500, json: {} }); }
    if (url.pathname === "/api/library") {
      if (method === "POST") {
        calls.library++;
        const data = route.request().postDataJSON();
        expect(data.assetId).toBe("asset-fixture");
        items.push({ id: "library-fixture", name: data.name, assetId: data.assetId, categoryId: null, asset: { width: 64, height: 48 } });
        return route.fulfill({ json: items[0] });
      }
      return route.fulfill({ json: { items, nextCursor: null } });
    }
    if (url.pathname.startsWith("/api/assets/")) return route.fulfill({ contentType: "image/png", body: bytes });
    const data = {
      "/api/auth/session": { user: { id: "upload-user", email: "upload@example.invalid", credits: 500 }, expires: "2099-01-01T00:00:00Z" },
      "/api/library/categories": [],
      "/api/studio/documents": { items: [], nextCursor: null },
    };
    return route.fulfill({ json: data[url.pathname] || {} });
  });
  return calls;
}

for (const blocked of [false, true]) test(`asset library uses the shared COS upload flow${blocked ? " and can retry a CORS failure" : ""}`, async ({ page }) => {
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer();
  const state = { blocked }, calls = await fixtures(page, state, bytes);
  await page.goto("/zh/assets");
  const input = page.getByLabel("上传素材文件");
  const error = page.locator(".ml-library").getByRole("alert");
  const file = { name: "素材上传.png", mimeType: "image/png", buffer: bytes };
  await expect(page.locator(".ml-grid")).toHaveAttribute("aria-busy", "false");
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/library" && response.request().method() === "GET");
  await input.setInputFiles(file);
  await refresh;
  await expect(page.locator(".ml-grid")).toHaveAttribute("aria-busy", "false");
  if (blocked) {
    await expect(error).toContainText("CORS");
    await expect(error).toContainText("PUT");
    expect(calls).toEqual({ put: 1, complete: 0, library: 0, proxy: 0 });
    await expect(page.getByRole("button", { name: "上传素材", exact: true })).toBeEnabled();
    state.blocked = false;
    await input.setInputFiles(file);
  }
  await expect(page.locator(".ml-name")).toHaveText("素材上传.png");
  await expect(error).toHaveCount(0);
  expect(calls).toEqual({ put: blocked ? 2 : 1, complete: 1, library: 1, proxy: 0 });
});
