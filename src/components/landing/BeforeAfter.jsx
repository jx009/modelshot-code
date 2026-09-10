"use client";

import { useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * 前后对比滑块 — 拖动分割线对比平铺图与模特图
 * 纯指针事件实现（约 60 行，无第三方依赖）
 */
export default function BeforeAfter({ beforeSrc, afterSrc, beforeLabel, afterLabel, className }) {
  const [pos, setPos] = useState(50); // 分割线百分比位置
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const t = useTranslations("landing");

  const updateFromClientX = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, pct)));
  }, []);

  const onPointerDown = (e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (dragging.current) updateFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={containerRef}
      className={`relative aspect-[4/3] rounded-[16px] overflow-hidden border border-divider surface-lit select-none touch-none cursor-ew-resize ${className || ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      aria-label={t("demoLabel")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos(p => Math.max(4, p - 5));
        if (e.key === "ArrowRight") setPos(p => Math.min(96, p + 5));
      }}
    >
      {/* 后图（模特图）垫底 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterSrc} alt={afterLabel} className="absolute inset-0 w-full h-full object-cover" draggable={false} />

      {/* 前图（平铺图）按分割线裁切 —— 宽度用容器 100% 撑满避免读取 ref */}
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
        <div className="absolute inset-0" style={{ width: `${10000 / pos}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={beforeSrc}
            alt={beforeLabel}
            className="absolute inset-0 h-full object-cover"
            draggable={false}
          />
        </div>
        <span className="absolute bottom-3 left-3 bg-bg-page/80 backdrop-blur text-[10px] text-secondary-text px-2.5 py-1 rounded-full">
          {beforeLabel}
        </span>
      </div>

      {/* 分割线 + 手柄 */}
      <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-primary" />
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-bg-elevated border border-primary flex items-center justify-center shadow-lg">
          <span className="text-primary text-[10px] tracking-widest">◀▶</span>
        </div>
      </div>

      <span className="absolute bottom-3 right-3 bg-bg-page/80 backdrop-blur text-[10px] text-secondary-text px-2.5 py-1 rounded-full">
        {afterLabel}
      </span>
    </div>
  );
}
