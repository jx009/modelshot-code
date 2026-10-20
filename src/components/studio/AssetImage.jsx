"use client";

import Image from "next/image";
import { useState } from "react";
import { assetImageRequest, forgetAssetDelivery, isAssetImage, resolveAssetImage } from "@/lib/studio/asset-delivery";

export default function AssetImage({ src, alt, onError, ...props }) {
  const [failed, setFailed] = useState(null);
  const privateImage = isAssetImage(src);
  const fallback = failed === src;
  const current = privateImage ? fallback ? assetImageRequest(src, "proxy") : resolveAssetImage(src) : src;
  return <Image {...props} alt={alt} src={current} unoptimized={privateImage || props.unoptimized}
    crossOrigin={privateImage ? "anonymous" : props.crossOrigin} referrerPolicy={privateImage ? "no-referrer" : props.referrerPolicy}
    onError={event => {
      if (privateImage && !fallback) { forgetAssetDelivery(src); setFailed(src); }
      else onError?.(event);
    }} />;
}
