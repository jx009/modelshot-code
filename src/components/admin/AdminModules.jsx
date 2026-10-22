"use client";

import { Component, createContext, lazy, Suspense, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { destinationPath } from "@/lib/navigation-destination";
import NavigationContent from "@/components/ui/NavigationContent";

const modules = {
  "/admin": lazy(() => import("../../app/[locale]/admin/page.js")),
  "/admin/users": lazy(() => import("../../app/[locale]/admin/users/page.js")),
  "/admin/operations": lazy(() => import("../../app/[locale]/admin/operations/page.js")),
  "/admin/providers": lazy(() => import("../../app/[locale]/admin/providers/page.js")),
  "/admin/resolution-pricing": lazy(() => import("../../app/[locale]/admin/resolution-pricing/page.js")),
  "/admin/storage": lazy(() => import("../../app/[locale]/admin/storage/page.js")),
  "/admin/studio-tools": lazy(() => import("../../app/[locale]/admin/studio-tools/page.js")),
};
const ModuleContext = createContext(null);
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
  const navigate = useCallback(event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const anchor = event.currentTarget;
    const target = new URL(anchor.href);
    if (target.origin !== window.location.origin || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || !modules[destinationPath(target.href)]) return;
    if (target.pathname.split("/")[1] !== window.location.pathname.split("/")[1]) return;
    event.preventDefault();
    if (target.href !== window.location.href) {
      window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
      window.dispatchEvent(new Event(historyEvent));
      const content = anchor.closest("[data-admin-shell]")?.querySelector("[data-admin-content]");
      if (content) content.scrollTop = 0;
    }
  }, []);
  const value = useMemo(() => ({ path, navigate, supports: href => Boolean(modules[destinationPath(href)]) }), [path, navigate]);
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
  const context = useAdminModules();
  const locale = useLocale(), zh = locale === "zh";
  const ActiveModule = modules[context?.path];
  if (!ActiveModule) return <NavigationContent section="admin">{children}</NavigationContent>;
  return <ModuleError key={context.path} zh={zh} href={`/${locale}${context.path}`}><Suspense fallback={<section role="status" aria-live="polite"><p>{zh ? "正在打开模块…" : "Opening module…"}</p></section>}><ActiveModule /></Suspense></ModuleError>;
}
