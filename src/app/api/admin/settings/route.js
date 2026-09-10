import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin, auditLog } from "../../../../lib/admin-auth";
import { getSiteConfigView, setSiteConfig, invalidateSiteConfig, getSiteConfigs } from "../../../../lib/site-config";

/**
 * 系统配置（SMTP / Google OAuth / Stripe）— 方案：DB > env 兜底，敏感项 AES 加密
 * GET   /api/admin/settings          → 全部 key 状态视图（脱敏，标注来源 db/env/none）
 * PATCH /api/admin/settings { key, value } → 写入（敏感加密；value 空 = 删除回退 env）
 * POST  /api/admin/settings/test     → 测试连接 { target: "smtp" | "stripe" }
 */
export async function GET(req) {
  const auth = await requireAdmin(req);
  if (auth.response) return auth.response;

  const view = await getSiteConfigView();
  return NextResponse.json({ configs: view });
}

export async function PATCH(req) {
  // 站点级凭据属于危险操作，仅 ROOT
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;

  try {
    const { key, value } = await req.json();
    const result = await setSiteConfig(key, value);
    await auditLog(auth.user.id, "SET_SITE_CONFIG", null, { key, source: value ? "db" : "cleared" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ADMIN_SETTINGS_PATCH]", error);
    return new NextResponse(error.message || "Internal Error", { status: 500 });
  }
}

/** 测试连接：SMTP（发测试邮件到管理员自己）/ Stripe（查余额验证 key） */
export async function POST(req) {
  const auth = await requireAdmin(req, "root");
  if (auth.response) return auth.response;

  try {
    const { target, testEmail } = await req.json();

    if (target === "smtp") {
      const cfg = await getSiteConfigs(["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"]);
      const host = cfg.smtp_host, port = cfg.smtp_port, user = cfg.smtp_user, pass = cfg.smtp_pass, from = cfg.smtp_from;
      if (!host || !user || !pass) {
        return NextResponse.json({ ok: false, error: "SMTP 未配置（需要 host/user/pass）" });
      }
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        host, port: parseInt(port || "465", 10), secure: parseInt(port || "465", 10) === 465,
        auth: { user, pass },
      });
      const to = testEmail || user; // 默认发给发件人自己
      await transporter.sendMail({
        from: from || user,
        to,
        subject: "ModelShot SMTP test",
        text: "SMTP configuration works. 🎉",
      });
      return NextResponse.json({ ok: true, message: `测试邮件已发送至 ${to}` });
    }

    if (target === "stripe") {
      const { getStripe } = await import("../../../../lib/stripe");
      const stripe = await getStripe();
      const balance = await stripe.balance.retrieve();
      return NextResponse.json({
        ok: true,
        message: `Stripe 连接成功 · 可用余额 $${(balance.available[0]?.amount || 0) / 100}`,
      });
    }

    if (target === "google") {
      // OAuth 测试：凭据格式预检 + 重定向 URI 提示（真实跳转测试在登录页做）
      const cfg = await getSiteConfigs(["google_client_id", "google_client_secret"]);
      const clientId = cfg.google_client_id;
      const clientSecret = cfg.google_client_secret;
      if (!clientId || !clientId.includes(".apps.googleusercontent.com")) {
        return NextResponse.json({ ok: false, error: "Client ID 格式应为 xxx.apps.googleusercontent.com" });
      }
      if (!clientSecret) {
        return NextResponse.json({ ok: false, error: "Client Secret 未配置" });
      }
      return NextResponse.json({
        ok: true,
        message: "凭据格式正确 · 请在登录页实测 Google 登录（redirect URI 记得配 /api/auth/callback/google）",
      });
    }

    return new NextResponse("Unknown target", { status: 400 });
  } catch (error) {
    console.error("[ADMIN_SETTINGS_TEST]", error);
    return NextResponse.json({ ok: false, error: error.message || "Test failed" });
  }
}
