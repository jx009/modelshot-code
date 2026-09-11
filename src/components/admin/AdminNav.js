"use client";

import { Link, usePathname } from "@/i18n/navigation";

const LINKS = [
  { href: "/admin", label: "数据看板" },
  { href: "/admin/operations", label: "运行与账务" },
  { href: "/admin/providers", label: "模型通道" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/tryons", label: "生成审计" },
  { href: "/admin/orders", label: "订单管理" },
  { href: "/admin/cost", label: "成本利润" },
  { href: "/admin/commissions", label: "分销佣金" },
  { href: "/admin/settings", label: "系统设置" },
  { href: "/admin/models", label: "模特预设" },
  { href: "/admin/presets", label: "场景预设" },
  { href: "/admin/prompts", label: "Prompt 模板" },
];

export default function AdminNav({ mobile = false }) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <nav className="flex gap-2 md:hidden mb-5 overflow-x-auto pb-1">
        {LINKS.map(l => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                active
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-bg-card border-divider text-secondary-text hover:text-primary-text"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="py-3">
      {LINKS.map(l => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`block px-5 py-2.5 text-xs font-bold transition-colors ${
              active
                ? "text-primary bg-primary/10 border-r-2 border-primary"
                : "text-secondary-text hover:text-primary-text hover:bg-bg-page/50"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
