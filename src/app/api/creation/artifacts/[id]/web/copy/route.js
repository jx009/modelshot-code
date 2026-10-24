import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { copyWebArtifactSchema } from "@/lib/creation/contracts/web-artifacts";
import { copyWebArtifact } from "@/lib/domain/creation/web-artifacts";
export async function POST(request, context) { try { const user = await requireUser(), { id } = await context.params; await rateLimit("creation-web-copy", user.id, 10, 60); return Response.json(await copyWebArtifact(user.id, id, await readJson(request, copyWebArtifactSchema, 2 * 1024 * 1024)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return errorResponse(error); } }
