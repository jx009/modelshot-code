import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { findInviter } from "./invite-codes.js";
import { createRegisteredUser, registrationCredits } from "./registration.js";

export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const purposeSchema = z.enum(["REGISTER", "RESET_PASSWORD"]);
export const passwordSchema = z.string().min(8).refine(value => Buffer.byteLength(value, "utf8") <= 72);
export const challengeSchema = z.object({ email: emailSchema, purpose: purposeSchema }).strict();
export const identitySchema = z.object({
  email: emailSchema, password: passwordSchema, code: z.string().regex(/^\d{6}$/),
  refCode: z.string().regex(/^[a-zA-Z0-9]{6,32}$/).optional().or(z.literal("")),
}).strict();

// Public registration/reset forms require an explicit second entry. Keep the
// internal identity command independent of presentation fields.
export const confirmedIdentitySchema = identitySchema.extend({ confirmPassword: passwordSchema });

function digest(record, code) {
  const key = process.env[`VERIFICATION_KEY_${record.keyVersion}`] || (record.keyVersion === "1" ? process.env.NEXTAUTH_SECRET : null);
  if (!key || key.length < 32) throw new Error("Verification key unavailable");
  return createHmac("sha256", key).update(`${record.id}:${record.email}:${record.purpose}:${code}`).digest("hex");
}

async function lock(tx, email, purpose) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`verification:${email}:${purpose}`}, 0))::text`;
}

export async function issueChallenge(email, purpose, db = prisma, { beforeIssue } = {}) {
  return db.$transaction(async tx => {
    await lock(tx, email, purpose);
    if (purpose === "REGISTER" && await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new AppError("EMAIL_ALREADY_REGISTERED");
    }
    const old = await tx.verificationCode.findUnique({ where: { email_purpose: { email, purpose } } });
    if (old && old.createdAt > new Date(Date.now() - 60_000)) {
      const error = new AppError("CODE_RATE_LIMITED", 429, true);
      error.retryAfter = Math.max(1, Math.ceil((old.createdAt.getTime() + 60_000 - Date.now()) / 1000));
      throw error;
    }
    // Check the send quota only after the cooldown, under the same lock. Repeated
    // clicks must not consume another send slot without issuing a new code.
    await beforeIssue?.(tx);
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
  const credits = purpose === "REGISTER" ? await registrationCredits(db) : 0;
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
      const inviter = await findInviter(tx, refCode);
      await createRegisteredUser(tx, {
        email, name: email.split("@")[0], passwordHash, emailVerified: new Date(),
        ...(inviter?.status === "active" ? { inviterId: inviter.id, invitedAt: new Date() } : {}),
      }, credits);
    } else if (existing) {
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    }
    await tx.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return { ok: true };
  });
  if (result.error) throw new AppError(result.error);
  return result;
}
