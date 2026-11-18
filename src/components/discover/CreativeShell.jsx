"use client";
import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { preloadCanvas } from "@/lib/studio/preload-canvas";
import CreditIcon from "@/components/ui/CreditIcon";
import { SHOW_LANGUAGE_SWITCHER } from "@/lib/ui-features";
import { useRecharge } from "@/components/billing/RechargeProvider";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { usePathname } from "@/i18n/navigation";
import Link from "@/components/ui/NavigationLink";
import { useLocalNavigation } from "@/components/ui/LocalNavigation";
import { useNavigationPath } from "@/components/ui/NavigationFeedback";
import { House, Images, ImagePlus, Clapperboard, Presentation, ShoppingBag, ArrowUpRight, FolderOpen, Globe2 } from "lucide-react";
import "./discover.css";
import "./creative-direction.css";
import "./parity.css";
import "./atelier.css";
import "./inspiration.css";
import "./brand-navigation.css";
import "./shell.css";
import "./workspace-frame.css";
import UserMenu from "@/components/UserMenu";
import { WorkspaceHeaderProvider, WorkspaceHeaderSlot } from "@/components/creation/WorkspaceHeader";
import BrandLogo, { BrandMark } from "@/components/BrandLogo";
import MobileNavigation from "./MobileNavigation";
import { subscribeWorkspaceTitle, workspaceTitleSnapshot, workspaceTitleServerSnapshot } from "@/lib/creation/client/workspace-title";

const RecentProjects = dynamic(() => import("@/components/studio/RecentProjects"), { ssr: false });
const CreationProjectSwitch = dynamic(() => import("@/components/creation/CreationProjectSwitch"), { ssr: false });

function subscribeScroll(onChange) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}
const isScrolled = () => window.scrollY > 48;
const initialScroll = () => false;

function CreativeShellContent({ children }) {
  const creationTitle = useSyncExternalStore(subscribeWorkspaceTitle, workspaceTitleSnapshot, workspaceTitleServerSnapshot);
  const scrolled = useSyncExternalStore(subscribeScroll, isScrolled, initialScroll);
  const recharge = useRecharge();
  const local = useLocalNavigation(), routePath = usePathname();
  const zh = useLocale() === "zh", path = useNavigationPath("creative", local?.path ?? routePath), { data: session, status } = useSession();
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
  return <div className={`cr-shell ls${compactWorkspace ? " cr-shell-creation" : ""}`} data-workspace={path === "/video" ? "video" : undefined}>
    <div className="cr-main">
      <header className="cr-topbar" data-scrolled={!compactWorkspace && scrolled || undefined}>
        <div className="cr-topbar-surface">
          <div className="cr-topbar-context">
            <MobileNavigation links={links} path={path} zh={zh} />
            {/* 工作台（视频 / PPT）与画布同一套顶栏：品牌 · 分隔线 · 项目标题 */}
            {compactWorkspace && <><Link prefetch="intent" href="/" className="ls-ws-brand" aria-label="来塔绘梦"><BrandLogo /></Link><span className="ls-ws-divider" aria-hidden="true" /></>}
            {compactWorkspace ? path === "/video" ? <WorkspaceHeaderSlot name="title" /> : <><span className="cr-workspace-title ls-ws-title" title={creationTitle || undefined}>{creationTitle || (zh ? "PPT 创作" : "Slides")}</span><CreationProjectSwitch /></>
              : <Link prefetch="intent" href="/" className="ls-wordmark" aria-label="来塔绘梦"><BrandMark size={26} /><span>来塔绘梦</span></Link>}
            {!compactWorkspace && <nav className="ls-topnav" aria-label={zh ? "主导航" : "Main navigation"}>{links.map(([href, , cn, en]) => {
              const active = path === href || href === "/" && path.startsWith("/explore/");
              return <Link prefetch={active ? false : "intent"} onPrefetch={href === "/studio-v2" ? preloadCanvas : undefined} key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}>{zh ? cn : en}</Link>;
            })}</nav>}
          </div>
          <div className="cr-topbar-actions">
            {path === "/video" && <WorkspaceHeaderSlot name="actions" />}
            {path !== "/video" && <>
            {session?.user && !compactWorkspace && <RecentProjects zh={zh} userId={session.user.id} />}
            {SHOW_LANGUAGE_SWITCHER && <Link prefetch="intent" href={path} locale={zh ? "en" : "zh"} aria-label={zh ? "Switch to English" : "切换中文"}><Globe2 size={15} />{zh ? "EN" : "中文"}</Link>}
            </>}
            <button className="cr-recharge-trigger" data-guest={session?.user ? undefined : ""} onClick={recharge.open} aria-label={zh ? "积分充值" : "Buy credits"}><CreditIcon /><b>{credits ?? "—"}</b><span className="ls-recharge-label">{zh ? "充值" : "Top up"}</span></button>
            {/* 会话尚未确认时不显示登录入口（保留占位避免跳动），否则已登录用户每次刷新都会先看到“未登录” */}
            {session?.user ? <UserMenu user={session.user} /> : <Link prefetch="intent" className="cr-top-cta" href="/login" style={status === "loading" ? { visibility: "hidden" } : undefined}>{zh ? "登录 / 注册" : "Sign in"}<ArrowUpRight size={14} /></Link>}</div>
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
