"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import clsx from "clsx";

/**
 * 语言切换器 — 切换时保留当前路径，仅替换 locale 前缀
 */
export default function LocaleSwitcher({ compact = false }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = (next) => {
    if (next === locale) return;
    // 持久化偏好：Cookie（未登录）+ User.locale（已登录），下次沿用
    fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
    router.replace(pathname, { locale: next });
  };

  return (
    <div className="flex items-center bg-bg-page border border-divider rounded-full p-0.5">
      {[
        { id: "en", label: "EN" },
        { id: "zh", label: "中" },
      ].map(l => (
        <button
          key={l.id}
          onClick={() => switchTo(l.id)}
          className={clsx(
            "px-2.5 rounded-full font-bold transition-colors cursor-pointer",
            compact ? "text-[10px] py-0.5" : "text-[11px] py-1",
            locale === l.id ? "bg-primary/15 text-primary" : "text-secondary-text hover:text-primary-btn-text"
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
