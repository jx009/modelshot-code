import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../../lib/prisma";

const normalize = (email) => String(email || "").trim().toLowerCase();

function validatePassword(password) {
  // 照搬 LetAiCode 规则：8-72 位
  if (!password || password.length < 8) return "PASSWORD_TOO_SHORT";
  if (password.length > 72) return "PASSWORD_TOO_LONG";
  return null;
}

/**
 * 校验验证码（5 分钟有效，最多 5 次尝试，照搬 LetAiCode）
 */
async function consumeCode(email, purpose, code) {
  const record = await prisma.verificationCode.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { error: "CODE_NOT_FOUND" };
  if (record.expiresAt < new Date()) {
    await prisma.verificationCode.deleteMany({ where: { email, purpose } });
    return { error: "CODE_EXPIRED" };
  }
  if (record.attempts >= 5) {
    await prisma.verificationCode.deleteMany({ where: { email, purpose } });
    return { error: "CODE_TOO_MANY_ATTEMPTS" };
  }
  if (record.code !== String(code).trim()) {
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return { error: "CODE_INVALID" };
  }
  // 验证通过：作废
  await prisma.verificationCode.deleteMany({ where: { email, purpose } });
  return { ok: true };
}

/**
 * 邮箱注册（照搬 LetAiCode register：邮箱+验证码+密码）
 * POST /api/auth/email/register { email, password, code }
 */
export async function POST(req) {
  try {
    const { email, password, code, refCode } = await req.json();
    const normalized = normalize(email);

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    const pwError = validatePassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });
    if (!code) return NextResponse.json({ error: "CODE_REQUIRED" }, { status: 400 });

    const existing = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "EMAIL_ALREADY_REGISTERED" }, { status: 409 });
    }

    const codeCheck = await consumeCode(normalized, "REGISTER", code);
    if (codeCheck.error) {
      return NextResponse.json({ error: codeCheck.error }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email: normalized, name: normalized.split("@")[0], passwordHash, credits: 0 },
      select: { id: true, email: true, name: true },
    });

    // 分销：绑定邀请人（一次性）+ 生成自己的邀请码（懒生成容错）
    if (refCode) await bindInviter(user.id, refCode).catch(() => {});
    await ensureInviteCode(user.id).catch(() => {});

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    console.error("[EMAIL_REGISTER]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
