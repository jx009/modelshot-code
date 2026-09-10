"use client";

import clsx from "clsx";
import { LoaderCircle, TriangleAlert } from "lucide-react";

/**
 * 胶片条（Filmstrip）—— 会话产出时间轴
 * 底部横向滚动缩略图：处理中 spinner / 失败警示 / 完成缩略图
 *
 * @param {Array<{id: string, image: string, status: string}>} items
 * @param {string} selectedId - 当前选中（画布正在看的那张）
 * @param {(id: string) => void} onSelect
 * @param {boolean} empty - 无内容
 */
export default function Filmstrip({ items = [], selectedId, onSelect, emptyLabel = "" }) {
  return (
    <div className="h-[88px] flex-shrink-0 border-t border-divider bg-bg-card/40 flex items-center px-4 gap-2.5 overflow-x-auto scrollbar-subtle">
      {items.length === 0 ? (
        <span className="text-xs text-secondary-text/60 px-2">{emptyLabel}</span>
      ) : (
        items.map(item => {
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-pressed={selected}
              className={clsx(
                "relative h-[64px] w-[48px] rounded overflow-hidden border flex-shrink-0 transition-all duration-[120ms] cursor-pointer group",
                selected
                  ? "border-primary ring-1 ring-primary/40"
                  : "border-divider hover:border-divider-strong"
              )}
            >
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="w-full h-full object-cover" />
              ) : item.status === "failed" ? (
                <span className="w-full h-full bg-bg-page flex items-center justify-center">
                  <TriangleAlert size={14} className="text-danger" />
                </span>
              ) : (
                <span className="w-full h-full bg-bg-page flex items-center justify-center">
                  <LoaderCircle size={14} className="text-primary animate-spin" />
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
