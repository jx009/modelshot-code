import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });

async function fixture() {
  vi.resetModules();
  const storage = new Map();
  vi.stubGlobal("sessionStorage", { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  return import("../../src/lib/inspiration/client-cache.js");
}
const gallery = { items: [], layout: { mode: "masonry", columns: 4, gap: 16 } };

test("gallery metadata survives a reload but expires after five minutes", async () => {
  const first = await fixture();
  first.writeGalleryCache(gallery, 1000);
  vi.resetModules();
  const reloaded = await import("../../src/lib/inspiration/client-cache.js");
  expect(reloaded.readGalleryCache(2000)).toEqual(gallery);
  expect(reloaded.readGalleryCache(301000)).toBeNull();
});
test("cached COS links are not displayed near or after signature expiry", async () => {
  const cache = await fixture();
  cache.writeGalleryCache({ ...gallery, deliveryExpiresAt: 61000 }, 1000);
  expect(cache.readGalleryCache(2000)).not.toBeNull();
  expect(cache.readGalleryCache(31000)).toBeNull();
});
test("blocked browser storage still allows in-memory navigation reuse", async () => {
  const cache = await fixture();
  vi.stubGlobal("sessionStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  expect(cache.readGalleryCache(1000)).toBeNull();
  cache.writeGalleryCache(gallery, 1000);
  expect(cache.readGalleryCache(2000)).toEqual(gallery);
});
