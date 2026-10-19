import { prisma } from "../../../../../lib/prisma.js";
import { sendVerificationEmail } from "../../../../../lib/email-service.js";
import { challengeSchema, issueChallenge } from "../../../../../lib/domain/identity/verification.js";
import { rateLimit } from "../../../../../lib/domain/identity/rate-limit.js";
import { clientAddress, errorResponse, readJson } from "../../../../../lib/http.js";

export async function POST(request) {
  try {
    const { email, purpose } = await readJson(request, challengeSchema);
    await rateLimit("email-ip", clientAddress(request), 20, 600, prisma, "EMAIL_IP_RATE_LIMITED");
    const challenge = await issueChallenge(email, purpose, prisma, {
      beforeIssue: tx => rateLimit("email-address", email, 5, 600, tx, "EMAIL_ADDRESS_RATE_LIMITED"),
    });
    try { await sendVerificationEmail(email, challenge.code, purpose); }
    catch (error) {
      await prisma.verificationCode.deleteMany({ where: { id: challenge.id } });
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
