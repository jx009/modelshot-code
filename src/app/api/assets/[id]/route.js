import { requireUser } from "../../../../lib/require-user.js";
import { errorResponse, sameOrigin } from "../../../../lib/http.js";
import { deleteAsset } from "../../../../lib/domain/assets/lifecycle.js";
import { ownedAsset } from "../../../../lib/domain/assets/service.js";
import { objectStorage } from "../../../../lib/infra/storage/s3.js";
import { byteRange } from "../../../../lib/domain/assets/range.js";
import { imagePreview, previewSize } from "../../../../lib/domain/assets/preview.js";
import { after } from "next/server";
import { assetDeliveryUrl, enqueueCosAsset, repairCosAsset } from "../../../../lib/domain/assets/cos-delivery.js";

export async function GET(request, context) {
  try {
    const started = performance.now();
    const user = await requireUser();
    const { id } = await context.params;
    const asset = await ownedAsset(user.id, id);
    const video = asset.contentType === "video/mp4";
    const authorized = performance.now();
    const params = new URL(request.url).searchParams;
    const size = previewSize(params.get("preview"));
    const delivery = params.get("delivery") || "auto";
    const download = params.get("download") === "1";
    if (!video && delivery === "auto") {
      // Ownership is checked above, including for cached replica URLs.
      try {
        const url = await assetDeliveryUrl(asset, size || 0, { download });
        if (url) return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Asset-Delivery": "cdn" } });
      } catch { /* An optional accelerator never blocks the original image. */ }
      if (!download) after(() => enqueueCosAsset(asset.id));
    } else if (!video && delivery === "proxy") {
      after(async () => { try { await repairCosAsset(asset, size || 0); } catch { /* The source remains available. */ } });
    }
    if (size && !video) {
      const etag = '"' + asset.checksum + '-webp-v1-' + size + '"';
      const previewHeaders = { "Content-Type": "image/webp", "Cache-Control": "private, max-age=31536000, immutable", "ETag": etag, "X-Content-Type-Options": "nosniff" };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: previewHeaders });
      const bytes = await imagePreview(asset, size, objectStorage());
      return new Response(bytes, { headers: { ...previewHeaders, "Content-Length": String(bytes.length), "Server-Timing": "authorize;dur=" + (authorized - started).toFixed(1) + ", preview;dur=" + (performance.now() - authorized).toFixed(1) } });
    }
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
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asset.id}.${video ? "mp4" : asset.contentType === "image/jpeg" ? "jpg" : asset.contentType === "image/webp" ? "webp" : "png"}"`,
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
