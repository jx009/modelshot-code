"use client";

import { useState } from "react";
import { inspirationImage } from "@/lib/inspiration/presentation";
import InspirationImage from "./InspirationImage";

export default function InspirationDetailImage({ item }) {
  const original = inspirationImage(item);
  const preview = inspirationImage(item, true);
  const [loaded, setLoaded] = useState(null);
  const showPreview = preview !== original && loaded !== original;
  const [width, height] = item.size.split("x").map(Number);
  const dimensions = { width, height, sizes: "(max-width: 900px) 100vw, 60vw" };
  return <div className="ig-detail-picture">
    {showPreview && <InspirationImage {...dimensions} item={item} thumbnail alt={item.title} loading="eager" decoding="async" />}
    <InspirationImage {...dimensions} item={item} alt={showPreview ? "" : item.title} aria-hidden={showPreview || undefined} unoptimized loading="eager" decoding="async" fetchPriority="high" onLoad={() => setLoaded(original)} style={showPreview ? { position: "absolute", inset: 0, opacity: 0 } : undefined} />
  </div>;
}
