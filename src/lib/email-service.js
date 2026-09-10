import crypto from "crypto";
import { getSiteConfigs } from "./site-config";

/**
 * 邮件服务（SMTP 配置来源：DB SystemConfig → env 兜底）
 * - 已配置：nodemailer 真实发送
 * - 未配置：console.log + 响应返回 devCode（开发模式）
 */

async function loadSmtpConfig() {
  const cfg = await getSiteConfigs(["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"]);
  const { smtp_host: host, smtp_port: port, smtp_user: user, smtp_pass: pass, smtp_from: from } = cfg;
  if (host && user && pass) {
    return { host, port: parseInt(port || "465", 10), user, pass, from: from || user };
  }
  return null;
}

/** 生成 6 位数字验证码 */
export function generateVerificationCode() {
  return String(crypto.randomInt(100000, 999999));
}

/**
 * 发送验证码邮件
 * @returns {{ sent: boolean, devCode?: string }} devCode 仅在 SMTP 未配置（开发模式）时返回
 */
export async function sendVerificationEmail(email, code, purpose) {
  const subject = purpose === "REGISTER" ? "Your ModelShot verification code" : "Reset your ModelShot password";
  const text = `Your verification code is: ${code}\nIt expires in 5 minutes.\n\nIf you didn't request this, ignore this email.`;

  const smtp = await loadSmtpConfig();
  if (!smtp) {
    // 开发模式：不真发，打印 + 返回给前端（仅本地调试用）
    console.log(`[EmailService:DEV] To: ${email} | ${subject} | Code: ${code}`);
    return { sent: false, devCode: code };
  }

  // 真实发送（nodemailer，动态 import 避免冷启动开销）
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject,
    text,
  });
  return { sent: true };
}
