import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

const THEMES = ["dark", "light", "system"];

/**
 * 用户主题偏好持久化（双主题方案：手动切换 → 写 User.theme，下次登录沿用）
 * POST /api/theme { theme: "dark" | "light" | "system" }
 */
export async function POST(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());

    const { theme } = await req.json();
    if (!theme || !THEMES.includes(theme)) {
      return new NextResponse("Invalid theme", { status: 400 });
    }

    const res = NextResponse.json({ ok: true, theme });
    res.cookies.set("theme", theme, {
      maxAge: 365 * 24 * 3600,
      path: "/",
      sameSite: "lax",
    });

    if (session?.user?.id) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { theme },
      }).catch(() => {});
    }

    return res;
  } catch (error) {
    console.error("[THEME_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
