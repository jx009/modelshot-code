"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLinkStatus } from "next/link";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

function Feedback({ onPending }) {
  const { pending } = useLinkStatus();
  const zh = useLocale() === "zh";
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    onPending(pending);
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => { clearTimeout(timer); setSlow(false); };
  }, [pending, onPending]);
  if (!pending) return null;
  return createPortal(<span className="navigation-progress" role="status">{slow ? zh ? "连接较慢，再次点击可直接打开" : "Slow connection. Click again to open directly." : zh ? "正在打开…" : "Opening…"}</span>, document.body);
}

// Prefetch a full destination on hover/focus, including dynamic pages. `auto`
// alone stops at a loading boundary; prefetching every card floods HTTP/1.
export default function NavigationLink({ children, onNavigate, onClick, onMouseEnter, onFocus, prefetch = "intent", ...props }) {
  const started = useRef(0);
  const [intentHref, setIntentHref] = useState(null);
  const intentKey = JSON.stringify([props.href, props.locale]);
  const fetchMode = prefetch === "intent" ? intentHref === intentKey ? true : false : prefetch;
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!pending) started.current = 0; }, [pending]);
  return <Link prefetch={fetchMode} {...props} onMouseEnter={event => {
    onMouseEnter?.(event);
    if (!event.defaultPrevented && prefetch === "intent") setIntentHref(intentKey);
  }} onFocus={event => {
    onFocus?.(event);
    if (!event.defaultPrevented && prefetch === "intent") setIntentHref(intentKey);
  }} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (event.currentTarget.href === window.location.href) { event.preventDefault(); return; }
    if (pending && Date.now() - started.current >= 8000) {
      event.preventDefault();
      window.location.assign(event.currentTarget.href);
    }
  }} onNavigate={event => {
    if (started.current) { event.preventDefault(); return; }
    onNavigate?.(event);
    if (!event.defaultPrevented) started.current = Date.now();
  }}>{children}<Feedback onPending={setPending} /></Link>;
}
