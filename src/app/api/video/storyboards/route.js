import { requireCreationUser } from "@/lib/creation/require-user";
import { sameOrigin, readJson, errorResponse } from "@/lib/http";
import { createStoryboardRun, storyboardRunSchema } from "@/lib/domain/creation/storyboard-runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

// 确认报价后提交分镜成片：所选镜头的首帧、视频、旁白与最终导出作为一次运行执行。
export async function POST(request) {
  try {
    sameOrigin(request);
    const user = await requireCreationUser({ kind: "motion", runs: true });
    await rateLimit("video-storyboard", user.id, 30, 600);
    return Response.json(await createStoryboardRun(user.id, await readJson(request, storyboardRunSchema, 65536), request.headers.get("Idempotency-Key"), undefined, user.creationEnv), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
