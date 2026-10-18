"use client";
let loading;
export function preloadCanvas() {
  if (typeof window === "undefined") return;
  loading ||= import("@/components/studio/StudioCanvas").catch(() => { loading = null; });
  return loading;
}
