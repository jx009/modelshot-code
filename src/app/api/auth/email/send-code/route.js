import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { generateVerificationCode, sendVerificationEmail } from "../../../../../lib/email-service";

/**
 * 发送邮箱验证码（照搬 LetAiCode sendVerificationCode 机制）
 * POST /api/auth/email/send-code { email, purpose: "REGISTER" | "RESET_PASSWORD" }
 * - 5 分钟有效，60 秒内不可重发
 * - REGISTER：邮箱已注册则拒绝
 * - RESET_PASSWORD：邮箱未注册则拒绝（不暴露存在性：统一返回成功？——LetAiCode 直接拒绝，照搬）
 * - SMTP 未配置（开发模式）：响应带 devCode 便于本地调试
 */
export async function POST(req) {
  try {
    const { email, purpose } = await req.json();
    const normalized = String(email || "").trim().toLowerCase();
    const validPurpose = purpose === "REGISTER" || purpose === "RESET_PASSWORD";

    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    if (!validPurpose) {
      return NextResponse.json({ error: "INVALID_PURPOSE" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (purpose === "REGISTER" && user) {
      return NextResponse.json({ error: "EMAIL_ALREADY_REGISTERED" }, { status: 409 });
    }
    if (purpose === "RESET_PASSWORD" && !user) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // 60 秒防刷：最近一条未过期的验证码在 60 秒内发出的，拒绝
    const recent = await prisma.verificationCode.findFirst({
      where: { email: normalized, purpose, createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    });
    if (recent) {
      return NextResponse.json({ error: "CODE_RATE_LIMITED" }, { status: 429 });
    }

    // 作废旧验证码 + 写入新验证码（5 分钟有效）
    const code = generateVerificationCode();
    await prisma.$transaction([
      prisma.verificationCode.deleteMany({ where: { email: normalized, purpose } }),
      prisma.verificationCode.create({
        data: { email: normalized, code, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      }),
    ]);

    const result = await sendVerificationEmail(normalized, code, purpose);

    return NextResponse.json({
      ok: true,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  } catch (error) {
    console.error("[SEND_CODE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
