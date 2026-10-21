import { isCdnImageUrl } from "../asset-cdn.js";

const links = new Map();
let currentUser = null;
let epoch = 0;

export function setAssetDeliveryUser(userId) {
  const next = userId || null;
  if (next === currentUser) return;
  currentUser = next;
  epoch++;
  links.clear();
}

export const assetDeliveryEpoch = () => epoch;

export function consumeAssetDelivery(data, requestEpoch) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("assetDelivery" in data)) return data;
  const { assetDelivery, ...result } = data;
  const now = Date.now();
  if (requestEpoch !== epoch || !currentUser || assetDelivery?.userId !== currentUser || !(assetDelivery.expiresAt > now + 10000)) return result;
  for (const [key, link] of links) if (link.expiresAt <= now + 10000) links.delete(key);
  for (const item of assetDelivery.items || []) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.assetId) || ![0, 320, 640, 1280].includes(item.variant)) continue;
    let url;
    try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password ||
      (!isCdnImageUrl(item.url) && !/^[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(url.hostname))) continue;
    const key = `${item.assetId}:${item.variant}`;
    links.delete(key);
    links.set(key, { url: item.url, expiresAt: assetDelivery.expiresAt });
  }
  while (links.size > 1024) links.delete(links.keys().next().value);
  return result;
}

function assetRequest(src) {
  if (typeof src !== "string") return null;
  const match = /^\/api\/assets\/([a-zA-Z0-9_-]+)(?:\?([^#]*))?$/.exec(src);
  if (!match) return null;
  const params = new URLSearchParams(match[2]);
  const variant = params.has("preview") ? Number(params.get("preview")) : 0;
  return { path: `/api/assets/${match[1]}`, params, key: `${match[1]}:${variant}` };
}

export const isAssetImage = src => Boolean(assetRequest(src));

export function assetImageRequest(src, delivery) {
  const request = assetRequest(src);
  if (!request) return src;
  request.params.set("delivery", delivery);
  return `${request.path}?${request.params}`;
}

export function forgetAssetDelivery(src) {
  const request = assetRequest(src);
  if (request) links.delete(request.key);
}

export function resolveAssetImage(src) {
  const request = assetRequest(src);
  if (!request || request.params.get("delivery") === "proxy") return src;
  const link = links.get(request.key);
  if (link && link.expiresAt > Date.now() + 10000) return link.url;
  if (link) links.delete(request.key);
  return assetImageRequest(src, "auto");
}
