export const nativeDocumentAssetSource = assetId => `/api/assets/${encodeURIComponent(assetId)}?preview=1280&delivery=proxy`;
export function nativeDocumentAssetId(source) {
  return typeof source === "string" ? /^\/api\/assets\/([a-zA-Z0-9_-]{1,128})\?preview=1280&delivery=proxy$/.exec(source)?.[1] || null : null;
}
export function safeNativeOfficeLink(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try { const url = new URL(value); return ["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
