"use client";
import { useSyncExternalStore } from "react";
import { preloadCanvas } from "@/lib/studio/preload-canvas";
import CreditIcon from "@/components/ui/CreditIcon";
import { SHOW_LANGUAGE_SWITCHER } from "@/lib/ui-features";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecharge } from "@/components/billing/RechargeProvider";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { usePathname } from "@/i18n/navigation";
import Link from "@/components/ui/NavigationLink";
import NavigationContent from "@/components/ui/NavigationContent";
import { useNavigationPath } from "@/components/ui/NavigationFeedback";
import { Compass, House, Images, LayoutGrid, ShoppingBag, ArrowUpRight, FolderOpen, CircleHelp, Globe2, SunMoon } from "lucide-react";
import "./discover.css";
import "./creative-direction.css";
import "./parity.css";
import "./atelier.css";
import "./inspiration.css";
import "./brand-navigation.css";
import UserMenu from "@/components/UserMenu";
import BrandLogo from "@/components/BrandLogo";
import RecentProjects from "@/components/studio/RecentProjects";
import MobileNavigation from "./MobileNavigation";

function subscribeScroll(onChange) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
const isScrolled = () => window.scrollY > 48;
const initialScroll = () => false;

export default function CreativeShell({ children }) {
  const scrolled = useSyncExternalStore(subscribeScroll, isScrolled, initialScroll);
  const { resolvedTheme, setTheme } = useTheme();
  const recharge = useRecharge();
  const auth = useAuth();
  const zh = useLocale() === "zh", path = useNavigationPath("creative", usePathname()), { data: session } = useSession();
  const links = [["/", House, "创作首页", "Create"], ["/explore", Compass, "灵感发现", "Explore"], ["/commerce", ShoppingBag, "电商套图 Agent", "Commerce Agent"], ["/studio-v2", LayoutGrid, "自由画布", "Canvas"], ["/projects", Images, "我的项目", "My projects"], ["/assets", FolderOpen, "素材库", "Assets"]];
  return <div className="cr-shell"><aside className="cr-sidebar"><Link prefetch="intent" href="/" className="cr-logo" aria-label="来塔绘梦"><BrandLogo /></Link><div className="cr-workspace-label">{zh ? "创意工作空间" : "YOUR CREATIVE SPACE"}</div><nav aria-label={zh ? "创作导航" : "Creative navigation"}>{links.map(([href, Icon, cn, en], index) => <Link prefetch={path === href ? false : "idle"} prefetchDelay={1500 + index * 1000} onPrefetch={href === "/studio-v2" ? preloadCanvas : undefined} key={href} href={href} aria-label={zh ? cn : en} title={zh ? cn : en} className={path === href || href === "/explore" && path.startsWith("/explore/") ? "active" : ""}><Icon size={18} /><span>{zh ? cn : en}</span>{href === "/commerce" && <small>NEW</small>}</Link>)}</nav><div className="cr-sidebar-bottom"><div className="cr-upgrade"><span className="cr-overline">CREATE SOMETHING GREAT</span><p>{zh ? "让好想法，多一点可能。" : "Make more room for good ideas."}</p><button className="cr-recharge-upgrade" onClick={recharge.open}>{zh ? "积分充值" : "Buy credits"}<ArrowUpRight size={15} /></button></div><Link prefetch="intent" className="cr-support" href="/explore"><CircleHelp size={16} />{zh ? "从一个案例开始" : "Start with a reference"}</Link><button className="cr-account" onClick={() => session?.user ? recharge.openRecords("usage") : auth.open()}><span className="cr-avatar">{session?.user ? (session.user.name || session.user.email).slice(0, 1).toUpperCase() : "L"}</span><span>{session?.user ? session.user.name || (zh ? "我的账户" : "My account") : zh ? "登录，保存你的创意" : "Sign in to save your ideas"}<small>{zh ? "你的下一件作品，从这里开始" : "Your next creation starts here"}</small></span></button></div></aside><div className="cr-main"><header className="cr-topbar" data-scrolled={scrolled || undefined}><div className="cr-topbar-surface"><div className="cr-topbar-context"><MobileNavigation links={links} path={path} zh={zh} /><span className="cr-live-dot" /><span className="cr-workspace-title">{zh ? "创意工作室" : "Creative studio"}</span>{session?.user && <RecentProjects zh={zh} />}</div><div className="cr-topbar-actions"><button className="cr-theme-toggle" aria-label={zh ? "切换明暗主题" : "Toggle color theme"} title={zh ? "切换明暗主题" : "Toggle color theme"} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><SunMoon size={17} /></button>{SHOW_LANGUAGE_SWITCHER && <Link prefetch="intent" href={path} locale={zh ? "en" : "zh"} aria-label={zh ? "Switch to English" : "切换中文"}><Globe2 size={15} />{zh ? "EN" : "中文"}</Link>}<button className="cr-recharge-trigger" onClick={recharge.open} aria-label={zh ? "积分充值" : "Buy credits"}><CreditIcon />{session?.user?.credits ?? "—"}</button>{session?.user ? <UserMenu user={session.user} /> : <Link prefetch="intent" className="cr-top-cta" href="/login">{zh ? "登录" : "Sign in"}<ArrowUpRight size={14} /></Link>}</div></div></header><NavigationContent section="creative">{children}</NavigationContent><footer className="cr-footer"><span>来塔绘梦 © {new Date().getFullYear()} · {zh ? "让想象有形" : "Make imagination visible"}</span><span>{zh ? "从灵感出发，让创作发生。" : "Start with inspiration. Make something yours."}</span></footer></div></div>;
}
