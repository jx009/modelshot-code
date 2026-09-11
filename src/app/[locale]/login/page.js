"use client";

import { signIn, useSession, getProviders } from "next-auth/react";
import { ArrowRight, Info, Key, Mail } from "lucide-react";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast, { Toaster } from "react-hot-toast";
import ContentShell from "@/components/ContentShell";
import { useTranslations } from "next-intl";
import { safeNext } from "@/lib/client-api";

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

function LoginContent() {
  const t = useTranslations("login");
  const te = useTranslations("errors");
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("callbackUrl") || searchParams.get("next") || "";
  const next = safeNext(rawNext && rawNext !== "/" ? rawNext : "/studio");
  const refCode = searchParams.get("ref") || ""; // 分销邀请码（注册时绑定，一次性）

  const [activeTab, setActiveTab] = useState("google"); // "google" | "email"
  const [googleAvailable, setGoogleAvailable] = useState(false);
  useEffect(() => { getProviders().then(providers => { setGoogleAvailable(!!providers?.google); if (!providers?.google) setActiveTab("email"); }); }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 邮箱登录状态（login / register / reset 三态，照搬 LetAiCode 交互）
  const [emailMode, setEmailMode] = useState("login");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeSending, setCodeSending] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.push(next);
    }
  }, [status, router, next]);

  // 发送验证码到邮箱；本地环境由 Mailpit 捕获。
  const handleSendCode = async (purpose) => {
    if (!emailInput.trim()) {
      toast.error(te("INVALID_EMAIL"));
      return;
    }
    setCodeSending(true);
    try {
      const res = await fetch("/api/auth/email/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim(), purpose }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(te(data.error || "GENERIC"));
        return;
      }
      toast.success(t("codeSent"));
    } catch (err) {
      toast.error(te("GENERIC"));
    } finally {
      setCodeSending(false);
    }
  };

  // 邮箱登录 / 注册提交（注册成功后自动走 signIn）
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    const password = passwordInput;

    if (!email || !password) {
      toast.error(te("GENERIC"));
      return;
    }

    setIsSubmitting(true);
    try {
      if (emailMode === "register") {
        const res = await fetch("/api/auth/email/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, code: codeInput.trim(), refCode: refCode || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(te(data.error || "GENERIC"));
          return;
        }
        toast.success(t("registerOk"));
      }

      const res = await signIn("email", {
        email,
        password,
        redirect: false,
        callbackUrl: next,
      });
      if (res?.error) {
        toast.error(te("INVALID_CREDENTIALS"));
      } else {
        toast.success(t("success"));
        router.push(next);
      }
    } catch (err) {
      toast.error(te("GENERIC"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重置密码提交（成功后回登录态）
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/email/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: passwordInput, code: codeInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(te(data.error || "GENERIC"));
        return;
      }
      toast.success(t("resetOk"));
      setEmailMode("login");
    } catch (err) {
      toast.error(te("GENERIC"));
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <ContentShell className="items-center justify-center px-6 select-none">
      <Toaster position="top-right" />
      <div className="relative bg-bg-card border border-divider w-full max-w-md rounded-xl p-8 space-y-6 shadow-2xl animate-scale-up">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-2xl text-primary font-medium shadow-md shadow-primary/15">
            👗
          </div>
          <h2 className="text-2xl font-medium tracking-tight">{t("title")}</h2>
          <p className="text-xs font-medium text-secondary-text leading-relaxed px-2">
            {t("subtitle")}
          </p>
        </div>

        {/* Auth Method Selector Tabs */}
        <div className="flex bg-bg-page p-1 rounded-lg border border-divider/60">
          <button
            type="button"
            disabled={!googleAvailable}
            onClick={() => setActiveTab("google")}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === "google"
                ? "bg-bg-card text-primary-text shadow-sm border border-divider/40"
                : "text-secondary-text hover:text-primary-text"
            }`}
          >
            <GoogleIcon />
            <span>{t("googleTab")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("email")}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === "email"
                ? "bg-bg-card text-primary-text shadow-sm border border-divider/40"
                : "text-secondary-text hover:text-primary-text"
            }`}
          >
            <Mail size={13} className="text-primary" />
            <span>{t("emailTab")}</span>
          </button>


        </div>

        {/* Tab Content */}
        {activeTab === "google" ? (
          <div className="space-y-4 pt-2">
            <button
              disabled={!googleAvailable}
              onClick={() => signIn("google", { callbackUrl: next })}
              className="w-full py-3.5 bg-bg-card text-primary-text border border-divider rounded-full text-xs font-medium flex items-center justify-center gap-3 hover:opacity-90 transition-all shadow-md active:scale-[0.98] cursor-pointer"
            >
              <GoogleIcon />
              <span>{t("googleBtn")}</span>
            </button>
            <p className="text-xs text-center text-secondary-text">
              {t("googleHint")}
            </p>
          </div>
        ) : (
          <form onSubmit={emailMode === "reset" ? handleResetSubmit : handleEmailSubmit} className="space-y-4 pt-2">
            <p className="text-xs text-secondary-text leading-relaxed">{t("emailHint")}</p>

            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-xs font-medium text-secondary-text">{t("emailLabel")}</label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/60 transition-colors"
              />
            </div>

            {emailMode !== "login" && (
              <div className="space-y-1.5">
                <label htmlFor="login-code" className="block text-xs font-medium text-secondary-text">{t("codeLabel")}</label>
                <div className="flex gap-2">
                  <input
                    id="login-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="000000"
                    className="flex-1 bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/60 transition-colors tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => handleSendCode(emailMode === "register" ? "REGISTER" : "RESET_PASSWORD")}
                    disabled={codeSending}
                    className="px-3.5 rounded-lg border border-primary/40 text-primary text-xs font-medium hover:bg-primary-muted transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap min-h-[40px]"
                  >
                    {codeSending ? "..." : t("sendCode")}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-xs font-medium text-secondary-text">
                {emailMode === "reset" ? t("newPasswordLabel") : t("passwordLabel")}
              </label>
              <input
                id="login-password"
                type="password"
                required
                minLength={8}
                autoComplete={emailMode === "login" ? "current-password" : "new-password"}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={emailMode === "login" ? "••••••••" : ">= 8 " + t("passwordLabel")}
                className="w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/60 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[44px] py-3 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-sm font-medium transition-all cursor-pointer btn-sheen active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting
                ? "..."
                : emailMode === "login"
                  ? t("emailSubmit")
                  : emailMode === "register"
                    ? t("registerSubmit")
                    : t("resetSubmit")}
            </button>

            <div className="flex items-center justify-between text-xs">
              {emailMode === "login" ? (
                <>
                  <button type="button" onClick={() => setEmailMode("register")} className="text-primary hover:underline cursor-pointer">
                    {t("noAccount")} {t("modeRegister")}
                  </button>
                  <button type="button" onClick={() => setEmailMode("reset")} className="text-secondary-text hover:text-primary-text cursor-pointer">
                    {t("forgot")}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setEmailMode("login")} className="text-secondary-text hover:text-primary-text cursor-pointer">
                  {t("backToLogin")}
                </button>
              )}
            </div>
          </form>
        )}

        <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/10 p-3.5 rounded text-xs leading-relaxed text-secondary-text">
          <Info className="text-primary text-xs shrink-0 mt-0.5"  />
          <span>
            {t("terms")}
          </span>
        </div>
      </div>
    </ContentShell>
  );
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-bg-page text-primary-text">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
