import sharp from "sharp";
import { requireUser } from "../../../../lib/require-user.js";
import { AppError, errorResponse, readBytes, sameOrigin } from "../../../../lib/http.js";
import { readOwnedImage } from "../../../../lib/domain/assets/service.js";
import { rateLimit } from "../../../../lib/domain/identity/rate-limit.js";
import { studioConfig, toolService } from "../../../../lib/domain/studio/providers.js";

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
    const config = await studioConfig();
    if (!config.toolsURL || !config.toolsKey) throw new AppError("SEGMENTATION_NOT_CONFIGURED", 503);
    let result;
    try { result = await toolService(config, "segment", source, {}, AbortSignal.any([request.signal, AbortSignal.timeout(45000)]), { selection: selectionBytes }); }
    catch (error) {
      if (error instanceof AppError && error.code === "TOOL_SERVICE_FAILED" && error.status === 422) throw new AppError("SEGMENTATION_FAILED", 422);
      if (error instanceof AppError) throw error;
      throw new AppError("TOOL_SERVICE_UNAVAILABLE", 503, true);
    }
    return new Response(result, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
