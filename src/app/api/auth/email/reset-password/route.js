import { changeIdentity, identitySchema } from "../../../../../lib/domain/identity/verification.js";
import { rateLimit } from "../../../../../lib/domain/identity/rate-limit.js";
import { clientAddress, errorResponse, readJson } from "../../../../../lib/http.js";

export async function POST(request) {
  try {
    const input = await readJson(request, identitySchema);
    await rateLimit("identity-ip", clientAddress(request), 30, 600);
    await rateLimit("identity-email", input.email, 10, 600);
    return Response.json(await changeIdentity(input, "RESET_PASSWORD"));
  } catch (error) { return errorResponse(error); }
}
