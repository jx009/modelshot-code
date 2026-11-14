import { after } from "next/server";
import { publicInspirationGallery } from "./inspiration.js";
import { enqueueInspirationGallery, inspirationDelivery } from "./inspiration-delivery.js";

// 公开灵感库的进程内缓存：内容来自管理端配置，与登录用户无关。
// 同一时刻的并发请求合并为一次加载；管理端保存后调用 invalidate 立即失效。
const READY_TTL_MS = 60_000;
const PENDING_TTL_MS = 15_000; // COS 副本未就绪时缩短缓存，尽快拿到 CDN 地址

let entry = null;

export async function cachedPublicGallery(load, now = Date.now()) {
  if (entry?.value && entry.expiresAt > now) return entry.value;
  if (entry?.loading) return entry.loading;
  const loading = load().then(value => {
    entry = { value, expiresAt: Date.now() + (value.deliveryPending ? PENDING_TTL_MS : READY_TTL_MS) };
    return value;
  }, error => {
    entry = null;
    throw error;
  });
  entry = { ...entry, loading };
  return loading;
}

export function invalidatePublicGallery() {
  entry = null;
}

export const GALLERY_CACHE_CONTROL = "public, max-age=30, s-maxage=60, stale-while-revalidate=600";

// API 与作品详情页共用同一份缓存，详情页不再逐次查库。
export function deliveredPublicGallery() {
  return cachedPublicGallery(async () => {
    const gallery = await publicInspirationGallery();
    const result = await inspirationDelivery(gallery);
    if (result.deliveryPending) after(() => enqueueInspirationGallery(gallery));
    return result;
  });
}
