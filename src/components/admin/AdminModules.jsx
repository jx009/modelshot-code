"use client";

import { Activity, Component, createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { destinationPath } from "@/lib/navigation-destination";
import NavigationContent from "@/components/ui/NavigationContent";
import { PageVisibilityContext } from "@/components/ui/LocalNavigation";
import BrandLoader from "@/components/ui/BrandLoader";

const modules = {
  "/admin": lazy(() => import("../../app/[locale]/admin/page.js")),
  "/admin/users": lazy(() => import("../../app/[locale]/admin/users/page.js")),
  "/admin/operations": lazy(() => import("../../app/[locale]/admin/operations/page.js")),
  "/admin/providers": lazy(() => import("../../app/[locale]/admin/providers/page.js")),
  "/admin/resolution-pricing": lazy(() => import("../../app/[locale]/admin/resolution-pricing/page.js")),
  "/admin/storage": lazy(() => import("../../app/[locale]/admin/storage/page.js")),
  "/admin/studio-tools": lazy(() => import("../../app/[locale]/admin/studio-tools/page.js")),
  "/admin/music": lazy(() => import("../../app/[locale]/admin/music/page.js")),
  "/admin/tryons": lazy(() => import("../../app/[locale]/admin/tryons/page.js")),
  "/admin/inspiration": lazy(() => import("../../app/[locale]/admin/inspiration/page.js")),
  "/admin/orders": lazy(() => import("../../app/[locale]/admin/orders/page.js")),
  "/admin/billing": lazy(() => import("../../app/[locale]/admin/billing/page.js")),
  "/admin/cost": lazy(() => import("../../app/[locale]/admin/cost/page.js")),
  "/admin/commissions": lazy(() => import("../../app/[locale]/admin/commissions/page.js")),
  "/admin/settings": lazy(() => import("../../app/[locale]/admin/settings/page.js")),
  "/admin/announcements": lazy(() => import("../../app/[locale]/admin/announcements/page.js")),
  "/admin/models": lazy(() => import("../../app/[locale]/admin/models/page.js")),
  "/admin/presets": lazy(() => import("../../app/[locale]/admin/presets/page.js")),
  "/admin/prompts": lazy(() => import("../../app/[locale]/admin/prompts/page.js")),
};
const ModuleContext = createContext(null);
const retained = new Set(["/admin", "/admin/users", "/admin/operations", "/admin/orders", "/admin/tryons", "/admin/commissions"]);
const historyEvent = "modelshot:admin-module";
const currentPath = () => destinationPath(window.location.pathname);
function subscribeHistory(callback) {
  window.addEventListener(historyEvent, callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener(historyEvent, callback); window.removeEventListener("popstate", callback); };
}

export const useAdminModules = () => useContext(ModuleContext);

export default function AdminModules({ children }) {
  const pathname = usePathname();
  const path = useSyncExternalStore(subscribeHistory, currentPath, () => destinationPath(pathname));
  const [visited, setVisited] = useState(() => retained.has(path) ? [path] : []);
  useEffect(() => {
    const onPopState = () => {
      const current = currentPath();
      if (retained.has(current)) setVisited(previous => previous.includes(current) ? previous : [...previous, current]);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useCallback(event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const anchor = event.currentTarget;
    const target = new URL(anchor.href);
    if (target.origin !== window.location.origin || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || !modules[destinationPath(target.href)]) return;
    if (target.pathname.split("/")[1] !== window.location.pathname.split("/")[1]) return;
    event.preventDefault();
    if (target.href !== window.location.href) {
      window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
      const nextPath = destinationPath(target.href);
      if (retained.has(nextPath)) setVisited(previous => previous.includes(nextPath) ? previous : [...previous, nextPath]);
      window.dispatchEvent(new Event(historyEvent));
      const content = anchor.closest("[data-admin-shell]")?.querySelector("[data-admin-content]");
      if (content) content.scrollTop = 0;
    }
  }, []);
  const value = useMemo(() => ({ path, visited, navigate, supports: href => Boolean(modules[destinationPath(href)]) }), [path, visited, navigate]);
  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

class ModuleError extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert"><p>{this.props.zh ? "模块加载失败。" : "Could not load this module."}</p><a href={this.props.href}>{this.props.zh ? "重新打开此模块" : "Reopen this module"}</a></div>;
    return this.props.children;
  }
}

export function AdminModuleContent({ children }) {
  const { data: session } = useSession(), locale = useLocale();
  return <ModulePages key={`${locale}:${session?.user?.id || "guest"}:${session?.user?.role || ""}`}>{children}</ModulePages>;
}

function ModulePages({ children }) {
  const context = useAdminModules();
  const locale = useLocale(), zh = locale === "zh";
  const ActiveModule = modules[context?.path];
  const path = context?.path;
  const visited = context?.visited || [];
  const renderModule = (route, Module) => <ModuleError key={route} zh={zh} href={`/${locale}${route}`}><Suspense fallback={<BrandLoader label={zh ? "正在打开模块" : "Opening module"} />}><Module /></Suspense></ModuleError>;
  return <>
    {visited.map(route => <Activity key={route} mode={path === route ? "visible" : "hidden"}><PageVisibilityContext.Provider value={path === route}>{renderModule(route, modules[route])}</PageVisibilityContext.Provider></Activity>)}
    {ActiveModule && !retained.has(path) && renderModule(path, ActiveModule)}
    {!ActiveModule && <NavigationContent section="admin">{children}</NavigationContent>}
  </>;
}
