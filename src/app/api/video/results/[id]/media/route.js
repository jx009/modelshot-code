import { requireUser } from "@/lib/require-user";
import { errorResponse, sameOrigin } from "@/lib/http";
import { inspectVideoResult } from "@/lib/domain/studio/video-result-media";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { allowedCreationKinds, getCreationEnv } from "@/lib/creation/access";
import { AppError } from "@/lib/http";

export async function POST(request, context) {
  try {
    sameOrigin(request);
    const user = await requireUser(), { id } = await context.params;
    if (!allowedCreationKinds(await getCreationEnv(user.id)).some(kind => ["video", "motion"].includes(kind))) throw new AppError("CREATION_NOT_ENABLED", 403);
    await rateLimit("video-result-media", user.id, 30, 600);
    return Response.json(await inspectVideoResult(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
