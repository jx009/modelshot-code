import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { restoreWebArtifactSchema } from "@/lib/creation/contracts/web-artifacts";
import { restoreWebArtifact } from "@/lib/domain/creation/web-artifacts";
export async function POST(request, context) { try { const user = await requireUser(), { id } = await context.params; await rateLimit("creation-web-restore", user.id, 10, 60); return Response.json(await restoreWebArtifact(user.id, id, await readJson(request, restoreWebArtifactSchema, 4096)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return errorResponse(error); } }
