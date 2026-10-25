import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { modifyWebArtifactSchema } from "@/lib/creation/contracts/web-artifacts";
import { readWebArtifact, modifyWebArtifact } from "@/lib/domain/creation/web-artifacts";
export async function GET(request, context) {
  try { const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params, raw = new URL(request.url).searchParams.get("revision"); return Response.json(await readWebArtifact(user.id, id, raw === null ? undefined : Number(raw)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request, context) {
  try { const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params; await rateLimit("creation-web-save", user.id, 120, 60); return Response.json(await modifyWebArtifact(user.id, id, await readJson(request, modifyWebArtifactSchema, 256 * 1024)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return errorResponse(error); }
}
