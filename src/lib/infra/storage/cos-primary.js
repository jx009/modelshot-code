import { getCosConfig } from "./cos-config.js";
import { cosStorage } from "./cos.js";
import { AppError } from "../../http.js";
import { ASSET_CDN_ORIGIN, validObjectPath } from "../../asset-cdn.js";

export function cosObjectKey(config, key) {
  if (!key.startsWith(`${config.prefix}/`) || !validObjectPath(key)) throw new AppError("INVALID_COS_OBJECT");
  return key;
}
export function parseCosObjectKey(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("cos://")) {
    const match = /^cos:\/\/([a-z0-9-]+)\/([a-z0-9-]+)\/(.+)$/.exec(value);
    if (!match || !validObjectPath(match[3])) throw new AppError("INVALID_COS_OBJECT");
    return { bucket: match[1], region: match[2], key: match[3] };
  }
  let key = value;
  if (value.startsWith(`${ASSET_CDN_ORIGIN}/`)) {
    try { key = decodeURIComponent(value.slice(ASSET_CDN_ORIGIN.length + 1)); }
    catch { throw new AppError("INVALID_COS_OBJECT"); }
  }
  if (!/^(?:[a-zA-Z0-9_-]+\/)+(?:originals|uploads\/pending)\//.test(key)) return null;
  if (!validObjectPath(key)) throw new AppError("INVALID_COS_OBJECT");
  return { bucket: null, region: null, key };
}

export function matchesCosTarget(object, config) {
  return object && (!object.bucket || (object.bucket === config.bucket && object.region === config.region));
}

export function cosPrimaryKeyFilters() {
  return [
    { objectKey: { startsWith: "cos://" } },
    { objectKey: { contains: "/originals/" } },
    { objectKey: { contains: "/uploads/pending/" } },
  ];
}
export async function primaryCos(value, config) {
  const object = parseCosObjectKey(value);
  if (!object) return null;
  config ||= await getCosConfig();
  // Never reinterpret an old key in a new bucket. Credential rotation is allowed.
  if (!matchesCosTarget(object, config)) throw new AppError("COS_PRIMARY_BUCKET_CHANGED", 503);
  return { key: object.key, config, store: cosStorage(config) };
}
