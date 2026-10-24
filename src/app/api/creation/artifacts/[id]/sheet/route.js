import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { modifySheetArtifactSchema } from "@/lib/creation/contracts/sheet-artifacts";
import { readSheetArtifact, modifySheetArtifact } from "@/lib/domain/creation/sheet-artifacts";
export async function GET(request, context) { try { const user = await requireUser(), { id } = await context.params, revision = new URL(request.url).searchParams.get("revision"); return Response.json(await readSheetArtifact(user.id, id, revision === null ? undefined : Number(revision)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return errorResponse(error); } }
export async function PATCH(request, context) { try { const user = await requireUser(), { id } = await context.params; await rateLimit("creation-sheet-save", user.id, 120, 60); return Response.json(await modifySheetArtifact(user.id, id, await readJson(request, modifySheetArtifactSchema, 256 * 1024)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return errorResponse(error); } }
