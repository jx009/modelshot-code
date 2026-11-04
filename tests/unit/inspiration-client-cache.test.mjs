import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });

async function fixture() {
  vi.resetModules();
  const storage = new Map();
  vi.stubGlobal("sessionStorage", { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  const persistent = new Map();
  vi.stubGlobal("localStorage", { getItem: key => persistent.get(key), setItem: (key, value) => persistent.set(key, value) });
  return import("../../src/lib/inspiration/client-cache.js");
}
const gallery = { items: [], layout: { mode: "masonry", columns: 4, gap: 16 } };

test("ignores old snapshots so the repaired catalogue is fetched immediately", async () => {
  const cache = await fixture();
  const old = JSON.stringify({ gallery: { ...gallery, items: [{ id: "sneaker-cobalt" }] }, savedAt: 1000 });
  sessionStorage.setItem("letaidraw:inspiration:v1", old);
  localStorage.setItem("letaidraw:inspiration:v1", old);
  expect(cache.readGalleryCache(2000)).toBeNull();
  expect(cache.galleryRefreshDelay(2000)).toBe(0);
});

test("detail link checks reuse memory instead of parsing browser storage for every card", async () => {
  const cache = await fixture();
  const item = { id: "public-one", title: "Public" };
  cache.writeGalleryCache({ ...gallery, items: [item] }, 1000);
  const sessionRead = vi.spyOn(sessionStorage, "getItem");
  const persistentRead = vi.spyOn(localStorage, "getItem");
  for (let index = 0; index < 200; index += 1) expect(cache.readCachedInspiration(item.id, 2000)).toEqual(item);
  expect(sessionRead).not.toHaveBeenCalled();
  expect(persistentRead).not.toHaveBeenCalled();
});

test("detail cache omits disabled entries and strips expired signed delivery URLs", async () => {
  const cache = await fixture();
  const item = { id: "public-one", title: "Public", imageUrl: "https://images.invalid/original?sign=1", thumbnailUrl: "https://images.invalid/thumb?sign=1" };
  cache.writeGalleryCache({ ...gallery, items: [item, { id: "disabled", enabled: false }], deliveryExpiresAt: 61000 }, 1000);
  expect(cache.readCachedInspiration(item.id, 2000)).toEqual(item);
  expect(cache.readCachedInspiration(item.id, 31000)).toEqual({ id: item.id, title: item.title });
  expect(cache.readCachedInspiration("disabled", 2000)).toBeNull();
  expect(cache.readCachedInspiration("missing", 2000)).toBeNull();
});

test("gallery metadata survives a reload without a time-based display cutoff", async () => {
  const first = await fixture();
  first.writeGalleryCache(gallery, 1000);
  vi.resetModules();
  const reloaded = await import("../../src/lib/inspiration/client-cache.js");
  expect(reloaded.readGalleryCache(2000)).toEqual(gallery);
  expect(reloaded.readGalleryCache(301000)).toEqual(gallery);
  expect(reloaded.readGalleryCache(1800999)).toEqual(gallery);
  expect(reloaded.readGalleryCache(1801000)).toEqual(gallery);
  expect(reloaded.readGalleryCache(86401000)).toEqual(gallery);
  expect(reloaded.readGalleryCache(30 * 86400000 + 1000)).toEqual(gallery);
});
test.each([31000, 61000, 601000])("expired COS links are removed without discarding public metadata at %i", async now => {
  const cache = await fixture();
  const item = { id: "public-cover", title: "Example", cover: { type: "asset", assetId: "cover-asset" }, imageUrl: "https://images.invalid/original?sign=1", thumbnailUrl: "https://images.invalid/thumbnail?sign=1" };
  const signed = { ...gallery, items: [item], deliveryExpiresAt: 61000 };
  cache.writeGalleryCache(signed, 1000);
  expect(cache.readGalleryCache(30999)).toEqual(signed);
  vi.resetModules();
  const reloaded = await import("../../src/lib/inspiration/client-cache.js");
  const cached = reloaded.readGalleryCache(now);
  expect(cached).toEqual({ ...gallery, items: [{ id: item.id, title: item.title, cover: item.cover }] });
  expect(signed.items[0].imageUrl).toBe(item.imageUrl);
  expect(JSON.parse(sessionStorage.getItem("letaidraw:inspiration:v2"))).toEqual({ gallery: signed, savedAt: 1000 });
  expect(reloaded.readGalleryCache(1801000)).toEqual(cached);
});
test("a background refresh replaces stale metadata with fresh signed links", async () => {
  const cache = await fixture();
  cache.writeGalleryCache({ ...gallery, deliveryExpiresAt: 61000 }, 1000);
  expect(cache.readGalleryCache(61000)).toEqual(gallery);
  const fresh = { ...gallery, items: [{ id: "updated", imageUrl: "https://images.invalid/original?sign=2", thumbnailUrl: "https://images.invalid/thumbnail?sign=2" }], deliveryExpiresAt: 361000 };
  cache.writeGalleryCache(fresh, 61000);
  expect(cache.readGalleryCache(62000)).toEqual(fresh);
});
test("cached metadata is rejected when the clock moves backwards", async () => {
  const cache = await fixture();
  cache.writeGalleryCache(gallery, 1000);
  expect(cache.readGalleryCache(999)).toBeNull();
});
test("blocked browser storage still allows in-memory navigation reuse", async () => {
  const cache = await fixture();
  vi.stubGlobal("sessionStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  expect(cache.readGalleryCache(1000)).toBeNull();
  cache.writeGalleryCache(gallery, 1000);
  expect(cache.readGalleryCache(2000)).toEqual(gallery);
});

test("a new session restores only public metadata without persisted COS signatures", async () => {
  const cache = await fixture();
  const item = { id: "public-cover", cover: { type: "asset", assetId: "cover-asset" }, imageUrl: "https://images.invalid/original?sign=1", thumbnailUrl: "https://images.invalid/thumbnail?sign=1" };
  cache.writeGalleryCache({ ...gallery, items: [item], deliveryExpiresAt: 61000 }, 1000);
  const snapshot = { ...gallery, items: [{ id: item.id, cover: item.cover }] };
  expect(JSON.parse(localStorage.getItem("letaidraw:inspiration:v2"))).toEqual({ gallery: snapshot, savedAt: 1000 });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.resetModules();
  const reloaded = await import("../../src/lib/inspiration/client-cache.js");
  expect(reloaded.readGalleryCache(86401000)).toEqual(snapshot);
});

test("newer persistent metadata wins over an old in-memory snapshot", async () => {
  const cache = await fixture();
  cache.writeGalleryCache({ ...gallery, items: [{ id: "removed" }] }, 1000);
  localStorage.setItem("letaidraw:inspiration:v2", JSON.stringify({ gallery, savedAt: 2000 }));
  expect(cache.readGalleryCache(3000)).toEqual(gallery);
});

test.each(["broken JSON", JSON.stringify({ gallery, savedAt: "1000" }), JSON.stringify({ gallery, savedAt: 9000 })])("invalid session entries do not hide valid persistent metadata: %s", async invalid => {
  await fixture();
  sessionStorage.setItem("letaidraw:inspiration:v2", invalid);
  localStorage.setItem("letaidraw:inspiration:v2", JSON.stringify({ gallery, savedAt: 1000 }));
  vi.resetModules();
  const cache = await import("../../src/lib/inspiration/client-cache.js");
  expect(cache.readGalleryCache(2000)).toEqual(gallery);
});

test("a successful empty response replaces the old public snapshot", async () => {
  const cache = await fixture();
  cache.writeGalleryCache({ ...gallery, items: [{ id: "removed" }] }, 1000);
  cache.writeGalleryCache(gallery, 2000);
  expect(cache.readGalleryCache(3000)).toEqual(gallery);
  expect(JSON.parse(localStorage.getItem("letaidraw:inspiration:v2"))).toEqual({ gallery, savedAt: 2000 });
});

test("persists public CDN image paths across sessions without signature expiry", async () => {
  const cache = await fixture();
  const cdnGallery = { ...gallery, items: [{ id: "public-cover", imageUrl: "https://quiz.iamshuaidi.com/letaidraw/inspiration/image/original", thumbnailUrl: "https://quiz.iamshuaidi.com/letaidraw/inspiration/image/640.webp" }] };
  cache.writeGalleryCache(cdnGallery, 1000);
  expect(JSON.parse(localStorage.getItem("letaidraw:inspiration:v2")).gallery).toEqual(cdnGallery);
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.resetModules();
  const reloaded = await import("../../src/lib/inspiration/client-cache.js");
  expect(reloaded.readGalleryCache(86401000)).toEqual(cdnGallery);
});
