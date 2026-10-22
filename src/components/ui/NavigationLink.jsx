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
export default function NavigationLink({ children, onNavigate, onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onTouchStart, onTouchEnd, onTouchCancel, onPrefetch, prefetch = "intent", prefetchDelay = 150, ...props }) {
  const auth = useAuth();
  const feedback = useNavigationFeedback();
  const navigationId = useRef(null), destinationHref = useRef(null);
  const [intentHref, setIntentHref] = useState(null);
  const intentTimer = useRef(null);
  const intentKey = JSON.stringify([props.href, props.locale]);
  const deferred = prefetch === "intent" || prefetch === "idle";
  const fetchMode = deferred ? intentHref === intentKey : prefetch;
  const cancelIntent = () => {
    clearTimeout(intentTimer.current);
    intentTimer.current = null;
  };
  const prepare = event => {
    if (!deferred || event.defaultPrevented || intentHref === intentKey || intentTimer.current || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || "")) return;
    const target = event.currentTarget;
    const destination = new URL(target.href);
    if (destination.origin !== window.location.origin || target.hasAttribute("download") || (target.target && target.target !== "_self") || target.getAttribute("aria-current") === "page" || destination.href === window.location.href) return;
    intentTimer.current = setTimeout(() => {
      intentTimer.current = null;
      if (!target.isConnected || document.visibilityState === "hidden" || window.getComputedStyle(target).visibility === "hidden" || !target.getClientRects().length) return;
      setIntentHref(intentKey);
      onPrefetch?.();
    }, prefetchDelay);
  };
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(intentTimer.current);
        intentTimer.current = null;
        setIntentHref(null);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => { clearTimeout(intentTimer.current); intentTimer.current = null; document.removeEventListener("visibilitychange", hide); };
  }, [intentKey, prefetch]);
  const [pending, setPending] = useState(false);
  return <Link prefetch={fetchMode} {...props} aria-busy={pending || undefined} onMouseEnter={event => {
    onMouseEnter?.(event);
    prepare(event);
  }} onMouseLeave={event => {
    onMouseLeave?.(event);
    cancelIntent();
    if (deferred) setIntentHref(null);
  }} onFocus={event => {
    onFocus?.(event);
    if (event.currentTarget.matches(":focus-visible")) prepare(event);
  }} onBlur={event => {
    onBlur?.(event);
    cancelIntent();
    if (deferred) setIntentHref(null);
  }} onTouchStart={event => {
    onTouchStart?.(event);
    prepare(event);
  }} onTouchEnd={event => {
    onTouchEnd?.(event);
    cancelIntent();
  }} onTouchCancel={event => {
    onTouchCancel?.(event);
    cancelIntent();
    if (deferred) setIntentHref(null);
  }} onClick={event => {
    cancelIntent();
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
