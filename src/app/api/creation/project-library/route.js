import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { listProjectLibrary } from "@/lib/domain/creation/project-library";
import { assetDeliveryBatch } from "@/lib/domain/assets/cos-delivery";

export async function GET(request) {
  try {
    const user = await requireUser(), query = new URL(request.url).searchParams;
    const result = await listProjectLibrary(user.id, { kind: query.get("kind") || "all", q: query.get("q") || "", cursor: query.get("cursor") });
    const assetDelivery = await assetDeliveryBatch(user.id, result.items.map(item => item.coverAssetId), [640]);
    return Response.json({ ...result, assetDelivery }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
