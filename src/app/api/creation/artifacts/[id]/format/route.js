import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ownedArtifact } from "@/lib/domain/creation/artifacts";

// Resolve the codec without downloading a full snapshot with the wrong codec.
export async function GET(_request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-format-read", user.id, 60, 60);
    const artifact = await ownedArtifact(user.id, id);
    const canConvertNative = artifact.schemaVersion === 1 && ["document", "sheet"].includes(artifact.kind)
      && user.creationEnv.CREATION_WORKSPACE_ENABLED === "true" && process.env.CREATION_NATIVE_OFFICE_ENABLED === "true";
    const canReferenceNative = artifact.schemaVersion === 2 && ["sheet", "document"].includes(artifact.kind)
      && ["CREATION_RUNS_ENABLED", "CREATION_WORKSPACE_ENABLED", artifact.kind === "sheet" ? "CREATION_SHEET_ENABLED" : "CREATION_DOCUMENT_ENABLED", "CREATION_NATIVE_OFFICE_ENABLED"].every(flag => user.creationEnv[flag] === "true");
    return Response.json({ id: artifact.id, kind: artifact.kind, schemaVersion: artifact.schemaVersion, canConvertNative, canReferenceNative }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
