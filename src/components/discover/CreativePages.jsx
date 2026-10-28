"use client";

import { Activity, Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { destinationPath } from "@/lib/navigation-destination";
import { deferNavigation } from "@/lib/navigation-guard";
import { readCachedInspiration } from "@/lib/inspiration/client-cache";
import { LOCAL_NAVIGATION_EVENT, LocalNavigationContext, PageVisibilityContext, useLocalNavigation } from "@/components/ui/LocalNavigation";
import NavigationContent from "@/components/ui/NavigationContent";
import CreativeShell from "./CreativeShell";
import DiscoverHome from "./DiscoverHome";
import InspirationDetailImage from "./InspirationDetailImage";

const loadInspirationDetail = () => import("./InspirationDetail");
const InspirationDetail = lazy(loadInspirationDetail);
function cachedInspiration(href) {
  const match = destinationPath(href).match(/^\/explore\/([a-zA-Z0-9_-]{1,80})$/);
  return match ? readCachedInspiration(match[1]) : null;
}

const loaders = {
  "/explore": () => import("./ExplorePage"),
  "/projects": () => import("./CreativeProjects"),
  "/assets": () => import("@/components/studio/AssetLibrary"),
  "/commerce": () => import("./CommercePage"),
  "/studio-v2": () => import("@/components/studio/StudioPage"),
  "/creation": () => import("@/components/creation/CreationPage"),
  "/video": () => import("@/components/video/VideoWorkspace"),
};
const pages = { "/": DiscoverHome, ...Object.fromEntries(Object.entries(loaders).map(([path, load]) => [path, lazy(load)])) };
const retained = new Set(["/", "/explore", "/projects", "/assets"]);
const historyEvent = LOCAL_NAVIGATION_EVENT;
const snapshot = () => destinationPath(window.location.pathname);
function subscribe(callback) {
  window.addEventListener(historyEvent, callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener(historyEvent, callback); window.removeEventListener("popstate", callback); };
}

export default function CreativePages({ children }) {
  const pathname = usePathname(), locale = useLocale();
  const path = useSyncExternalStore(subscribe, snapshot, () => destinationPath(pathname));
  useEffect(() => { window.dispatchEvent(new Event(historyEvent)); }, [pathname]);
  const [entry, setEntry] = useState(0);
  const [details, setDetails] = useState({});
  const [visited, setVisited] = useState(() => retained.has(path) ? [path] : []);
  const supports = useCallback((href, targetLocale) => {
    if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || targetLocale && targetLocale !== locale) return false;
    const url = new URL(href, "https://navigation.local");
    const prefix = url.pathname.match(/^\/(zh|en)(?=\/|$)/)?.[1];
    return (!prefix || prefix === locale) && (Object.hasOwn(pages, destinationPath(href)) || Boolean(cachedInspiration(href)));
  }, [locale]);
  const visit = useCallback(function visit(href, { replace = false, scroll = true, locale: targetLocale } = {}) {
    if (!supports(href, targetLocale)) return false;
    const target = new URL(href, window.location.origin);
    if (!/^\/(zh|en)(?=\/|$)/.test(target.pathname)) target.pathname = `/${locale}${target.pathname === "/" ? "" : target.pathname}`;
    if (target.href === window.location.href) return true;
    if (deferNavigation(() => visit(href, { replace, scroll, locale: targetLocale }))) return true;
    const item = cachedInspiration(target.href);
    if (item) setDetails(current => ({ ...current, [destinationPath(target.href)]: item }));
    const source = new URL(window.location.href);
    const samePage = destinationPath(target.href) === destinationPath(window.location.href);
    const sameEntry = samePage && target.search === source.search;
    window.history[replace ? "replaceState" : "pushState"](null, "", `${target.pathname}${target.search}${target.hash}`);
    if (!sameEntry && (!replace || !samePage)) setEntry(current => current + 1);
    if (retained.has(destinationPath(target.href))) setVisited(current => current.includes(destinationPath(target.href)) ? current : [...current, destinationPath(target.href)]);
    window.dispatchEvent(new Event(historyEvent));
    if (scroll && target.hash) {
      try { document.getElementById(decodeURIComponent(target.hash.slice(1)))?.scrollIntoView(); } catch {}
    } else if (scroll && (!replace || !samePage)) window.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }, [locale, supports]);
  useEffect(() => {
    const pop = () => {
      const currentPath = destinationPath(window.location.pathname);
      if (currentPath === "/commerce") setEntry(current => current + 1);
      if (retained.has(currentPath)) setVisited(current => current.includes(currentPath) ? current : [...current, currentPath]);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback(event => {
    const anchor = event.currentTarget, target = new URL(anchor.href);
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || target.origin !== window.location.origin || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self" || !supports(target.pathname)) return false;
    event.preventDefault();
    visit(`${target.pathname}${target.search}${target.hash}`);
    return true;
  }, [supports, visit]);
  const preload = useCallback(href => {
    if (!supports(href)) return;
    const load = loaders[destinationPath(href)] || (cachedInspiration(href) ? loadInspirationDetail : null);
    if (load) void load().catch(() => {});
  }, [supports]);
  const value = useMemo(() => ({ path, entry, visited, details, supports, navigate, visit, preload }), [path, entry, visited, details, supports, navigate, visit, preload]);
  return <LocalNavigationContext.Provider value={value}>{children}</LocalNavigationContext.Provider>;
}

class PageError extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <a href={this.props.href} role="alert">{this.props.zh ? "页面加载失败，点击重新打开" : "Page failed to load. Reopen this page."}</a> : this.props.children;
  }
}

function RetainedPages({ children }) {
  const { path, entry, visited, details } = useLocalNavigation(), locale = useLocale();
  const detail = details[path];
  const supported = Object.hasOwn(pages, path);
  const standalone = path === "/studio-v2";
  const ActivePage = supported && !retained.has(path) ? pages[path] : null;
  const active = supported && !retained.has(path) && <PageError key={`${path}:${entry}`} href={`/${locale}${path}`} zh={locale === "zh"}>
    <Suspense fallback={<p role="status">{locale === "zh" ? "正在打开模块…" : "Opening module…"}</p>}><ActivePage /></Suspense>
  </PageError>;
  return <><Activity mode={standalone ? "hidden" : "visible"}><CreativeShell>
    {visited.map(route => {
      const Page = pages[route], visible = route === path;
      return <Activity key={route} mode={visible ? "visible" : "hidden"}>
        <PageVisibilityContext.Provider value={visible}>
          <PageError href={`/${locale}${route === "/" ? "" : route}`} zh={locale === "zh"}>
            <Suspense fallback={<p role="status">{locale === "zh" ? "正在打开页面…" : "Opening page…"}</p>}><Page /></Suspense>
          </PageError>
        </PageVisibilityContext.Provider>
      </Activity>;
    })}
    {!standalone && active}
    {detail ? <PageError key={path} href={`/${locale}${path}`} zh={locale === "zh"}>
      <Suspense fallback={<article className="ig-detail"><h1>{locale === "zh" ? detail.title : detail.titleEn || detail.title}</h1><div className="ig-full-image"><InspirationDetailImage item={detail} /></div></article>}>
        <InspirationDetail item={detail} />
      </Suspense>
    </PageError> : !supported && children}
  </CreativeShell></Activity>{standalone && active}</>;
}

export function CreativePageContent({ children }) {
  const { data: session } = useSession(), locale = useLocale();
  return <NavigationContent section="creative"><RetainedPages key={`${locale}:${session?.user?.id || "guest"}`}>{children}</RetainedPages></NavigationContent>;
}
