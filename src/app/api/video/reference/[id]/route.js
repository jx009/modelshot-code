import { AppError, errorResponse } from "../../../../../lib/http.js";
import { ownedAsset, readOwnedImage } from "../../../../../lib/domain/assets/service.js";
import { videoReferenceOwner } from "../../../../../lib/domain/studio/video-reference.js";
import { objectStorage } from "../../../../../lib/infra/storage/s3.js";
import { byteRange } from "../../../../../lib/domain/assets/range.js";

export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const userId = videoReferenceOwner(id, new URL(request.url).searchParams.get("token"));
    const asset = await ownedAsset(userId, id);
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
    if (/^(video|audio)\//.test(asset.contentType)) {
      Object.assign(headers, { "Content-Type": asset.contentType, "Content-Length": String(asset.bytes), "Accept-Ranges": "bytes" });
      let range;
      if (request.headers.get("range")) {
        try { range = byteRange(request.headers.get("range"), asset.bytes); }
        catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${asset.bytes}` } }); }
      }
      if (range) Object.assign(headers, { "Content-Range": `bytes ${range.start}-${range.end}/${asset.bytes}`, "Content-Length": String(range.end - range.start + 1) });
      return new Response(await objectStorage().stream(asset.objectKey, range ? `bytes=${range.start}-${range.end}` : undefined, request.signal), { status: range ? 206 : 200, headers });
    }
    if (!/^image\/(png|jpeg|webp)$/.test(asset.contentType)) throw new AppError("VIDEO_MEDIA_INVALID", 415);
    const bytes = await readOwnedImage(userId, id);
    return new Response(bytes, { headers: { "Content-Type": "image/png", "Content-Length": String(bytes.length),
      ...headers } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
