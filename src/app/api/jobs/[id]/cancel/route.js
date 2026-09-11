import { requireUser } from "../../../../../lib/require-user.js";
import { errorResponse, sameOrigin } from "../../../../../lib/http.js";
import { cancelOutput } from "../../../../../lib/domain/generation/execution.js";

export async function POST(request, context) {
  try {
    const user = await requireUser();
    sameOrigin(request);
    const { id } = await context.params;
    return Response.json(await cancelOutput(user.id, id));
  } catch (error) { return errorResponse(error); }
}
