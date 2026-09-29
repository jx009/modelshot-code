"use client";

import { useEffect, useState } from "react";

// A failed root stylesheet otherwise leaves a usable-looking but unstyled page.
// Retry in place: reloading an editor automatically could discard unsaved work.
export default function StylesheetRecovery({ locale }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const pending = new Map();
    const clones = new Set();
    let disposed = false;
    const eligible = link => link instanceof HTMLLinkElement
      && link.rel === "stylesheet" && !link.dataset.styleRetry
      && new URL(link.href).origin === location.origin
      && new URL(link.href).pathname.startsWith("/_next/static/");
    const loaded = link => {
      // Chromium can retain a sheet after a network error whose cssRules throw.
      try { return Boolean(link.sheet?.cssRules); }
      catch { return false; }
    };
    const report = () => {
      if (!disposed) setFailed([...pending.values()].some(item => item.failed));
    };
    const recover = original => {
      if (!eligible(original) || loaded(original) || pending.has(original.href)) return;
      const state = { failed: false, timer: null };
      pending.set(original.href, state);
      const attempt = number => {
        if (disposed || loaded(original)) return;
        const link = document.createElement("link");
        const url = new URL(original.href);
        url.searchParams.set("style-retry", `${Date.now()}-${number}`);
        link.rel = "stylesheet";
        link.href = url.href;
        link.media = original.media;
        link.dataset.styleRetry = "true";
        clones.add(link);
        let settled = false;
        const finish = success => {
          if (settled || disposed) return;
          settled = true;
          clearTimeout(state.timer);
          if (success) { state.failed = false; report(); return; }
          link.remove();
          clones.delete(link);
          if (number < 2) attempt(number + 1);
          else { state.failed = true; report(); }
        };
        link.onload = () => finish(true);
        link.onerror = () => finish(false);
        state.timer = setTimeout(() => finish(false), 12000);
        // Keep the original cascade order, including during client navigation.
        original.before(link);
      };
      attempt(1);
    };
    const onError = event => recover(event.target);
    const scan = () => document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (!loaded(link)) recover(link);
    });
    window.addEventListener("error", onError, true);
    window.addEventListener("load", scan);
    if (document.readyState === "complete") scan();
    return () => {
      disposed = true;
      window.removeEventListener("error", onError, true);
      window.removeEventListener("load", scan);
      pending.forEach(item => clearTimeout(item.timer));
      clones.forEach(link => { link.onload = null; link.onerror = null; });
    };
  }, []);

  if (!failed) return null;
  // Independent of the stylesheet we are recovering; readable in either theme.
  return <div role="alert" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10000, width: "max-content", maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", padding: "12px 16px", borderRadius: 12, background: "Canvas", color: "CanvasText", border: "1px solid GrayText", font: "14px/1.5 system-ui", boxShadow: "0 4px 24px #0003" }}>
    {locale === "zh" ? "页面样式加载失败。请保存当前工作后刷新页面。" : "Page styles could not load. Save your work, then refresh."}
    <button type="button" onClick={() => location.reload()} style={{ marginLeft: 12, padding: "4px 10px", cursor: "pointer", color: "ButtonText", background: "ButtonFace", border: "1px solid GrayText", borderRadius: 6 }}>{locale === "zh" ? "刷新页面" : "Refresh"}</button>
  </div>;
}
