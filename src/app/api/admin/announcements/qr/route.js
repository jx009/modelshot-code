import { requireAdmin, auditLog } from "@/lib/admin-auth";
import { AppError, errorResponse, readBytes, sameOrigin } from "@/lib/http";
import { announcementQrUrl, uploadAnnouncementQr, QR_MAX_BYTES } from "@/lib/server/announcement-qr";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function POST(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    sameOrigin(request);
    await rateLimit("announcement-qr", auth.user.id, 30, 600);
    const bytes = await readBytes(request, QR_MAX_BYTES + 16_384);
    let form;
    try { form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
    catch { throw new AppError("INVALID_UPLOAD"); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED");
    const result = await uploadAnnouncementQr(Buffer.from(await file.arrayBuffer()));
    await auditLog(auth.user.id, "UPLOAD_ANNOUNCEMENT_QR", null, result);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const query = new URL(request.url).searchParams;
    return Response.json(await announcementQrUrl({ id: query.get("id"), target: query.get("target") }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
