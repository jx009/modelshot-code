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
  const fetchMode = deferred ? intentHref === intentKey ? true : idleHref === intentKey ? "auto" : false : prefetch;
  useEffect(() => {
    if (prefetch !== "idle" || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || "")) return;
    let timer, idle;
    const warm = () => {
      if (document.visibilityState !== "visible") return;
      setIdleHref(intentKey);
    };
    // Only the small, fixed module navigation opts into this. Defer it until
    // initial resources finish, then stagger routes so images keep priority.
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
    if (event.currentTarget.href === window.location.href && !feedback?.isNavigating()) { event.preventDefault(); return; }
    if (pending) { event.preventDefault(); return; }
    destinationHref.current = event.currentTarget.href;
  }} onNavigate={event => {
    let cancelled = false;
    onNavigate?.({ preventDefault() { cancelled = true; event.preventDefault(); } });
    if (!cancelled && destinationHref.current) navigationId.current = feedback?.begin(destinationHref.current);
  }}>{children}<Feedback onPending={setPending} navigationId={navigationId} finish={feedback?.finish} /></Link>;
}
