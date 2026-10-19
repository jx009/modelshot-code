import { publicInspirationGallery } from "@/lib/server/inspiration";
import { errorResponse } from "@/lib/http";
import { after } from "next/server";
import { enqueueInspirationGallery, inspirationDelivery } from "@/lib/server/inspiration-delivery";
export async function GET() {
  try {
    const gallery = await publicInspirationGallery();
    const delivered = await inspirationDelivery(gallery);
    if (delivered.deliveryPending) after(() => enqueueInspirationGallery(gallery));
    return Response.json(delivered, { headers: { "Cache-Control": "no-store" } });
  }
  catch (e) { return errorResponse(e); }
}
