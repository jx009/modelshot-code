// Public gallery metadata only. Never store user sessions, balances or private assets.
const KEY = "letaidraw:inspiration:v1";
const MAX_AGE = 5 * 60 * 1000;
let memory;

export function readGalleryCache(now = Date.now()) {
  try {
    const entry = memory || JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (!entry || !Array.isArray(entry.gallery?.items) || !entry.gallery.layout ||
        now - entry.savedAt >= MAX_AGE || now < entry.savedAt ||
        (entry.gallery.deliveryExpiresAt && entry.gallery.deliveryExpiresAt <= now + 30000)) return null;
    memory = entry;
    return entry.gallery;
  } catch { return null; }
}

export function writeGalleryCache(gallery, now = Date.now()) {
  memory = { gallery, savedAt: now };
  try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* In-memory reuse still works. */ }
}
