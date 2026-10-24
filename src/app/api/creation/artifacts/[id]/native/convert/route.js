import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { convertNativeOfficeArtifact } from "@/lib/domain/creation/native-office-conversion";
import { convertNativeOfficeArtifactSchema } from "@/lib/creation/contracts/native-office";

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-native-convert", user.id, 10, 60);
    const body = await readJson(request, convertNativeOfficeArtifactSchema, 1024);
    const result = await convertNativeOfficeArtifact(user.id, id, body);
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
