export const ASSET_CDN_ORIGIN = "https://quiz.iamshuaidi.com";
export const ASSET_DELIVERY_REFRESH_MS = 24 * 60 * 60 * 1000;

export function validObjectPath(value) {
  return typeof value === "string" && value.length > 0 &&
    !/[\\?#\u0000-\u001f\u007f]/.test(value) &&
    !value.split("/").some(part => !part || part === "." || part === "..");
}

export function cdnImageUrl(objectPath) {
  if (!validObjectPath(objectPath)) throw new Error("INVALID_CDN_OBJECT_PATH");
  return `${ASSET_CDN_ORIGIN}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function isCdnImageUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ASSET_CDN_ORIGIN && !url.username && !url.password &&
      !url.search && !url.hash && validObjectPath(decodeURIComponent(url.pathname.slice(1)));
  } catch { return false; }
}
