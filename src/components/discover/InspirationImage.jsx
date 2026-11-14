"use client";
import Image from "next/image";
import { useState } from "react";
import { inspirationImage } from "@/lib/inspiration/presentation";

// Bypass Next's US image optimizer for COS URLs. A failed/expired URL falls
// back once to the source, so an idle tab or unavailable COS cannot break cards.
export default function InspirationImage({ item, thumbnail = false, src: override, unoptimized = false, alt = item.title, ...props }) {
  const src = override || inspirationImage(item, thumbnail);
  const [failed, setFailed] = useState(null);
  const fallback = override || (item.cover.type === "asset" ? `/api/inspiration/${encodeURIComponent(item.id)}/image?delivery=proxy` : inspirationImage({ ...item, imageUrl: undefined, thumbnailUrl: undefined }));
  const current = failed === src ? fallback : src;
  const [loaded, setLoaded] = useState(null);
  const { onLoad, ...rest } = props;
  return <Image {...rest} alt={alt} src={current} data-loaded={loaded === current || undefined} unoptimized={unoptimized || Boolean(item.imageUrl) || item.cover.type === "asset"}
    onLoad={event => { setLoaded(current); onLoad?.(event); }} onError={() => setFailed(src)} />;
}
