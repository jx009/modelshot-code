"use client";

import { memo } from "react";
import Image from "@/components/studio/AssetImage";
import { ScanText } from "lucide-react";
import { previewUrl } from "@/lib/studio/image-url";
import { BrandMark } from "@/components/BrandLogo";

const StudioMessage = memo(function StudioMessage({ message, hasOcr, zh, onOpenOcr, onImage }) {
  return <div className={"ms-message " + message.role}>
    {message.role === "assistant" && <span className="ms-speaker"><BrandMark size={17} />来塔绘梦</span>}
    <p>{message.text}</p>
    {hasOcr && <button className="ms-text-button ms-ocr-result-link" onClick={() => onOpenOcr(message.id)}><ScanText size={14} />{zh ? "查看文字" : "View text"}</button>}
    {message.assetId && <button className="ms-message-image" onClick={() => onImage(message.assetId)}>
      <Image unoptimized width={480} height={480} loading="lazy" src={previewUrl(message.assetId, 320)} alt={zh ? "对话引用的图片" : "Image referenced in conversation"} />
    </button>}
  </div>;
});

const StudioMessageList = memo(function StudioMessageList({ messages = [], jobsById, zh, onOpenOcr, onImage }) {
  return messages.map(message => <StudioMessage key={message.id} message={message} hasOcr={jobsById?.has(message.id)} zh={zh} onOpenOcr={onOpenOcr} onImage={onImage} />);
});

export default StudioMessageList;
