import { requireUser } from "../../../../lib/require-user.js";
import { errorResponse, sameOrigin } from "../../../../lib/http.js";
import { deleteAsset } from "../../../../lib/domain/assets/lifecycle.js";
import { ownedAsset } from "../../../../lib/domain/assets/service.js";
import { objectStorage } from "../../../../lib/infra/storage/s3.js";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const asset = await ownedAsset(user.id, id);
    return new Response(await objectStorage().get(asset.objectKey), { headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.bytes),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${asset.id}.png"`,
    } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request, context) {
  try { sameOrigin(request); const user = await requireUser(); const { id } = await context.params; return Response.json(await deleteAsset(user.id, id)); }
  catch (error) { return errorResponse(error); }
}
