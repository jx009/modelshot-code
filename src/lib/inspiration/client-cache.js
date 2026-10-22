import { isCdnImageUrl } from "../asset-cdn.js";

// Public gallery metadata only. Never store user sessions, balances or private assets.
const KEY = "letaidraw:inspiration:v1";
let memory;

function withoutDeliveryLinks(gallery) {
  const snapshot = { ...gallery, items: gallery.items.map(item => {
    const cachedItem = { ...item };
    if (!isCdnImageUrl(cachedItem.imageUrl)) delete cachedItem.imageUrl;
    if (!isCdnImageUrl(cachedItem.thumbnailUrl)) delete cachedItem.thumbnailUrl;
    return cachedItem;
  }) };
  delete snapshot.deliveryExpiresAt;
  return snapshot;
}

function readStoredCache(storage) {
  try { return JSON.parse(globalThis[storage]?.getItem(KEY) || "null"); }
  catch { return null; }
}

export function readGalleryCache(now = Date.now()) {
  try {
    const entry = [memory, readStoredCache("sessionStorage"), readStoredCache("localStorage")]
      .filter(candidate => candidate && Array.isArray(candidate.gallery?.items) && candidate.gallery.layout &&
        Number.isFinite(candidate.savedAt) && candidate.savedAt >= 0 && candidate.savedAt <= now)
      .sort((first, second) => second.savedAt - first.savedAt)[0];
    if (!entry) return null;
    memory = entry;
    if (entry.gallery.deliveryExpiresAt && entry.gallery.deliveryExpiresAt <= now + 30000) {
      return withoutDeliveryLinks(entry.gallery);
    }
    return entry.gallery;
  } catch { return null; }
}

export function writeGalleryCache(gallery, now = Date.now()) {
  memory = { gallery, savedAt: now };
  try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* In-memory reuse still works. */ }
  try { localStorage.setItem(KEY, JSON.stringify({ gallery: withoutDeliveryLinks(gallery), savedAt: now })); } catch {}
}

export function readCachedInspiration(id, now = Date.now()) {
  const gallery = memory && memory.savedAt <= now ? memory.gallery : readGalleryCache(now);
  const item = gallery?.items.find(item => item.id === id && item.enabled !== false);
  if (!item) return null;
  return gallery.deliveryExpiresAt && gallery.deliveryExpiresAt <= now + 30000
    ? withoutDeliveryLinks({ items: [item] }).items[0]
    : item;
}

export function galleryRefreshDelay(now = Date.now()) {
  if (!readGalleryCache(now) || !memory) return 0;
  const { gallery, savedAt } = memory;
  const refreshAt = Math.min(savedAt + (gallery.deliveryPending ? 15000 : 60000), gallery.deliveryExpiresAt ? gallery.deliveryExpiresAt - 30000 : Infinity);
  return Math.max(0, refreshAt - now);
}
