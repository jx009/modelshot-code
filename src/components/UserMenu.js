"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Link } from "@/i18n/navigation";
import { Check, LogOut, Monitor, User, Users } from "lucide-react";

// SSR/CSR 一致性：服务端 false、客户端 true，避免 hydration 不匹配
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/**
 * 用户菜单：头像下拉（仅登录态渲染）
 * 主题跟随系统 / 账户入口 / 退出
 * 语言切换已常驻导航栏（LocaleSwitcher），此处不再重复
 */
export default function UserMenu({ user }) {
  const isAgent = ["agent", "admin", "root"].includes(user?.role);
  const t = useTranslations("common");
  const f = useTranslations("flow");
  const invite = useTranslations("invite");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  // 点外侧 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 未登录不渲染（防御：调用方已保证，但组件自守；必须在所有 hooks 之后）
  if (!user) return null;

  const currentTheme = mounted ? (resolvedTheme || theme) : "dark";
  const isSystem = mounted && theme === "system";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user?.email || "User menu"}
        className="h-9 w-9 rounded-full border border-divider bg-bg-page/50 hover:bg-bg-card-hover overflow-hidden flex items-center justify-center transition-colors cursor-pointer"
      >
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <User size={15} className="text-secondary-text" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 min-w-[220px] rounded-[10px] border border-divider bg-bg-card shadow-2xl py-1.5 animate-enter"
          style={{ animationDuration: "160ms" }}
        >
          {user?.email && (
            <div className="px-3 py-2 text-xs text-secondary-text border-b border-divider/50 mb-1 truncate">
              {user.email}
            </div>
          )}

          {/* 邀请中心（agent+ 可见——普通用户看不到，制造升为流量手的动机） */}
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm"><User size={15} />{f("account")}</Link>
          {isAgent && (
            <Link
              href="/invite"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-primary-text hover:bg-bg-card-hover transition-colors cursor-pointer"
            >
              <Users size={13} className="text-primary" />
              <span>{invite("title")}</span>
            </Link>
          )}

          <div className="h-px bg-divider/50 my-1 mx-1" />

          {/* 主题：跟随系统（低频设置，与主切换按钮互补） */}
          <p className="px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-secondary-text/70 font-medium">{t("themeMode")}</p>
          <button
            role="menuitemradio"
            aria-checked={isSystem}
            onClick={() => setTheme(isSystem ? currentTheme : "system")}
            className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              isSystem ? "text-primary" : "text-primary-text hover:bg-bg-card-hover"
            }`}
          >
            <Monitor size={13} className={isSystem ? "text-primary" : "text-secondary-text"} />
            <span className="flex-1 text-left">{t("themeSystem")}</span>
            {isSystem && <Check size={13} className="text-primary" />}
          </button>

          <div className="h-px bg-divider/50 my-1 mx-1" />

          <button
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 transition-colors cursor-pointer"
          >
            <LogOut size={13} />
            <span>{t("signOut")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
