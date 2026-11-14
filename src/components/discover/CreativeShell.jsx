"use client";
import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
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
import { useLocalNavigation } from "@/components/ui/LocalNavigation";
import { useNavigationPath } from "@/components/ui/NavigationFeedback";
import { House, Images, ImagePlus, Clapperboard, Presentation, ShoppingBag, ArrowUpRight, FolderOpen, Globe2, SunMoon, PanelLeftOpen, PanelLeftClose } from "lucide-react";
import "./discover.css";
import "./creative-direction.css";
import "./parity.css";
import "./atelier.css";
import "./inspiration.css";
import "./brand-navigation.css";
import "./shell.css";
import UserMenu from "@/components/UserMenu";
import { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from "@/components/creation/WorkspaceHeader";
import { BrandMark } from "@/components/BrandLogo";
import MobileNavigation from "./MobileNavigation";
import { subscribeWorkspaceTitle, workspaceTitleSnapshot, workspaceTitleServerSnapshot } from "@/lib/creation/client/workspace-title";

const RecentProjects = dynamic(() => import("@/components/studio/RecentProjects"), { ssr: false });

function subscribeScroll(onChange) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
const isScrolled = () => window.scrollY > 48;
const initialScroll = () => false;

function CreativeShellContent({ children }) {
  const creationTitle = useSyncExternalStore(subscribeWorkspaceTitle, workspaceTitleSnapshot, workspaceTitleServerSnapshot);
  const [navigationExpanded, setNavigationExpanded] = useState(false);
  const scrolled = useSyncExternalStore(subscribeScroll, isScrolled, initialScroll);
  const { resolvedTheme, setTheme } = useTheme();
  const recharge = useRecharge();
  const auth = useAuth();
  const local = useLocalNavigation(), routePath = usePathname();
  const zh = useLocale() === "zh", path = useNavigationPath("creative", local?.path ?? routePath), { data: session } = useSession();
  const compactWorkspace = path === "/creation" || path === "/video";
  const links = [
    ["/", House, "首页", "Home"],
    ["/studio-v2", ImagePlus, "图像", "Image"],
    ["/video", Clapperboard, "视频", "Video"],
    ["/creation", Presentation, "PPT", "Slides"],
    ["/commerce", ShoppingBag, "电商", "Commerce"],
    ["/projects", Images, "作品", "Works"],
    ["/assets", FolderOpen, "素材", "Assets"],
  ];
  const credits = session?.user?.credits;
  return <div className={`cr-shell ls${compactWorkspace ? " cr-shell-creation" : ""}`} data-workspace={path === "/video" ? "video" : undefined} data-navigation-expanded={compactWorkspace && navigationExpanded || undefined}>
    <aside className="cr-sidebar">
      <Link prefetch="intent" href="/" className="cr-logo" aria-label="来塔绘梦"><BrandMark size={30} /></Link>
      {compactWorkspace && <button type="button" className="cr-sidebar-toggle" aria-expanded={navigationExpanded} aria-label={zh ? navigationExpanded ? "收起侧边导航" : "展开侧边导航" : navigationExpanded ? "Collapse navigation" : "Expand navigation"} onClick={() => setNavigationExpanded(value => !value)}>{navigationExpanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>}
      <nav aria-label={zh ? "创作导航" : "Creative navigation"}>{links.map(([href, Icon, cn, en]) => {
        const active = path === href || href === "/" && path.startsWith("/explore/");
        return <Link prefetch={active ? false : "intent"} onPrefetch={href === "/studio-v2" ? preloadCanvas : undefined} key={href} href={href} aria-label={zh ? cn : en} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>
          <span className="ls-nav-icon"><Icon size={19} strokeWidth={1.8} /></span><span>{zh ? cn : en}</span>
        </Link>;
      })}</nav>
      <div className="cr-sidebar-bottom">
        <button className="ls-rail-button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={zh ? "切换明暗主题" : "Toggle color theme"} title={zh ? "切换明暗主题" : "Toggle color theme"}><SunMoon size={18} strokeWidth={1.8} /></button>
        <button className="cr-account" onClick={() => session?.user ? recharge.openRecords("usage") : auth.open()} aria-label={session?.user ? zh ? "我的账户" : "My account" : zh ? "登录" : "Sign in"}>
          <span className="cr-avatar">{session?.user ? (session.user.name || session.user.email).slice(0, 1).toUpperCase() : "L"}</span>
        </button>
      </div>
    </aside>
    <div className="cr-main">
      <header className="cr-topbar" data-scrolled={!compactWorkspace && scrolled || undefined}>
        <div className="cr-topbar-surface">
          <div className="cr-topbar-context">
            <MobileNavigation links={links} path={path} zh={zh} />
            {compactWorkspace && <div className="cr-creation-navigation">
              <Link href="/" aria-label={zh ? "创作首页" : "Home"}><BrandMark size={22} /></Link>
              <button aria-label={zh ? "展开导航" : "Toggle navigation"} aria-expanded={navigationExpanded} onClick={() => setNavigationExpanded(value => !value)}><PanelLeftOpen size={16} /></button>
            </div>}
            {compactWorkspace ? path === "/video" ? <WorkspaceHeaderSlot name="title" /> : <span className="cr-workspace-title" title={creationTitle || undefined}>{creationTitle || (zh ? "PPT 创作" : "Slides")}</span>
              : <Link prefetch="intent" href="/" className="ls-wordmark" aria-label="来塔绘梦"><BrandMark size={26} /><span>来塔绘梦</span></Link>}
            {!compactWorkspace && <nav className="ls-topnav" aria-label={zh ? "主导航" : "Main navigation"}>{links.map(([href, , cn, en]) => {
              const active = path === href || href === "/" && path.startsWith("/explore/");
              return <Link prefetch={active ? false : "intent"} onPrefetch={href === "/studio-v2" ? preloadCanvas : undefined} key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>{zh ? cn : en}</Link>;
            })}</nav>}
          </div>
          <div className="cr-topbar-actions">{path === "/video" ? <WorkspaceHeaderSlot name="actions" /> : <>
            {session?.user && !compactWorkspace && <RecentProjects zh={zh} userId={session.user.id} />}
            {!compactWorkspace && <button type="button" className="ls-icon-button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={zh ? "切换明暗主题" : "Toggle color theme"} title={zh ? "切换明暗主题" : "Toggle color theme"}><SunMoon size={17} strokeWidth={1.8} /></button>}
            {SHOW_LANGUAGE_SWITCHER && <Link prefetch="intent" href={path} locale={zh ? "en" : "zh"} aria-label={zh ? "Switch to English" : "切换中文"}><Globe2 size={15} />{zh ? "EN" : "中文"}</Link>}
            <button className="cr-recharge-trigger" onClick={recharge.open} aria-label={zh ? "积分充值" : "Buy credits"}><CreditIcon /><b>{credits ?? "—"}</b><span className="ls-recharge-label">{zh ? "充值" : "Top up"}</span></button>
          </>}{session?.user ? <UserMenu user={session.user} /> : <Link prefetch="intent" className="cr-top-cta" href="/login">{zh ? "登录 / 注册" : "Sign in"}<ArrowUpRight size={14} /></Link>}</div>
        </div>
      </header>
      {children}
      <footer className="cr-footer">
        <span>来塔绘梦 © {new Date().getFullYear()}</span>
        <span>{zh ? "让想象，一键成真" : "Make imagination visible"}</span>
      </footer>
    </div>
  </div>;
}

export default function CreativeShell({ children }) {
  return <WorkspaceHeaderProvider><CreativeShellContent>{children}</CreativeShellContent></WorkspaceHeaderProvider>;
}
