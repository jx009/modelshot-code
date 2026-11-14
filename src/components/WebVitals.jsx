"use client";
import { useReportWebVitals } from "next/web-vitals";

// 只上报核心指标，抽样 30%，用 sendBeacon 不阻塞页面卸载。
const METRICS = new Set(["TTFB", "FCP", "LCP", "INP", "CLS"]);
const SAMPLED = typeof window !== "undefined" && Math.random() < 0.3;

function report(metric) {
  if (!SAMPLED || !METRICS.has(metric.name)) return;
  const body = JSON.stringify({
    name: metric.name, value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
    rating: metric.rating, path: window.location.pathname.replace(/^\/(zh|en)(?=\/|$)/, "") || "/",
    nav: metric.navigationType,
  });
  if (!navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }))) {
    void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  }
}

export default function WebVitals() {
  useReportWebVitals(report);
  return null;
}
