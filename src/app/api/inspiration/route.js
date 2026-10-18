import { publicInspirationGallery } from "@/lib/server/inspiration";
import { errorResponse } from "@/lib/http";
export async function GET() {
  try { return Response.json(await publicInspirationGallery(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return errorResponse(e); }
}
