import { AppError } from "../../http.js";
import { gptBestApi } from "../../video/gptbest-catalog.js";

const sourceApis = {
  "sora-remix": ["sora", "sora-remix"],
  "luma-extend": ["luma", "luma-async", "luma-extend"],
  "kling-video-extend": ["kling-text2video", "kling-image2video", "kling-multi-image2video", "kling-omni-video", "kling-video-extend"],
};
const endpoint = url => { try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "").replace(/\/v[12]$/, "")}`; } catch { return null; } };

export function compatibleVideoSource(snapshot, destination) {
  if (snapshot?.tool !== "video" || destination.videoKind !== "gptbest" || snapshot.videoKind !== "gptbest") return false;
  if (!endpoint(snapshot.videoBaseURL) || endpoint(snapshot.videoBaseURL) !== endpoint(destination.videoURL)) return false;
  const allowed = sourceApis[destination.videoOptions?.api];
  if (!allowed?.includes(snapshot.videoOptions?.api)) return false;
  // A remote task belongs to its upstream account, not merely its host.
  // Cross-channel use requires the same configured upstream credential.
  return snapshot.videoProvider === destination.videoProvider || destination.sourceProviderNames?.includes(snapshot.videoProvider) === true;
}

export async function sourceProviderNames(config, db) {
  const selected = await db.modelProvider.findFirst({ where: { name: config.videoProvider, isActive: true, kind: "gptbest" }, select: { config: true } });
  if (!selected) return [];
  const { apiKeyEnc } = JSON.parse(selected.config || "{}");
  if (!apiKeyEnc) return [config.videoProvider];
  const { decryptSecret } = await import("../../crypto.js");
  const credential = decryptSecret(apiKeyEnc);
  const rows = await db.modelProvider.findMany({ where: { isActive: true, kind: "gptbest" }, select: { name: true, config: true } });
  return rows.filter(row => {
    try {
      const value = JSON.parse(row.config || "{}");
      return endpoint(value.baseURL) === endpoint(config.videoURL) && value.apiKeyEnc && decryptSecret(value.apiKeyEnc) === credential;
    } catch { return false; }
  }).map(row => row.name);
}

export async function assertVideoSource(userId, config, fields, db, providers) {
  const sourceField = gptBestApi(config.videoOptions?.api)?.fields?.find(field => ["sourceTaskId", "video_id"].includes(field.key));
  if (!sourceField) return;
  const identity = fields?.[sourceField.key] || config.videoOptions.parameters?.[sourceField.key];
  if (!identity) throw new AppError("VIDEO_FIELDS_REQUIRED", 422);
  const where = { userId, status: "succeeded", AND: [{ snapshot: { path: ["tool"], equals: "video" } }, { snapshot: { path: ["videoProvider"], equals: config.videoProvider } }] };
  const names = providers || [config.videoProvider];
  where.AND[1] = { OR: names.map(name => ({ snapshot: { path: ["videoProvider"], equals: name } })) };
  if (sourceField.key === "video_id") where.resultData = { path: ["providerVideoId"], equals: identity };
  else where.attempts = { some: { requestId: identity } };
  const candidates = await db.tryOn.findMany({ where, select: { snapshot: true }, take: 30 });
  if (!candidates.some(row => compatibleVideoSource(row.snapshot, { ...config, sourceProviderNames: names }))) throw new AppError("VIDEO_SOURCE_NOT_FOUND", 404);
}
