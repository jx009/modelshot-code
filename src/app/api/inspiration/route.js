import { errorResponse } from "@/lib/http";
import { deliveredPublicGallery, GALLERY_CACHE_CONTROL } from "@/lib/server/inspiration-cache";

export async function GET() {
  try { return Response.json(await deliveredPublicGallery(), { headers: { "Cache-Control": GALLERY_CACHE_CONTROL } }); }
  catch (e) { return errorResponse(e); }
}
