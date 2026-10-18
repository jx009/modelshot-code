import { randomInt } from "node:crypto";
import { AppError } from "../../http.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateInviteCode() {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

// All code issuers take the same transaction lock before checking the unique index.
export async function allocateInviteCode(tx, generate = generateInviteCode) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('invite-code-allocation', 0))::text`;
  for (let attempt = 0; attempt < 32; attempt++) {
    const code = generate();
    if (!await tx.user.findUnique({ where: { inviteCode: code }, select: { id: true } }) &&
        !await tx.inviteCodeAlias.findUnique({ where: { code }, select: { userId: true } })) return code;
  }
  throw new AppError("INVITE_CODE_UNAVAILABLE", 503, true);
}

export async function findInviter(tx, refCode) {
  const code = String(refCode || "").trim().toUpperCase();
  if (!code) return null;
  const direct = await tx.user.findUnique({ where: { inviteCode: code }, select: { id: true, status: true } });
  if (direct) return direct;
  const alias = await tx.inviteCodeAlias.findUnique({ where: { code } });
  return alias ? tx.user.findUnique({ where: { id: alias.userId }, select: { id: true, status: true } }) : null;
}
