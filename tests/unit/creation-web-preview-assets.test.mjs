import { expect, it, vi } from "vitest";
import { loadWebPreviewAssets, createWebPreviewAssetLoader } from "../../src/lib/creation/client/web-preview-assets.js";
const id = index => `preview-asset-${String(index).padStart(5,"0")}`;
function bytes(size = 32) {
  const data = new Uint8Array(size); data.set(new TextEncoder().encode("RIFF"), 0); data.set(new TextEncoder().encode("WEBP"), 8); return data;
}
const response = (size = 32) => new Response(bytes(size), { headers: { "Content-Type": "image/webp", "Content-Length": String(size) } });
it("reuses images during editing but isolates mounted editor sessions", async () => {
  const load = createWebPreviewAssetLoader(), fetcher = vi.fn(async () => response());
  const original = await load([id(1)], { fetcher });
  expect(await load([id(1)], { fetcher })).toEqual(original);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await load([id(1), id(2)], { fetcher });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await createWebPreviewAssetLoader()([id(1)], { fetcher });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("publishes each image without waiting for a slower image and bounds cached plus new bytes", async () => {
  const load = createWebPreviewAssetLoader(), onImage = vi.fn();
  let release;
  const fetcher = vi.fn(url => url.includes(id(2)) ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response()));
  const task = load([id(1), id(2)], { fetcher, onImage });
  await vi.waitFor(() => expect(onImage).toHaveBeenCalledWith(id(1), expect.any(String)));
  release(response()); await task;
  const bounded = createWebPreviewAssetLoader(), large = async () => response(1024 * 1024);
  await bounded(Array.from({ length: 6 }, (_, i) => id(i)), { fetcher: large });
  await expect(bounded(Array.from({ length: 7 }, (_, i) => id(i)), { fetcher: large })).rejects.toThrow("WEB_PREVIEW_ASSET_LIMIT");
});
it("deduplicates IDs, limits concurrency to two and sends only fixed authenticated proxy requests", async () => {
  let active = 0, maximum = 0;
  const fetcher = vi.fn(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return response(); });
  const images = await loadWebPreviewAssets([id(1), id(2), id(1), id(3)], { fetcher });
  expect(images.size).toBe(3); expect(maximum).toBe(2); expect(images.get(id(1))).toMatch(/^data:image\/webp;base64,/);
  expect(fetcher.mock.calls[0][0]).toBe(`/api/assets/${id(1)}?preview=1280&delivery=proxy`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
});
it("rejects invalid IDs before network access and blocks non-raster or unavailable responses", async () => {
  const fetcher = vi.fn();
  await expect(loadWebPreviewAssets(["https://evil.test"], { fetcher })).rejects.toThrow("WEB_PREVIEW_ASSET_LIMIT");
  await expect(loadWebPreviewAssets(Array.from({ length: 21 }, (_, i) => id(i)), { fetcher })).rejects.toThrow("WEB_PREVIEW_ASSET_LIMIT");
  expect(fetcher).not.toHaveBeenCalled();
  for (const value of [new Response("Denied", { status: 403 }), new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }), new Response("<html>bad</html>", { headers: { "content-type": "image/webp" } })]) {
    await expect(loadWebPreviewAssets([id(1)], { fetcher: async () => value })).rejects.toThrow(/WEB_PREVIEW_ASSET_(TYPE|UNAVAILABLE)/);
  }
});
it("enforces streamed and aggregate byte budgets even with missing or deceptive Content-Length", async () => {
  await expect(loadWebPreviewAssets([id(1)], { fetcher: async () => new Response(bytes(1024 * 1024 + 1), { headers: { "content-type": "image/webp", "content-length": "1" } }) })).rejects.toThrow("WEB_PREVIEW_ASSET_LIMIT");
  await expect(loadWebPreviewAssets(Array.from({ length: 7 }, (_, i) => id(i)), { fetcher: async () => response(1024 * 1024) })).rejects.toThrow("WEB_PREVIEW_ASSET_LIMIT");
});
it("aborts active requests and does not start queued images when the preview is superseded", async () => {
  const controller = new AbortController(), signals = [];
  const fetcher = vi.fn((_url, { signal }) => { signals.push(signal); return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const pending = loadWebPreviewAssets([id(1), id(2), id(3)], { signal: controller.signal, fetcher });
  controller.abort(new Error("Superseded"));
  await expect(pending).rejects.toThrow("Superseded"); expect(fetcher).toHaveBeenCalledTimes(2); expect(signals.every(signal => signal.aborted)).toBe(true);
});
it("does not reuse image bytes across preview sessions or bypass a revoked asset", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("Denied", { status: 403 }));
  await loadWebPreviewAssets([id(1)], { fetcher });
  await expect(loadWebPreviewAssets([id(1)], { fetcher })).rejects.toThrow("WEB_PREVIEW_ASSET_UNAVAILABLE");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
