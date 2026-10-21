"use client";

import { useLocale } from "next-intl";
import { contentTransition, destinationPath, destinationSection } from "@/lib/navigation-destination";
import { useNavigationState } from "./NavigationFeedback";

const TITLES = {
  "/": ["创作首页", "Create"],
  "/explore": ["灵感发现", "Explore"],
  "/commerce": ["电商套图 Agent", "Commerce Agent"],
  "/studio-v2": ["自由画布", "Canvas"],
  "/studio": ["工作室", "Studio"],
  "/projects": ["我的项目", "My projects"],
  "/assets": ["素材库", "Assets"],
  "/pricing": ["价格方案", "Pricing"],
  "/account": ["我的账户", "My account"],
  "/admin": ["数据看板", "Dashboard"],
  "/admin/users": ["用户管理", "Users"],
  "/admin/operations": ["运行与账务", "Operations"],
  "/admin/providers": ["模型配置", "Providers"],
  "/admin/resolution-pricing": ["分辨率积分", "Resolution pricing"],
  "/admin/studio-tools": ["工具配置", "Studio tools"],
  "/admin/storage": ["云存储与图片加速", "Storage"],
  "/admin/tryons": ["生成审计", "Generation audit"],
  "/admin/inspiration": ["灵感管理", "Inspiration"],
  "/admin/orders": ["订单管理", "Orders"],
  "/admin/billing": ["充值与支付", "Billing"],
  "/admin/cost": ["成本利润", "Costs"],
  "/admin/commissions": ["分销佣金", "Commissions"],
  "/admin/settings": ["系统设置", "Settings"],
  "/admin/announcements": ["公告管理", "Announcements"],
  "/admin/models": ["模特预设", "Model presets"],
  "/admin/presets": ["场景预设", "Scene presets"],
  "/admin/prompts": ["Prompt 模板", "Prompt templates"],
};

export default function NavigationContent({ children, section = "root" }) {
  const navigation = useNavigationState();
  const zh = useLocale() === "zh";
  const active = contentTransition(navigation, section);
  const pathname = active ? destinationPath(navigation.href) : "";
  const title = TITLES[pathname] || (pathname.startsWith("/explore/") ? ["灵感详情", "Inspiration details"] : ["页面内容", "Page content"]);
  const table = pathname === "/admin/users" || pathname === "/admin/orders";
  const canvas = pathname === "/studio-v2" || pathname === "/studio";
  return <div className="navigation-content" aria-busy={active || undefined}>
    <div className="navigation-current" hidden={active} inert={active || undefined}>{children}</div>
    {active && <section className="navigation-destination" data-section={destinationSection(navigation.href)} role="status" aria-live="polite" aria-label={title[zh ? 0 : 1]}>
      <h1>{title[zh ? 0 : 1]}</h1>
      <p>{navigation.slow ? zh ? "加载时间较长，你可以切换其他页面或重试。" : "Loading is taking longer. You can open another page or retry." : zh ? "正在加载内容…" : "Loading content…"}</p>
      <div className={`navigation-skeleton ${table ? "navigation-skeleton-table" : canvas ? "navigation-skeleton-canvas" : ""}`} aria-hidden="true">{(canvas ? [0, 1, 2] : [0, 1, 2, 3, 4, 5]).map(index => <span key={index} />)}</div>
      {navigation.slow && <a href={navigation.href} className="navigation-retry">{zh ? "重新打开页面" : "Reload destination"}</a>}
    </section>}
  </div>;
}
