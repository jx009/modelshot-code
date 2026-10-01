"use client";

import { useLocale } from "next-intl";

export default function LocaleLoading() {
  const label = useLocale() === "zh" ? "正在打开…" : "Opening…";
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label={label}>
      <aside className="route-loading-sidebar" aria-hidden="true">
        <span className="route-loading-logo" />
        <span className="route-loading-label" />
        <span className="route-loading-nav active" />
        <span className="route-loading-nav" />
        <span className="route-loading-nav" />
        <span className="route-loading-nav" />
        <span className="route-loading-nav" />
      </aside>
      <main className="route-loading-main" aria-hidden="true">
        <span className="route-loading-topline" />
        <span className="route-loading-heading" />
        <span className="route-loading-copy" />
        <div className="route-loading-grid"><span /><span /><span /></div>
      </main>
      <span className="route-loading-text">{label}</span>
    </div>
  );
}
