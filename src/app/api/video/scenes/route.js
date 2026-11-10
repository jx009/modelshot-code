import { z } from "zod";
import { requireUser } from "@/lib/require-user";
import { sameOrigin, readJson, errorResponse } from "@/lib/http";
import { openSceneVideo } from "@/lib/domain/studio/scene-video";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const input = z.object({ documentId: id, sceneId: id, assetId: id }).strict();
export async function POST(request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const document = await openSceneVideo(user.id, await readJson(request, input));
    return Response.json({ id: document.id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
