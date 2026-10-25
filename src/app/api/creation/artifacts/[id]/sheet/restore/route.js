import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { restoreSheetArtifactSchema } from "@/lib/creation/contracts/sheet-artifacts";
import { restoreSheetArtifact } from "@/lib/domain/creation/sheet-artifacts";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-sheet-restore", user.id, 10, 60);
    const data = await readJson(request, restoreSheetArtifactSchema, 4096);
    return Response.json(await restoreSheetArtifact(user.id, id, data), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
