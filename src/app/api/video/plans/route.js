import { requireCreationUser } from "@/lib/creation/require-user";
import { sameOrigin, readJson, errorResponse } from "@/lib/http";
import { videoRunSchema } from "@/lib/creation/contracts/video-runs";
import { createVideoRun } from "@/lib/domain/creation/video-runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
export async function POST(request) {
  try {
    sameOrigin(request);
    const user = await requireCreationUser({ kind: "video", runs: true });
    await rateLimit("video-plan", user.id, 30, 600);
    return Response.json(await createVideoRun(user.id, await readJson(request, videoRunSchema, 262144), request.headers.get("Idempotency-Key"), undefined, user.creationEnv), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
