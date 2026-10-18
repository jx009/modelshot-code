import { findInspiration, readInspirationImage } from "@/lib/server/inspiration";
import { AppError, errorResponse } from "@/lib/http";
export async function GET(_req, { params }) {
  try {
    const { id } = await params, item = await findInspiration(id);
    if (!item) throw new AppError("CASE_NOT_FOUND", 404);
    const { bytes, contentType } = await readInspirationImage(item);
    return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return errorResponse(e); }
}
