import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/domain/identity/rate-limit";
import { webPublicationActionSchema } from "@/lib/creation/contracts/web-publications";
import { changeWebPublication, getWebPublication } from "@/lib/domain/creation/web-publications";

export async function GET(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await getWebPublication(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-web-publication", user.id, 30, 60);
    const input = await readJson(request, webPublicationActionSchema, 8192);
    return Response.json(await changeWebPublication(user.id, id, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
