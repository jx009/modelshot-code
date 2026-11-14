import { requireCreationUser } from "@/lib/creation/require-user";
import { sameOrigin, readJson, errorResponse } from "@/lib/http";
import { quoteStoryboard, storyboardQuoteSchema } from "@/lib/domain/creation/storyboard-runs";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

// 生成确认单：按已保存的分镜逐项报价（首帧、视频、旁白、合成），不产生费用。
export async function POST(request) {
  try {
    sameOrigin(request);
    const user = await requireCreationUser({ kind: "motion" });
    await rateLimit("video-storyboard-quote", user.id, 120, 600);
    return Response.json(await quoteStoryboard(user.id, await readJson(request, storyboardQuoteSchema, 16384)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
