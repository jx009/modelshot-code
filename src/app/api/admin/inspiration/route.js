import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { readJson, errorResponse } from "@/lib/http";
import { gallerySchema } from "@/lib/inspiration/gallery";
import { getInspirationGallery, saveInspirationGallery, lockInspirationGallery } from "@/lib/server/inspiration";
import { auditedOperation } from "@/lib/domain/identity/admin-operation";
import { invalidatePublicGallery } from "@/lib/server/inspiration-cache";
export async function GET(req) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  try { return Response.json(await getInspirationGallery(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return errorResponse(e); }
}
export async function PATCH(req) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  try {
    const input = await readJson(req, gallerySchema.extend({ version: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(3).max(500) }).strict(), 3_000_000);
    const result = await auditedOperation(auth.user.id, req.headers.get("idempotency-key"), "UPDATE_INSPIRATION", input, tx => saveInspirationGallery(tx, input), undefined, "admin", { beforeActorLock: lockInspirationGallery });
    invalidatePublicGallery();
    return Response.json(result);
  } catch (e) { return errorResponse(e); }
}
