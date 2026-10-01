"use client";
import { useLocale } from "next-intl";
export default function CreativeLoading() {
  const label = useLocale() === "zh" ? "正在打开…" : "Opening…";
  return <div className="route-loading creative-loading" role="status" aria-label={label}><main className="route-loading-main" aria-hidden="true"><span className="route-loading-heading" /><span className="route-loading-copy" /><div className="route-loading-grid"><span /><span /><span /></div></main><span className="route-loading-text">{label}</span></div>;
}
