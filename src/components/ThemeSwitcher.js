"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

// SSR/CSR 一致性：服务端 false、客户端 true，避免 hydration 不匹配
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/**
 * 单按钮主题切换（浅 ↔ 深）
 * 点击循环：light → dark → light
 * 「跟随系统」选项移至 UserMenu
 */
export default function ThemeSwitcher() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  // 显示当前主题（resolvedTheme 解析 system 为实际值）
  const current = mounted ? (resolvedTheme || theme) : "dark";
  const isLight = current === "light";

  return (
    <button
      type="button"
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={isLight}
      title={isLight ? "Switch to dark" : "Switch to light"}
      onClick={() => setTheme(isLight ? "dark" : "light")}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-divider
                 text-secondary-text hover:text-primary-text hover:bg-bg-card-hover
                 transition-colors duration-[120ms] cursor-pointer"
    >
      {isLight ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
    </button>
  );
}