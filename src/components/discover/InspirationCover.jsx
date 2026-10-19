"use client";
import InspirationImage from "./InspirationImage";
import { coverAspect } from "@/lib/inspiration/presentation";
import { useEffect, useRef, useState } from "react";

// Intrinsic image sizing preserves uploaded and generated compositions, including
// provider outputs whose dimensions differ from the requested generation size.
export default function InspirationCover({ item, src, unoptimized = false, mode = "masonry", defer = false, className, children, alt = item.title }) {
  const root = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const mounted = !defer || nearViewport;
  useEffect(() => {
    if (!defer || nearViewport) return;
    if (!("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setNearViewport(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px 0px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [defer, nearViewport]);
  const native = mode !== "grid";
  const [width, height] = item.size.split("x").map(Number);
  return <div ref={root} className={className} style={native && mounted ? undefined : { aspectRatio: coverAspect(item, mode) }}>
    {mounted && <InspirationImage item={item} src={src} unoptimized={unoptimized} thumbnail alt={alt} loading={defer ? "eager" : "lazy"} decoding="async" width={native ? width : undefined} height={native ? height : undefined} fill={!native} sizes="(max-width: 650px) 50vw, (max-width: 1200px) 33vw, 25vw" style={native ? { display: "block", width: "100%", height: "auto" } : { objectFit: "contain" }} />}
    {children}
  </div>;
}
