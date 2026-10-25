import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { requestExportSchema } from "@/lib/creation/contracts/exports";
import { listArtifactExports, requestArtifactExport } from "@/lib/domain/creation/exports";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    return Response.json(await listArtifactExports(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-export", user.id, 20, 60);
    const result = await requestArtifactExport(user.id, id, await readJson(request, requestExportSchema, 4096));
    return Response.json(result, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
