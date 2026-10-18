"use client";
import Image from "next/image";
import { coverAspect } from "@/lib/inspiration/gallery";

// Intrinsic image sizing preserves uploaded and generated compositions, including
// provider outputs whose dimensions differ from the requested generation size.
export default function InspirationCover({ item, src, mode = "masonry", className, children, unoptimized = false, alt = item.title }) {
  const native = mode !== "grid";
  const [width, height] = item.size.split("x").map(Number);
  return <div className={className} style={native ? undefined : { aspectRatio: coverAspect(item, mode) }}>
    <Image src={src} alt={alt} width={native ? width : undefined} height={native ? height : undefined} fill={!native} unoptimized={unoptimized} sizes="(max-width: 650px) 50vw, (max-width: 1200px) 33vw, 25vw" style={native ? { display: "block", width: "100%", height: "auto" } : { objectFit: "contain" }} />
    {children}
  </div>;
}
