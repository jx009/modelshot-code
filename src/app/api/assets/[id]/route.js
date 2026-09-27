import { requireUser } from "../../../../lib/require-user.js";
import { errorResponse, sameOrigin } from "../../../../lib/http.js";
import { deleteAsset } from "../../../../lib/domain/assets/lifecycle.js";
import { ownedAsset } from "../../../../lib/domain/assets/service.js";
import { objectStorage } from "../../../../lib/infra/storage/s3.js";
import { byteRange } from "../../../../lib/domain/assets/range.js";

export async function GET(request, context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const asset = await ownedAsset(user.id, id);
    const video = asset.contentType === "video/mp4";
    const range = request.headers.get("range");
    const headers = {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.bytes),
      // Asset ids are immutable. Let the browser reuse previews instead of
      // re-authenticating, querying Postgres, and downloading MinIO on every render.
      "Cache-Control": "private, max-age=31536000, immutable",
      "ETag": `"${asset.checksum}"`,
      ...(asset.createdAt ? { "Last-Modified": new Date(asset.createdAt).toUTCString() } : {}),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${asset.id}.${video ? "mp4" : "png"}"`,
      ...(video ? { "Accept-Ranges": "bytes" } : {}),
    };
    if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
    if (video && range) {
      let slice;
      try { slice = byteRange(range, asset.bytes); }
      catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${asset.bytes}` } }); }
      const { start, end } = slice;
      return new Response(await objectStorage().stream(asset.objectKey, `bytes=${start}-${end}`, request.signal), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${asset.bytes}` } });
    }
    return new Response(await objectStorage().stream(asset.objectKey, undefined, request.signal), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params; return Response.json(await deleteAsset(user.id, id)); }
  catch (error) { return errorResponse(error); }
}
