import { expect, it, vi } from "vitest";
import { createSlidePreviewAssets } from "../../src/lib/creation/client/slide-preview-assets.js";

it("deduplicates images across visible slides and caches them for scrolling back", async () => {
  const fetchImages = vi.fn(async ids => new Map(ids.map(id => [id, "data:image/webp;base64,AAAA"])));
  const assets = createSlidePreviewAssets(fetchImages);
  await Promise.all([assets.read(["image"]), assets.read(["image"])]);
  await assets.read(["image"]);
  expect(fetchImages).toHaveBeenCalledTimes(1);
  assets.clear(); await assets.read(["image"]);
  expect(fetchImages).toHaveBeenCalledTimes(2);
});
it("cancels one subscriber without aborting another slide's request", async () => {
  let resolve, sharedSignal;
  const assets = createSlidePreviewAssets(vi.fn((ids, { signal }) => { sharedSignal = signal; return new Promise(done => { resolve = done; }); }));
  const abort = new AbortController();
  const first = assets.read(["image"], { signal: abort.signal }).catch(error => error);
  const second = assets.read(["image"]);
  abort.abort(); expect(sharedSignal.aborted).toBe(false);
  resolve(new Map([["image", "data:image/webp;base64,AAAA"]]));
  await first; expect((await second).has("image")).toBe(true);
});
it("caps requests across the whole viewer at two and releases cancelled work", async () => {
  const requests = [];
  const assets = createSlidePreviewAssets(vi.fn((ids, { signal }) => new Promise((resolve, reject) => {
    requests.push({ ids, resolve, signal }); signal.addEventListener("abort", () => reject(signal.reason));
  })));
  const abort = new AbortController();
  const read = assets.read(["a", "b", "c", "d"], { signal: abort.signal }).catch(error => error);
  expect(requests).toHaveLength(2);
  abort.abort(); await read;
  expect(requests.every(request => request.signal.aborted)).toBe(true);
});
