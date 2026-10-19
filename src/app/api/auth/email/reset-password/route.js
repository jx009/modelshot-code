import { changeIdentity, confirmedIdentitySchema } from "../../../../../lib/domain/identity/verification.js";
import { rateLimit } from "../../../../../lib/domain/identity/rate-limit.js";
import { AppError, clientAddress, errorResponse, readJson } from "../../../../../lib/http.js";

export async function POST(request) {
  try {
    const { confirmPassword, ...input } = await readJson(request, confirmedIdentitySchema);
    if (confirmPassword !== input.password) throw new AppError("PASSWORD_MISMATCH");
    await rateLimit("identity-ip", clientAddress(request), 30, 600);
    await rateLimit("identity-email", input.email, 10, 600);
    return Response.json(await changeIdentity(input, "RESET_PASSWORD"));
  } catch (error) { return errorResponse(error); }
}
