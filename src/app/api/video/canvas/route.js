import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { openCanvasVideo } from "@/lib/domain/studio/canvas-video";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const input = z.object({ documentId: id, layerId: id, layerIds: z.array(id).min(1).max(30).optional(), referenceLayout: z.enum(["frames", "reference"]).optional() }).strict();
export async function POST(request) {
  try {
    const user = await requireUser();
    await rateLimit("canvas-video", user.id, 60, 600);
    const row = await openCanvasVideo(user.id, await readJson(request, input));
    return Response.json({ id: row.id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
