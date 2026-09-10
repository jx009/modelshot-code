import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { routing } from "../../../i18n/routing.js";

/**
 * 用户语言偏好持久化（方案 2.4：手动切换 → 写 User.locale，下次登录沿用）
 * POST /api/locale { locale: "en" | "zh" }
 */
export async function POST(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());

    const { locale } = await req.json();
    if (!locale || !routing.locales.includes(locale)) {
      return new NextResponse("Invalid locale", { status: 400 });
    }

    // 未登录：只写 Cookie（浏览器记忆）
    const res = NextResponse.json({ ok: true, locale });
    res.cookies.set("NEXT_LOCALE", locale, {
      maxAge: 365 * 24 * 3600,
      path: "/",
      sameSite: "lax",
    });

    // 已登录：同步写库（下次登录沿用）
    if (session?.user?.id) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { locale },
      }).catch(() => {});
    }

    return res;
  } catch (error) {
    console.error("[LOCALE_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
