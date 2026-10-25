import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ownedArtifact } from "@/lib/domain/creation/artifacts";
import { restoreNativeOfficeArtifact } from "@/lib/domain/creation/native-office-artifacts";
import { restoreNativeOfficeArtifactSchema } from "@/lib/creation/contracts/native-office";

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-native-restore", user.id, 10, 60);
    const body = await readJson(request, restoreNativeOfficeArtifactSchema);
    const artifact = await ownedArtifact(user.id, id);
    if (!["document", "sheet"].includes(artifact.kind)) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
    return Response.json(await restoreNativeOfficeArtifact(user.id, id, artifact.kind, body), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
