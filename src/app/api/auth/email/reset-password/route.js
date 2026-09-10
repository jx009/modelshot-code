import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../../../../lib/prisma";

const normalize = (email) => String(email || "").trim().toLowerCase();

function validatePassword(password) {
  if (!password || password.length < 8) return "PASSWORD_TOO_SHORT";
  if (password.length > 72) return "PASSWORD_TOO_LONG";
  return null;
}

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
  await prisma.verificationCode.deleteMany({ where: { email, purpose } });
  return { ok: true };
}

/**
 * 重置密码（照搬 LetAiCode resetPassword：邮箱+验证码+新密码）
 * POST /api/auth/email/reset-password { email, password, code }
 */
export async function POST(req) {
  try {
    const { email, password, code } = await req.json();
    const normalized = normalize(email);

    const pwError = validatePassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (!user) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    const codeCheck = await consumeCode(normalized, "RESET_PASSWORD", code);
    if (codeCheck.error) {
      return NextResponse.json({ error: codeCheck.error }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[EMAIL_RESET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
