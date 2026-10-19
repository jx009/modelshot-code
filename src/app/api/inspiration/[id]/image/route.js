import { findInspiration, readInspirationImage } from "@/lib/server/inspiration";
import { AppError, errorResponse } from "@/lib/http";
import { inspirationDelivery } from "@/lib/server/inspiration-delivery";
export async function GET(_req, { params }) {
  try {
    const { id } = await params, item = await findInspiration(id);
    if (!item) throw new AppError("CASE_NOT_FOUND", 404);
    if (new URL(_req.url).searchParams.get("delivery") !== "proxy") {
      const delivered = await inspirationDelivery({ items: [item] });
      const url = delivered.items[0].imageUrl;
      if (url) return new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "no-store", "X-Asset-Delivery": "cos" } });
    }
    const { bytes, contentType } = await readInspirationImage(item);
    return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return errorResponse(e); }
}
