"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, GripVertical, X } from "lucide-react";
import { useSlideReorder } from "../../useSlideReorder";

const Card = lazy(() => import("./HtmlSlideCard"));
export default function SlideThumbnails({ content, selectedId, onSelect, onMove, onHidden, onClose, loadAssets, readOnly, zh }) {
  const { root, rowProps, handleProps, announcement } = useSlideReorder({ pages: content.pages, onMove, readOnly });
  const [visible, setVisible] = useState(() => new Set([content.pages[0]?.id]));
  const [width, setWidth] = useState(160);
  const ids = content.pages.map(page => page.id).join(",");
  useEffect(() => {
    const host = root.current, item = host?.querySelector('[data-selected="true"]');
    if (!item) return;
    const bounds = host.getBoundingClientRect(), row = item.getBoundingClientRect();
    if (row.top < bounds.top) host.scrollBy({ top: row.top - bounds.top });
    else if (row.bottom > bounds.bottom) host.scrollBy({ top: row.bottom - bounds.bottom });
  }, [selectedId, root]);
  useEffect(() => {
    const host = root.current;
    const measure = () => {
      const style = getComputedStyle(host);
      setWidth(Math.max(1, host.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)));
    };
    const resize = new ResizeObserver(measure); resize.observe(host); measure();
    const nearby = new Set();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) nearby.add(entry.target.dataset.slideId); else nearby.delete(entry.target.dataset.slideId); }
      setVisible(new Set(nearby));
    }, { root: host, rootMargin: "120px" });
    for (const row of host.querySelectorAll("[data-slide-id]")) observer.observe(row);
    return () => { resize.disconnect(); observer.disconnect(); };
  }, [ids, root]);
  const t = (cn, en) => zh ? cn : en;
  return <aside className="cw-deck-thumbnails" aria-label={t("页面缩略图", "Slide thumbnails")}>
    <header><span>{Math.max(1, content.pages.findIndex(page => page.id === selectedId) + 1)} / {content.pages.length}</span><button aria-label={t("收起缩略图", "Hide thumbnails")} onClick={onClose}><X size={14} /></button></header>
    <div className="cw-deck-thumbnail-list" ref={root}>
      <span className="sr-only" role="status">{announcement && t("已移动到第 " + announcement + " 页", "Moved to slide " + announcement)}</span>
      {content.pages.map((page, index) => <div className="cw-deck-thumbnail" key={page.id} {...rowProps(page.id)} data-selected={page.id === selectedId}>
        <button className="cw-deck-thumbnail-select" aria-label={t("跳到第 " + (index + 1) + " 页：" + page.title, "Go to slide " + (index + 1) + ": " + page.title)} aria-current={page.id === selectedId ? "page" : undefined} onClick={() => onSelect(page.id)} style={{ aspectRatio: page.width + "/" + (page.height === "auto" ? 720 : page.height) }}>
          {visible.has(page.id) && <Suspense fallback={<span>{page.title}</span>}><Card page={page} width={Math.max(1, width - 4)} theme={content.theme} master={content.masters?.find(item => item.id === page.masterId)} loadAssets={loadAssets} zh={zh} interactive={false} /></Suspense>}
        </button>
        <button {...handleProps(page.id)} className="cw-deck-thumbnail-number" aria-label={t("拖动排序第 " + (index + 1) + " 页", "Reorder slide " + (index + 1))}><GripVertical size={10} />{index + 1}</button>
        <button className="cw-deck-thumbnail-eye" disabled={readOnly} aria-pressed={page.hidden} aria-label={t(page.hidden ? "恢复演示第 " + (index + 1) + " 页" : "演示隐藏第 " + (index + 1) + " 页", (page.hidden ? "Show slide " : "Hide slide ") + (index + 1))} onClick={() => onHidden(page)}>{page.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>)}
    </div>
  </aside>;
}
