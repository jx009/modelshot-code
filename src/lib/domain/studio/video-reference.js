import { encryptSecret, decryptSecret } from "../../crypto.js";
import { AppError } from "../../http.js";

const ttlMs = 60 * 60 * 1000;

// Only the worker issues these links, after reading and checking the owner's image.
// Reuse the existing encryption key shared by web and worker; no public bucket is needed.
export function videoReferenceUrl(userId, assetId, env = process.env, now = Date.now()) {
  let root;
  try { root = new URL(env.NEXTAUTH_URL); } catch { throw new AppError("VIDEO_REFERENCE_URL_REQUIRED", 422); }
  if (root.protocol !== "https:" || root.username || root.password || root.hostname === "localhost") throw new AppError("VIDEO_REFERENCE_URL_REQUIRED", 422);
  const url = new URL(`/api/video/reference/${encodeURIComponent(assetId)}`, root);
  url.searchParams.set("token", encryptSecret(JSON.stringify({ purpose: "video-reference", userId, assetId, expiresAt: now + ttlMs })));
  return url.href;
}

export function videoReferenceOwner(assetId, token, now = Date.now()) {
  try {
    if (typeof token !== "string" || token.length > 2048) throw new Error("Invalid token");
    const claims = JSON.parse(decryptSecret(token));
    if (claims.purpose !== "video-reference" || claims.assetId !== assetId || typeof claims.userId !== "string" || !claims.userId
      || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now || claims.expiresAt > now + ttlMs) throw new Error("Invalid claims");
    return claims.userId;
  } catch { throw new AppError("VIDEO_REFERENCE_EXPIRED", 403); }
}
