import { requireUser } from "../../../lib/require-user.js";
import { AppError, errorResponse, readBytes, sameOrigin } from "../../../lib/http.js";
import { assetUrl, createImage, IMAGE_LIMITS } from "../../../lib/domain/assets/service.js";
import { rateLimit } from "../../../lib/domain/identity/rate-limit.js";

export async function POST(request) {
  try {
    const user = await requireUser();
    sameOrigin(request);
    await rateLimit("upload", user.id, 100, 600);
    const bytes = await readBytes(request, IMAGE_LIMITS.bytes + 16_384);
    let form;
    try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new AppError("INVALID_UPLOAD"); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED");
    const asset = await createImage(user.id, Buffer.from(await file.arrayBuffer()), { declaredType: file.type });
    return Response.json({ assetId: asset.id, url: assetUrl(asset.id), width: asset.width, height: asset.height });
  } catch (error) { return errorResponse(error); }
}
