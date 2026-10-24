import { requireUser } from "@/lib/require-user";
import { errorResponse } from "@/lib/http";
import { readRun } from "@/lib/domain/creation/runs";

export async function GET(_request, context) {
  try {
    const user = await requireUser(), { id } = await context.params;
    return Response.json(await readRun(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
