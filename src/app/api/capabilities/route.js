import { requireUser } from "../../../lib/require-user.js";
import { errorResponse } from "../../../lib/http.js";
import { availableProviders } from "../../../lib/domain/generation/providers.js";
import { PROFILES, LIMITS } from "../../../lib/domain/generation/contracts.js";

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ providers: await availableProviders(user.id), profiles: PROFILES, limits: LIMITS });
  } catch (error) { return errorResponse(error); }
}
