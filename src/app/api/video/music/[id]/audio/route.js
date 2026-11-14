import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { objectStorage } from "@/lib/infra/storage/s3";
import { byteRange } from "@/lib/domain/assets/range";
import { activeTrack } from "@/lib/domain/studio/music-library";

// 曲库试听与预览播放：只放行仍在上架的曲目，不暴露上传者的其他素材。
export async function GET(request, context) {
  try {
    await requireUser();
    const { id } = await context.params;
    const { asset } = await activeTrack(id);
    const headers = { "Content-Type": asset.contentType, "Content-Length": String(asset.bytes), "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "ETag": `"${asset.checksum}"`, "X-Content-Type-Options": "nosniff" };
    if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
    const range = request.headers.get("range");
    if (range) {
      let slice;
      try { slice = byteRange(range, asset.bytes); }
      catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.bytes}` } }); }
      const { start, end } = slice;
      return new Response(await objectStorage().stream(asset.objectKey, `bytes=${start}-${end}`, request.signal), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${asset.bytes}` } });
    }
    return new Response(await objectStorage().stream(asset.objectKey, undefined, request.signal), { headers });
  } catch (error) { return errorResponse(error); }
}
