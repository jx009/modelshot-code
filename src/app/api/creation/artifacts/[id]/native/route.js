import { requireUser } from "@/lib/require-user";
import { AppError, errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { ownedArtifact } from "@/lib/domain/creation/artifacts";
import { readNativeOfficeArtifact, saveNativeOfficeArtifact } from "@/lib/domain/creation/native-office-artifacts";
import { saveNativeOfficeArtifactSchema, NATIVE_OFFICE_REQUEST_BYTES } from "@/lib/creation/contracts/native-office";

const headers = { "Cache-Control": "private, no-store" };
// Existing native revisions remain readable/recoverable with new admission
// disabled. This endpoint cannot create or upgrade a semantic artifact.
export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-native-read", user.id, 60, 60);
    const artifact = await ownedArtifact(user.id, id);
    if (!["document", "sheet"].includes(artifact.kind)) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
    const raw = new URL(request.url).searchParams.get("revision");
    const revision = raw === null ? undefined : Number(raw);
    if (raw !== null && (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(revision))) throw new AppError("INVALID_ARTIFACT_REVISION");
    return Response.json(await readNativeOfficeArtifact(user.id, id, artifact.kind, revision), { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-native-save", user.id, 30, 60);
    const body = await readJson(request, saveNativeOfficeArtifactSchema, NATIVE_OFFICE_REQUEST_BYTES);
    return Response.json(await saveNativeOfficeArtifact(user.id, id, body), { headers });
  } catch (error) { return errorResponse(error); }
}
