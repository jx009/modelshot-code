import { requireUser } from "@/lib/require-user";
import { errorResponse, readJson } from "@/lib/http";
import { readOutlineReview, confirmOutline } from "@/lib/domain/creation/outline-review";
import { confirmOutlineSchema } from "@/lib/creation/contracts/outline-review";
import { rateLimit } from "@/lib/domain/identity/rate-limit";

export async function GET(_request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await readOutlineReview(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    await rateLimit("creation-outline", user.id, 30, 600);
    return Response.json(await confirmOutline(user.id, id, await readJson(request, confirmOutlineSchema, 600000)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
