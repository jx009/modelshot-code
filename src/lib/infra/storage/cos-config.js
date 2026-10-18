import { createHash } from "node:crypto";
import { z } from "zod";
import { getSiteConfig } from "../../site-config.js";
import { AppError } from "../../http.js";

export const cosConfigSchema = z.object({
  enabled: z.boolean(),
  bucket: z.string().trim().max(100).refine(v => !v || /^[a-z0-9][a-z0-9-]{0,61}-\d{5,20}$/.test(v)),
  region: z.string().trim().regex(/^[a-z]{2}-[a-z]+(?:-[a-z]+)?(?:-\d)?$/).max(50),
  prefix: z.string().trim().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/).max(100),
  secretId: z.string().trim().max(200),
  secretKey: z.string().trim().max(300),
  signedUrlSeconds: z.number().int().min(60).max(900),
}).strict();
export const COS_DEFAULTS = Object.freeze({ enabled: false, bucket: "", region: "ap-hongkong", prefix: "letaidraw", secretId: "", secretKey: "", signedUrlSeconds: 300 });

export async function getCosConfig(db) {
  const raw = await getSiteConfig("cos_delivery", db);
  if (!raw) return { ...COS_DEFAULTS };
  return cosConfigSchema.parse(JSON.parse(raw));
}
export function requireCosCredentials(config) {
  if (!config.bucket || !config.secretId || !config.secretKey) throw new AppError("COS_CREDENTIALS_REQUIRED");
  return config;
}
export function mergeCosConfig(input, old = COS_DEFAULTS) {
  const next = cosConfigSchema.parse({ ...input, secretId: input.secretId || old.secretId, secretKey: input.secretKey || old.secretKey });
  if (next.enabled) requireCosCredentials(next);
  return next;
}
export function cosConfigView(config) {
  const { secretId, secretKey, ...view } = config;
  return { ...view, credentialsConfigured: Boolean(secretId && secretKey), endpoint: config.bucket ? `https://${config.bucket}.cos.${config.region}.myqcloud.com` : "" };
}
// Changing bucket, path or credentials must invalidate every old readiness receipt.
export function cosTargetId(config) {
  return createHash("sha256").update(JSON.stringify([config.bucket, config.region, config.prefix, config.secretId, config.secretKey])).digest("hex").slice(0, 32);
}
