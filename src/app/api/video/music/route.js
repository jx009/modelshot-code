import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { listActiveTracks, presentTrack } from "@/lib/domain/studio/music-library";

// 分镜成片可选的平台背景音乐。只返回名称、时长与试听地址。
export async function GET() {
  try {
    await requireUser();
    const tracks = await listActiveTracks();
    return Response.json({ tracks: tracks.map(track => presentTrack(track)) }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) { return errorResponse(error); }
}
