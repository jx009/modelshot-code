"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Link } from "@/i18n/navigation";
import { Check, LogOut, Monitor, User, Users, CreditCard, History, CircleHelp } from "lucide-react";

import AccountRecords from "./AccountRecords";

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
  const zh = useLocale() === "zh";
  const [records, setRecords] = useState(null);
  const trigger = useRef(null);
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
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    ref.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", onClick);
    document.addEventListener("focusin", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onClick);
      document.removeEventListener("focusin", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 未登录不渲染（防御：调用方已保证，但组件自守；必须在所有 hooks 之后）
  if (!user) return null;

  const currentTheme = mounted ? (resolvedTheme || theme) : "dark";
  const isSystem = mounted && theme === "system";

  return (
    <div ref={ref} className="relative" style={{ zIndex: 100 }}>
      <button
        ref={trigger}
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
          className="user-menu-panel"
          onKeyDown={event => {
            const items = [...event.currentTarget.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')];
            const index = items.indexOf(document.activeElement);
            const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
            if (next !== null) { event.preventDefault(); items[next]?.focus(); }
          }}
        >
          {user?.email && (
            <div className="px-3 py-2 text-xs text-secondary-text border-b border-divider/50 mb-1 truncate">
              {user.email}
            </div>
          )}

          <Link href="/pricing" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm"><CreditCard size={15} />{zh ? "购买积分" : "Buy credits"}</Link>
          {[["usage", History, "使用记录", "Usage history"], ["orders", CreditCard, "购买记录", "Purchases"], ["help", CircleHelp, "使用指南", "Help"]].map(([id, Icon, cn, en]) => <button key={id} role="menuitem" onClick={() => { setRecords(id); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm"><Icon size={15} />{zh ? cn : en}</button>)}
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
          <p className="px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-tertiary-text font-medium">{t("themeMode")}</p>
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
      {records && <AccountRecords initialTab={records} returnFocusRef={trigger} onClose={() => setRecords(null)} />}
    </div>
  );
}
