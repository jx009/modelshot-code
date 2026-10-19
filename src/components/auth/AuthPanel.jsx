"use client";
import { useEffect, useRef, useState } from "react";
import { getProviders, getSession, signIn, useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ArrowUpRight, Check, Eye, EyeOff, LoaderCircle, Mail, X } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import { authDestination } from "@/lib/auth-navigation";
import styles from "./auth.module.css";

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
}

export default function AuthPanel({ request, onClose, onSuccess }) {
  const locale = useLocale(), zh = locale === "zh";
  const t = useTranslations("login"), te = useTranslations("errors");
  const { status, update } = useSession();
  const [mode, setMode] = useState("login"), [google, setGoogle] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [code, setCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState(""), [showConfirmation, setShowConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false), [busy, setBusy] = useState(false), [sending, setSending] = useState(false), [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState(request.error ? zh ? "登录未完成，请重试或使用邮箱登录。" : "Sign-in was not completed. Please try again or use email." : ""), [notice, setNotice] = useState("");
  const lock = useRef(false), sendLock = useRef(false);
  const callbackUrl = request.callbackUrl ? authDestination(request.callbackUrl, locale) : null;
  useEffect(() => { let active = true; getProviders().then(p => { if (active) setGoogle(!!p?.google); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (status !== "authenticated" || lock.current) return;
    let active = true;
    getSession().then(fresh => { if (active && fresh?.user?.id) onSuccess(); }).catch(() => {});
    return () => { active = false; };
  }, [status, onSuccess]);
  function changeMode(next) { setMode(next); setCode(""); setPassword(""); setConfirmPassword(""); setShowPassword(false); setShowConfirmation(false); setError(""); setNotice(""); }
  function failure(code) { setError(te.has(code) ? te(code) : te("GENERIC")); }
  async function sendCode() {
    if (sendLock.current || cooldown) return;
    const input = document.getElementById("auth-email");
    if (!input?.reportValidity()) return;
    sendLock.current = true; setSending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/email/send-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), purpose: mode === "register" ? "REGISTER" : "RESET_PASSWORD" }) });
      const body = await response.json();
      if (!response.ok) {
        failure(body.code || body.error || "GENERIC");
        if (response.status === 429) {
          const retry = Number(body.retryAfter || response.headers.get("Retry-After"));
          setCooldown(Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 60);
        }
        return;
      }
      setNotice(t("codeSent")); setCooldown(60);
    } catch { failure("GENERIC"); } finally { sendLock.current = false; setSending(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    if (mode !== "login" && password !== confirmPassword) { failure("PASSWORD_MISMATCH"); return; }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (mode !== "login") {
        const response = await fetch(`/api/auth/email/${mode === "register" ? "register" : "reset-password"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase(), password, confirmPassword, code: code.trim(), ...(mode === "register" && request.refCode ? { refCode: request.refCode } : {}) }) });
        const body = await response.json();
        if (!response.ok) { failure(body.code || body.error || "GENERIC"); return; }
        if (mode === "reset") { changeMode("login"); setNotice(t("resetOk")); return; }
      }
      const result = await signIn("email", { email: email.trim().toLowerCase(), password, redirect: false, callbackUrl: callbackUrl || window.location.href });
      if (!result || result.error) { failure("INVALID_CREDENTIALS"); return; }
      const fresh = await getSession();
      if (!fresh?.user?.id) { failure("GENERIC"); return; }
      await update();
      onSuccess();
    } catch { failure("GENERIC"); } finally { lock.current = false; setBusy(false); }
  }
  const title = mode === "register" ? zh ? "开启你的创作之旅" : "Make room for your ideas" : mode === "reset" ? zh ? "找回密码" : "Reset your password" : zh ? "欢迎回来" : "Welcome back";
  return <div className={styles.panel}>
    <section className={styles.formPanel}>
      <header className={styles.header}><span className={styles.brand}><BrandMark size={30} /><span className={styles.wordmark}><strong>来塔绘梦</strong><small>letaidraw</small></span></span><button className={styles.close} onClick={onClose} aria-label={zh ? "关闭登录" : "Close sign in"}><X size={18} /></button></header>
      <div className={styles.content}>
        <div className={styles.intro}><span className={styles.eyebrow}>{mode === "register" ? "YOUR NEXT CHAPTER" : mode === "reset" ? "ACCOUNT RECOVERY" : "YOUR CREATIVE SPACE"}</span><h1>{title}</h1><p>{mode === "reset" ? zh ? "验证邮箱后，为账号设置一个新密码。" : "Verify your email to set a new password." : zh ? "让下一份灵感，成为作品。" : "Turn your next inspiration into something beautiful."}</p></div>
        {google && mode !== "reset" && <><button className={styles.google} disabled={busy} onClick={() => signIn("google", { callbackUrl: callbackUrl || window.location.href })}><GoogleIcon />{t("googleBtn")}</button><div className={styles.divider}><span>{zh ? "或使用邮箱" : "or continue with email"}</span></div></>}
        <form onSubmit={submit} className={styles.form}>
          <fieldset disabled={busy}>
            <label htmlFor="auth-email">{t("emailLabel")}</label><div className={styles.inputWrap}><Mail size={16} /><input id="auth-email" type="email" required autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
            {mode !== "login" && <><label htmlFor="auth-code">{t("codeLabel")}</label><div className={styles.codeRow}><input id="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder={zh ? "6 位邮箱验证码" : "6-digit email code"} /><button type="button" onClick={sendCode} disabled={sending || cooldown > 0}>{sending ? <LoaderCircle size={15} className={styles.spinner} /> : cooldown ? cooldown >= 60 ? `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}` : `${cooldown}s` : t("sendCode")}</button></div></>}
            <div className={styles.labelRow}><label htmlFor="auth-password">{mode === "reset" ? t("newPasswordLabel") : t("passwordLabel")}</label>{mode === "login" && <button type="button" onClick={() => changeMode("reset")}>{t("forgot")}</button>}</div>
            <div className={styles.inputWrap}><input id="auth-password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={zh ? mode === "login" ? "请输入密码" : "至少 8 位字符" : mode === "login" ? "Enter your password" : "At least 8 characters"} /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={zh ? showPassword ? "隐藏密码" : "显示密码" : showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            {mode !== "login" && <><div className={styles.labelRow}><label htmlFor="auth-confirm-password">{zh ? "确认密码" : "Confirm password"}</label></div><div className={styles.inputWrap}><input id="auth-confirm-password" type={showConfirmation ? "text" : "password"} required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder={zh ? "请再次输入密码" : "Enter your password again"} /><button type="button" onClick={() => setShowConfirmation(v => !v)} aria-label={zh ? showConfirmation ? "隐藏确认密码" : "显示确认密码" : showConfirmation ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmation ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></>}
            {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}><Check size={14} />{notice}</p>}
            <button type="submit" className={styles.submit}>{busy ? <LoaderCircle size={17} className={styles.spinner} /> : <>{mode === "login" ? t("emailSubmit") : mode === "register" ? t("registerSubmit") : t("resetSubmit")}<ArrowRight size={17} /></>}</button>
            <div className={styles.switchMode}>{mode === "login" ? <><span>{t("noAccount")}</span><button type="button" onClick={() => changeMode("register")}>{zh ? "免费注册" : "Create an account"}<ArrowUpRight size={13} /></button></> : <button type="button" onClick={() => changeMode("login")}>{t("backToLogin")}</button>}</div>
          </fieldset>
        </form>
      </div>
      <footer className={styles.footer}>{t("terms")}</footer>
    </section>
  </div>;
}
