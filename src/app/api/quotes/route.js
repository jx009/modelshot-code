import { requireUser } from "../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../lib/http.js";
import { quoteGeneration } from "../../../lib/domain/generation/submission.js";
import { configurationSchema } from "../../../lib/domain/generation/contracts.js";
import { rateLimit } from "../../../lib/domain/identity/rate-limit.js";

export async function POST(request) {
  try {
    const user = await requireUser();
    const config = await readJson(request, configurationSchema);
    await rateLimit("quote", user.id, 60, 600);
    return Response.json(await quoteGeneration(user.id, config));
  } catch (error) { return errorResponse(error); }
}
