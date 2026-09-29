import sharp from "sharp";
import { createHash } from "node:crypto";
import { requireUser } from "../../../../lib/require-user.js";
import { AppError, errorResponse, readBytes, sameOrigin } from "../../../../lib/http.js";
import { readOwnedImage, createImage, ownedAsset } from "../../../../lib/domain/assets/service.js";
import { rateLimit } from "../../../../lib/domain/identity/rate-limit.js";
import { studioConfig } from "../../../../lib/domain/studio/providers.js";
import { segmentCloudImage } from "../../../../lib/domain/studio/cloud.js";
import { selectionPrompt, extractObject, maskBounds } from "../../../../lib/domain/studio/segmentation.js";
import { maskPixels } from "../../../../lib/domain/studio/pixels.js";
import { segmentChannelReady } from "../../../../lib/studio/model-channels.js";

const LIMIT = 10 * 1024 * 1024 + 32_768;

export async function POST(request) {
  try {
    const started = performance.now();
    const user = await requireUser();
    sameOrigin(request);
    await rateLimit("studio-segment", user.id, 60, 600);
    const bytes = await readBytes(request, LIMIT);
    let form;
    try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new AppError("INVALID_UPLOAD"); }
    const assetId = form.get("assetId"), selection = form.get("selection");
    if (typeof assetId !== "string" || !(selection instanceof File)) throw new AppError("INVALID_INPUT");
    const sourceMeta = await ownedAsset(user.id, assetId);
    const selectionBytes = Buffer.from(await selection.arrayBuffer());
    const selectionMeta = await sharp(selectionBytes).metadata();
    if (!sourceMeta.width || !sourceMeta.height || selectionMeta.width !== sourceMeta.width || selectionMeta.height !== sourceMeta.height) throw new AppError("MASK_SIZE_MISMATCH");
    const tool = form.get("tool") || "move";
    if (!["move", "inpaint"].includes(tool)) throw new AppError("INVALID_INPUT");
    const config = await studioConfig(undefined, undefined, "segment", tool);
    if (!config.toolEnabled) throw new AppError("TOOL_DISABLED", 503);
    if (!segmentChannelReady(config.segmentChannel)) throw new AppError("SEGMENTATION_NOT_CONFIGURED", 503);
    let point;
    try { if (form.get("point")) point = JSON.parse(form.get("point")); } catch { throw new AppError("INVALID_SELECTION"); }
    const prompt = await selectionPrompt(selectionBytes, sourceMeta.width, sourceMeta.height, point);
    const json = request.headers.get("accept")?.includes("application/json");
    const cache = createHash("sha256").update(user.id).update(sourceMeta.checksum).update(selectionBytes).update(JSON.stringify([prompt, config.segmentChannel.name, config.segmentChannel.kind, config.segmentChannel.model, config.segmentChannel.baseURL, "v4"])).digest("hex").slice(0, 48);
    const ids = { mask: `${cache}_mask`, cutout: `${cache}_cutout`, object: `${cache}_object`, hole: `${cache}_hole` };
    if (json) {
      const cached = await Promise.all(Object.entries(ids).map(async ([key, id]) => [key, await ownedAsset(user.id, id).catch(() => null)]));
      if (cached.every(([, asset]) => asset)) {
        const mask = await readOwnedImage(user.id, ids.mask);
        const bounds = maskBounds(await maskPixels(mask, sourceMeta.width, sourceMeta.height), sourceMeta.width, sourceMeta.height);
        return Response.json({ ...ids, bounds, width: sourceMeta.width, height: sourceMeta.height }, { headers: { "Cache-Control": "no-store", "Server-Timing": "segment_cache;dur=" + (performance.now() - started).toFixed(1) } });
      }
    }
    let mask;
    const source = await readOwnedImage(user.id, assetId);
    const providerStarted = performance.now();
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
      mask = await segmentCloudImage(config.segmentChannel, source, prompt, signal, selectionBytes);
    }
    catch (error) {
      if (error.code === "PROVIDER_REJECTED") {
        if ([401, 403].includes(error.status)) throw new AppError("SEGMENTATION_CREDENTIALS", 422);
        if (error.status === 429) throw new AppError("SEGMENTATION_RATE_LIMITED", 429, true);
        throw new AppError("SEGMENTATION_REJECTED", 422);
      }
      if (error instanceof AppError) throw error;
      throw new AppError(["TimeoutError", "AbortError"].includes(error.name) ? "SEGMENTATION_TIMEOUT" : "SEGMENTATION_UNAVAILABLE", 503, true);
    }
    const extracted = await extractObject(source, mask);
    const providerFinished = performance.now();
    if (json) {
      await Promise.all(Object.entries({ mask, cutout: extracted.cutout, object: extracted.object, hole: extracted.hole }).map(([key, bytes]) => createImage(user.id, bytes, { id: ids[key] })));
      return Response.json({ ...ids, bounds: extracted.bounds, width: sourceMeta.width, height: sourceMeta.height }, { headers: { "Cache-Control": "no-store", "Server-Timing": "prepare;dur=" + (providerStarted - started).toFixed(1) + ", provider;dur=" + (providerFinished - providerStarted).toFixed(1) + ", persist;dur=" + (performance.now() - providerFinished).toFixed(1) } });
    }
    return new Response(extracted.cutout, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
