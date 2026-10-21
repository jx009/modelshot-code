"use client";

import { useEffect, useRef, useState } from "react";
import { useLinkStatus } from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { Link } from "@/i18n/navigation";
import { useNavigationFeedback } from "./NavigationFeedback";

function Feedback({ onPending, navigationId, finish }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    onPending(pending);
    if (wasPending.current && !pending) finish?.(navigationId.current);
    wasPending.current = pending;
  }, [pending, onPending, finish, navigationId]);
  return null;
}

// Prefetch a full destination on hover/focus, including dynamic pages. `auto`
// alone stops at a loading boundary; prefetching every card floods HTTP/1.
export default function NavigationLink({ children, onNavigate, onClick, onMouseEnter, onFocus, onTouchStart, onPrefetch, prefetch = "intent", prefetchDelay = 1000, ...props }) {
  const auth = useAuth();
  const feedback = useNavigationFeedback();
  const navigationId = useRef(null), destinationHref = useRef(null);
  const [intentHref, setIntentHref] = useState(null);
  const [idleHref, setIdleHref] = useState(null);
  const intentKey = JSON.stringify([props.href, props.locale]);
  const deferred = prefetch === "intent" || prefetch === "idle";
  const fetchMode = deferred ? intentHref === intentKey || idleHref === intentKey : prefetch;
  useEffect(() => {
    if (prefetch !== "idle" || window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === false || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || "")) return;
    let timer, idle;
    const warm = () => {
      if (document.visibilityState !== "visible") return;
      setIdleHref(intentKey);
    };
    // Only the small, fixed module navigation opts into this. Defer full route
    // prefetch until initial resources finish, then stagger routes so images
    // keep priority. The client route cache is short-lived for freshness.
    const schedule = () => { timer = setTimeout(() => {
      if (window.requestIdleCallback) idle = window.requestIdleCallback(warm, { timeout: 2500 });
      else warm();
    }, prefetchDelay); };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => { clearTimeout(timer); if (idle) window.cancelIdleCallback(idle); window.removeEventListener("load", schedule); };
  }, [prefetch, prefetchDelay, intentKey]);
  const [pending, setPending] = useState(false);
  return <Link prefetch={fetchMode} {...props} aria-busy={pending || undefined} onMouseEnter={event => {
    onMouseEnter?.(event);
    if (!event.defaultPrevented && deferred) { setIntentHref(intentKey); onPrefetch?.(); }
  }} onFocus={event => {
    onFocus?.(event);
    if (!event.defaultPrevented && deferred) { setIntentHref(intentKey); onPrefetch?.(); }
  }} onTouchStart={event => {
    onTouchStart?.(event);
    if (!event.defaultPrevented && deferred) { setIntentHref(intentKey); onPrefetch?.(); }
  }} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const destination = new URL(event.currentTarget.href);
    if (auth && destination.origin === window.location.origin && /^\/(?:zh\/|en\/)?login$/.test(destination.pathname)) {
      event.preventDefault();
      auth.open({ callbackUrl: destination.searchParams.get("callbackUrl") || destination.searchParams.get("next"), refCode: destination.searchParams.get("ref") });
      return;
    }
    const target = event.currentTarget.getAttribute("target")?.toLowerCase();
    const clientNavigation = destination.origin === window.location.origin && (!target || target === "_self") && !event.currentTarget.hasAttribute("download");
    if (clientNavigation && event.currentTarget.href === window.location.href && !feedback?.isNavigating()) { event.preventDefault(); return; }
    if (clientNavigation && pending) { event.preventDefault(); return; }
    if (!clientNavigation) return;

    // Start the shell transition in the click handler instead of waiting for
    // Next's `onNavigate`. Dynamic routes still need an RSC round trip, but
    // the user gets an immediate response and can interrupt the transition.
    destinationHref.current = event.currentTarget.href;
    navigationId.current = feedback?.begin(destinationHref.current) ?? null;
  }} onNavigate={event => {
    let cancelled = false;
    onNavigate?.({ preventDefault() { cancelled = true; event.preventDefault(); } });
    if (cancelled) {
      if (navigationId.current) feedback?.finish(navigationId.current);
      navigationId.current = null;
      destinationHref.current = null;
      return;
    }
    // Keep this fallback for programmatic/native activations where the click
    // callback did not run before Next invokes `onNavigate`.
    if (!navigationId.current && destinationHref.current) navigationId.current = feedback?.begin(destinationHref.current) ?? null;
  }}>{children}<Feedback onPending={setPending} navigationId={navigationId} finish={feedback?.finish} /></Link>;
}
