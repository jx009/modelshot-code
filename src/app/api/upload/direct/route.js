import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { readJson, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { directUploadSchema, prepareDirectUpload, completeDirectUpload } from "@/lib/domain/assets/direct-upload";
import { assetDeliveryBatch } from "@/lib/domain/assets/cos-delivery";

export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, directUploadSchema);
    await rateLimit("direct-upload", user.id, 100, 600);
    const plan = await prepareDirectUpload(user.id, input);
    if (plan.mode === "existing") plan.assetDelivery = await assetDeliveryBatch(user.id, [plan.assetId]);
    return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try {
    const user = await requireUser();
    const { uploadId } = await readJson(request, z.object({ uploadId: z.uuid() }).strict());
    await rateLimit("direct-upload-complete", user.id, 200, 600);
    const asset = await completeDirectUpload(user.id, uploadId);
    return Response.json({ assetId: asset.id, url: `/api/assets/${asset.id}`, width: asset.width, height: asset.height,
      assetDelivery: await assetDeliveryBatch(user.id, [asset.id]) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
