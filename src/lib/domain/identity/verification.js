import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const purposeSchema = z.enum(["REGISTER", "RESET_PASSWORD"]);
export const passwordSchema = z.string().min(8).refine(value => Buffer.byteLength(value, "utf8") <= 72);
export const challengeSchema = z.object({ email: emailSchema, purpose: purposeSchema }).strict();
export const identitySchema = z.object({
  email: emailSchema, password: passwordSchema, code: z.string().regex(/^\d{6}$/),
  refCode: z.string().regex(/^[a-zA-Z0-9]{6,32}$/).optional().or(z.literal("")),
}).strict();

function digest(record, code) {
  const key = process.env[`VERIFICATION_KEY_${record.keyVersion}`] || (record.keyVersion === "1" ? process.env.NEXTAUTH_SECRET : null);
  if (!key || key.length < 32) throw new Error("Verification key unavailable");
  return createHmac("sha256", key).update(`${record.id}:${record.email}:${record.purpose}:${code}`).digest("hex");
}

async function lock(tx, email, purpose) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`verification:${email}:${purpose}`}, 0))::text`;
}

export async function issueChallenge(email, purpose, db = prisma) {
  return db.$transaction(async tx => {
    await lock(tx, email, purpose);
    const old = await tx.verificationCode.findUnique({ where: { email_purpose: { email, purpose } } });
    if (old && old.createdAt > new Date(Date.now() - 60_000)) throw new AppError("CODE_RATE_LIMITED", 429, true);
    const code = String(randomInt(100000, 1000000));
    const record = { id: randomUUID(), email, purpose, keyVersion: process.env.VERIFICATION_KEY_VERSION || "1" };
    await tx.verificationCode.deleteMany({ where: { email, purpose } });
    await tx.verificationCode.create({ data: { ...record, digest: digest(record, code), expiresAt: new Date(Date.now() + 300_000) } });
    return { id: record.id, code };
  });
}

export async function changeIdentity(input, purpose, db = prisma) {
  const { email, password, code, refCode } = identitySchema.parse(input);
  const passwordHash = await bcrypt.hash(password, 12);
  // Return verification failures from the transaction so failed attempts commit.
  const result = await db.$transaction(async tx => {
    await lock(tx, email, purpose);
    const record = await tx.verificationCode.findUnique({ where: { email_purpose: { email, purpose } } });
    if (!record || record.consumedAt || record.expiresAt <= new Date() || record.attempts >= 5) return { error: "CODE_INVALID" };
    if (!timingSafeEqual(Buffer.from(record.digest, "hex"), Buffer.from(digest(record, code), "hex"))) {
      await tx.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return { error: "CODE_INVALID" };
    }
    const existing = await tx.user.findUnique({ where: { email } });
    if (purpose === "REGISTER") {
      if (existing) return { error: "EMAIL_ALREADY_REGISTERED" };
      const inviter = refCode ? await tx.user.findUnique({ where: { inviteCode: refCode }, select: { id: true, status: true } }) : null;
      await tx.user.create({ data: {
        email, name: email.split("@")[0], passwordHash, emailVerified: new Date(), credits: 0,
        inviteCode: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
        ...(inviter?.status === "active" ? { inviterId: inviter.id, invitedAt: new Date() } : {}),
      } });
    } else if (existing) {
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    }
    await tx.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return { ok: true };
  });
  if (result.error) throw new AppError(result.error);
  return result;
}
