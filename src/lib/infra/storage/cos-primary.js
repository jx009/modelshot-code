import { getCosConfig } from "./cos-config.js";
import { cosStorage } from "./cos.js";
import { AppError } from "../../http.js";

export function cosObjectKey(config, key) { return `cos://${config.bucket}/${config.region}/${key}`; }
export function parseCosObjectKey(value) {
  if (!value?.startsWith("cos://")) return null;
  const match = /^cos:\/\/([a-z0-9-]+)\/([a-z0-9-]+)\/(.+)$/.exec(value);
  if (!match || match[3].split("/").some(part => !part || part === "." || part === "..")) throw new AppError("INVALID_COS_OBJECT");
  return { bucket: match[1], region: match[2], key: match[3] };
}
export async function primaryCos(value, config) {
  const object = parseCosObjectKey(value);
  if (!object) return null;
  config ||= await getCosConfig();
  // Never reinterpret an old key in a new bucket. Credential rotation is allowed.
  if (object.bucket !== config.bucket || object.region !== config.region) throw new AppError("COS_PRIMARY_BUCKET_CHANGED", 503);
  return { key: object.key, config, store: cosStorage(config) };
}
