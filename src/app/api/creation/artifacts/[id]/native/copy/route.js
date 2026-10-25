import { requireCreationUser as requireUser } from "@/lib/creation/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { copyNativeOfficeArtifact } from "@/lib/domain/creation/native-office-artifacts";
import { copyNativeOfficeArtifactSchema, NATIVE_OFFICE_REQUEST_BYTES } from "@/lib/creation/contracts/native-office";

export async function POST(request, context) {
  try {
    const user = await requireUser({ resource: "artifact", id: (await context.params).id }), { id } = await context.params;
    await rateLimit("creation-native-copy", user.id, 10, 60);
    const body = await readJson(request, copyNativeOfficeArtifactSchema, NATIVE_OFFICE_REQUEST_BYTES);
    return Response.json(await copyNativeOfficeArtifact(user.id, id, body), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
