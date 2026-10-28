import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { getCreationEnv, assertCreationAccess } from "@/lib/creation/access";
import { capabilities } from "@/lib/domain/studio/providers";
import { prisma } from "@/lib/prisma";
export async function GET() {
  try {
    const user = await requireUser();
    const [env, caps, heartbeat] = await Promise.all([getCreationEnv(user.id), capabilities(), prisma.serviceHeartbeat.findUnique({ where: { id: "worker" }, select: { updatedAt: true } })]);
    const workerReady = Boolean(heartbeat && +heartbeat.updatedAt > Date.now() - 90000);
    const allowed = kind => { try { assertCreationAccess(env, { kind }); return true; } catch { return false; } };
    const videoEnabled = allowed("video") && env.CREATION_RUNS_ENABLED === "true" && workerReady && caps.tools.find(tool => tool.id === "video")?.enabled;
    return Response.json({ video: allowed("video"), motion: allowed("motion"), workerReady, videoProvider: caps.videoProvider,
      videoModels: caps.videoModels.map(model => ({ ...model, available: Boolean(videoEnabled) })), tools: caps.tools.filter(tool => ["video", "motion-plan", "motion-render"].includes(tool.id)).map(tool => {
      const permitted = allowed(tool.id === "video" ? "video" : "motion") && env.CREATION_RUNS_ENABLED === "true";
      return { id: tool.id, available: permitted && tool.available && workerReady, cost: tool.cost, reason: !permitted ? "CREATION_NOT_ENABLED" : !workerReady ? "WORKER_UNAVAILABLE" : tool.reason };
    }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
