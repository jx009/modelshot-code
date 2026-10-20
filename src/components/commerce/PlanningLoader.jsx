"use client";
import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Image from "@/components/studio/AssetImage";
import { previewUrl } from "@/lib/studio/image-url";
import "./planning-loader.css";

export default function PlanningLoader({ product, assetId, startedAt, zh, onClose }) {
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <Modal label={zh ? "正在策划套图" : "Planning your collection"} className="ca-planning-dialog" onClose={onClose}>
    <header><span><Sparkles size={14} />{zh ? "专属视觉方案" : "YOUR VISUAL DIRECTION"}</span><button onClick={onClose} aria-label={zh ? "收起策划进度" : "Minimize planning progress"}><X size={18} /></button></header>
    <div className="ca-planning-art" aria-hidden="true">
      <div className="ca-planning-sheet ca-planning-sheet-left"><div /><i /><i /></div>
      <div className="ca-planning-sheet ca-planning-sheet-right"><div /><i /><i /></div>
      <div className="ca-planning-product">
        {assetId && <Image unoptimized src={previewUrl(assetId, 640)} width={156} height={176} alt="" />}
        <span>{product}</span>
        <div className="ca-planning-sweep" />
      </div>
      <span className="ca-planning-spark"><Sparkles size={20} /></span>
    </div>
    <div className="ca-planning-copy" role="status" aria-live="polite">
      <h2>{zh ? "好想法，正在成形" : "Your ideas are taking shape"}<span className="ca-planning-dots" aria-hidden="true"><i /><i /><i /></span></h2>
      <p>{zh ? "结合商品与创作要求，构思整套图片的风格和内容。" : "Bringing your product and brief together into a cohesive visual plan."}</p>
      {seconds >= 30 && <p className="ca-planning-patience">{zh ? "这次构思需要多一点时间，请稍候，无需重复提交。" : "This plan needs a little more time. Please wait without submitting again."}</p>}
    </div>
    <div className="ca-planning-line" aria-hidden="true"><span /></div>
    <footer><span>{zh ? `已等待 ${seconds} 秒` : `Waiting ${seconds}s`}</span><button onClick={onClose}>{zh ? "收起，继续等待" : "Minimize and keep waiting"}</button></footer>
  </Modal>;
}
