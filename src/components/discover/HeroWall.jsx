"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { WALL_COLUMNS, WALL_FIRST_PAINT, sceneImage } from "./hero-wall";

// 首屏作品墙（32 张）：先只加载每列可见的前两张，页面空闲后再补齐其余作品并开始滚动。
// 首屏只发 8 个图片请求，不和标题、输入框抢带宽。用 next/image 以保留部署版本参数（?dpl=），
// 香港 Nginx 据此命中对应发布目录。
function useWallReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let idle = 0, timer = 0;
    const start = () => {
      idle = window.requestIdleCallback ? window.requestIdleCallback(() => setReady(true), { timeout: 4000 }) : 0;
      if (!window.requestIdleCallback) timer = window.setTimeout(() => setReady(true), 1200);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      if (idle) window.cancelIdleCallback?.(idle);
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

export default function HeroWall() {
  const ready = useWallReady();
  return <div className="lh-wall" data-ready={ready || undefined} aria-hidden="true">
    {WALL_COLUMNS.map((tiles, column) => {
      // 两份副本配合 -50% 的位移形成无缝循环；副本复用同一 URL，不增加请求。
      const shown = ready ? [...tiles, ...tiles] : tiles.slice(0, WALL_FIRST_PAINT);
      return <div className="lh-wall-col" key={column} style={{ "--lh-speed": `${[78, 104, 88, 118][column % 4]}s`, "--lh-dir": column % 2 ? "reverse" : "normal" }}>
        {shown.map((tile, index) => <Image unoptimized key={`${tile[0]}-${index}`} src={sceneImage(tile[0])} alt="" width={tile[1]} height={tile[2]}
          loading={index < WALL_FIRST_PAINT ? "eager" : "lazy"} decoding="async" fetchPriority={ready ? "low" : "auto"} className="lh-wall-img" />)}
      </div>;
    })}
  </div>;
}
