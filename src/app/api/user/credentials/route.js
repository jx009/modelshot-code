import { z } from "zod";
import { prisma } from "../../../../lib/prisma.js";
import { requireUser } from "../../../../lib/require-user.js";
import { errorResponse, readJson } from "../../../../lib/http.js";
import { saveCredential } from "../../../../lib/domain/identity/credentials.js";
import { rateLimit } from "../../../../lib/domain/identity/rate-limit.js";

const provider = z.enum(["openai", "gemini", "fashn"]);
const selection = { id: true, provider: true, mask: true, status: true, updatedAt: true };

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ credentials: await prisma.providerCredential.findMany({ where: { userId: user.id }, select: selection }) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, z.object({ provider, secret: z.string().trim().min(16).max(4096).regex(/^[\x21-\x7e]+$/) }).strict());
    await rateLimit("credential", user.id, 10, 600);
    return Response.json(await saveCredential(user.id, input.provider, input.secret));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request) {
  try {
    const user = await requireUser();
    const input = await readJson(request, z.object({ provider }).strict());
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      await tx.providerCredential.updateMany({ where: { userId: user.id, provider: input.provider }, data: { status: "revoked", ciphertext: "" } });
      await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
