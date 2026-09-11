import { prisma } from "../../../../../lib/prisma.js";
import { sendVerificationEmail } from "../../../../../lib/email-service.js";
import { challengeSchema, issueChallenge } from "../../../../../lib/domain/identity/verification.js";
import { rateLimit } from "../../../../../lib/domain/identity/rate-limit.js";
import { clientAddress, errorResponse, readJson } from "../../../../../lib/http.js";

export async function POST(request) {
  try {
    const { email, purpose } = await readJson(request, challengeSchema);
    await rateLimit("email-ip", clientAddress(request), 20, 600);
    await rateLimit("email-address", email, 5, 3600);
    const challenge = await issueChallenge(email, purpose);
    try { await sendVerificationEmail(email, challenge.code, purpose); }
    catch (error) {
      await prisma.verificationCode.deleteMany({ where: { id: challenge.id } });
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
