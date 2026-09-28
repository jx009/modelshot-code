import sharp from "sharp";
import { createHash } from "node:crypto";
import { requireUser } from "../../../../lib/require-user.js";
import { AppError, errorResponse, readBytes, sameOrigin } from "../../../../lib/http.js";
import { readOwnedImage, createImage, ownedAsset } from "../../../../lib/domain/assets/service.js";
import { rateLimit } from "../../../../lib/domain/identity/rate-limit.js";
import { studioConfig, toolService } from "../../../../lib/domain/studio/providers.js";
import { segmentCloudImage } from "../../../../lib/domain/studio/cloud.js";
import { selectionPrompt, extractObject } from "../../../../lib/domain/studio/segmentation.js";

const LIMIT = 10 * 1024 * 1024 + 32_768;

export async function POST(request) {
  try {
    const user = await requireUser();
    sameOrigin(request);
    await rateLimit("studio-segment", user.id, 60, 600);
    const bytes = await readBytes(request, LIMIT);
    let form;
    try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new AppError("INVALID_UPLOAD"); }
    const assetId = form.get("assetId"), selection = form.get("selection");
    if (typeof assetId !== "string" || !(selection instanceof File)) throw new AppError("INVALID_INPUT");
    const source = await readOwnedImage(user.id, assetId);
    const selectionBytes = Buffer.from(await selection.arrayBuffer());
    const [sourceMeta, selectionMeta] = await Promise.all([sharp(source).metadata(), sharp(selectionBytes).metadata()]);
    if (!sourceMeta.width || !sourceMeta.height || selectionMeta.width !== sourceMeta.width || selectionMeta.height !== sourceMeta.height) throw new AppError("MASK_SIZE_MISMATCH");
    const tool = form.get("tool") || "move";
    if (!["move", "inpaint"].includes(tool)) throw new AppError("INVALID_INPUT");
    const config = await studioConfig(undefined, undefined, "segment", tool);
    if (!config.toolEnabled) throw new AppError("TOOL_DISABLED", 503);
    if (!config.segmentChannel?.apiKey && (!config.toolsURL || !config.toolsKey)) throw new AppError("SEGMENTATION_NOT_CONFIGURED", 503);
    let point;
    try { if (form.get("point")) point = JSON.parse(form.get("point")); } catch { throw new AppError("INVALID_SELECTION"); }
    const prompt = await selectionPrompt(selectionBytes, sourceMeta.width, sourceMeta.height, point);
    const json = request.headers.get("accept")?.includes("application/json");
    const cache = createHash("sha256").update(user.id).update(source).update(selectionBytes).update(JSON.stringify([prompt, config.segmentChannel?.name, config.segmentChannel?.model, config.segmentChannel?.baseURL, config.toolsURL, "v1"])).digest("hex").slice(0, 48);
    const ids = { mask: `${cache}_mask`, cutout: `${cache}_cutout`, object: `${cache}_object`, hole: `${cache}_hole` };
    if (json) {
      const cached = await Promise.all(Object.entries(ids).map(async ([key, id]) => [key, await ownedAsset(user.id, id).catch(() => null)]));
      if (cached.every(([, asset]) => asset)) {
        const mask = await readOwnedImage(user.id, ids.mask);
        const { bounds } = await extractObject(source, mask);
        return Response.json({ ...ids, bounds, width: sourceMeta.width, height: sourceMeta.height }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    let result;
    let mask;
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
      if (config.segmentChannel?.apiKey) mask = await segmentCloudImage(config.segmentChannel, source, prompt, signal);
      else {
        result = await toolService(config, "segment", source, {}, signal, { selection: selectionBytes });
        mask = await sharp(result).ensureAlpha().extractChannel("alpha").png().toBuffer();
      }
    }
    catch (error) {
      if (error instanceof AppError && error.code === "TOOL_SERVICE_FAILED" && error.status === 422) throw new AppError("SEGMENTATION_FAILED", 422);
      if (error instanceof AppError) throw error;
      throw new AppError("TOOL_SERVICE_UNAVAILABLE", 503, true);
    }
    const extracted = await extractObject(source, mask);
    if (json) {
      for (const [key, bytes] of Object.entries({ mask, cutout: extracted.cutout, object: extracted.object, hole: extracted.hole })) await createImage(user.id, bytes, { id: ids[key] });
      return Response.json({ ...ids, bounds: extracted.bounds, width: sourceMeta.width, height: sourceMeta.height }, { headers: { "Cache-Control": "no-store" } });
    }
    return new Response(extracted.cutout, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
