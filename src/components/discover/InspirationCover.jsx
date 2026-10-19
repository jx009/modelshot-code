"use client";
import InspirationImage from "./InspirationImage";
import { coverAspect } from "@/lib/inspiration/gallery";

// Intrinsic image sizing preserves uploaded and generated compositions, including
// provider outputs whose dimensions differ from the requested generation size.
export default function InspirationCover({ item, src, unoptimized = false, mode = "masonry", className, children, alt = item.title }) {
  const native = mode !== "grid";
  const [width, height] = item.size.split("x").map(Number);
  return <div className={className} style={native ? undefined : { aspectRatio: coverAspect(item, mode) }}>
    <InspirationImage item={item} src={src} unoptimized={unoptimized} thumbnail alt={alt} width={native ? width : undefined} height={native ? height : undefined} fill={!native} sizes="(max-width: 650px) 50vw, (max-width: 1200px) 33vw, 25vw" style={native ? { display: "block", width: "100%", height: "auto" } : { objectFit: "contain" }} />
    {children}
  </div>;
}
