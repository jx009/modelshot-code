"use client";

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState } from "react";
import { GripVertical, Pencil, EyeOff } from "lucide-react";
import { useSlideReorder } from "../../useSlideReorder";
import { createSlidePreviewAssets } from "@/lib/creation/client/slide-preview-assets";
import "./html-viewer.css";

const Card = lazy(() => import("./HtmlSlideCard"));
export default function HtmlSlideViewer({ content, controllerRef, onOperations, onError, onEdit, onPage, initialPageId, readOnly, zh }) {
  const [assets] = useState(createSlidePreviewAssets);
  useEffect(() => () => assets.clear(), [assets]);
  const move = (pageId, index) => { try { return onOperations([{ op: "reorderHtmlPage", pageId, index }]); } catch (error) { onError?.(error); return false; } };
  const { root, rowProps, handleProps, announcement, isDragging } = useSlideReorder({ pages: content.pages, readOnly, onMove: move });
  const [visible, setVisible] = useState(() => new Set([initialPageId || content.pages[0]?.id]));
  const [heights, setHeights] = useState({});
  const measured = useCallback((id, height) => setHeights(current => current[id] === height ? current : { ...current, [id]: height }), []);
  const [width, setWidth] = useState(0), initial = useRef(initialPageId), onPageRef = useRef(onPage);
  useEffect(() => { onPageRef.current = onPage; }, [onPage]);
  useImperativeHandle(controllerRef, () => ({ commitPending() {}, getPendingText: () => null, canRefreshRemote: () => !isDragging() }));
  const ids = content.pages.map(page => page.id).join(",");
  useEffect(() => {
    const host = root.current;
    const measure = () => { const style = getComputedStyle(host); setWidth(Math.max(1, host.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0))); };
    const observer = new ResizeObserver(measure); observer.observe(host); measure();
    return () => observer.disconnect();
  }, [root]);
  useLayoutEffect(() => {
    if (!width || !initial.current) return;
    const host = root.current, slide = host.querySelector('[data-slide-id="' + CSS.escape(initial.current) + '"]');
    if (slide) host.scrollTo({ top: host.scrollTop + slide.getBoundingClientRect().top - host.getBoundingClientRect().top });
    initial.current = null;
  }, [root, width]);
  useEffect(() => {
    const host = root.current, near = new Set(), ratios = new Map();
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const id = entry.target.dataset.slideId; if (entry.isIntersecting) near.add(id); else near.delete(id); }
      setVisible(new Set(near));
    }, { root: host, rootMargin: "400px 0px" });
    const active = new IntersectionObserver(entries => {
      for (const entry of entries) ratios.set(entry.target.dataset.slideId, entry.intersectionRatio);
      const best = [...ratios].sort((a, b) => b[1] - a[1])[0];
      if (best?.[1] > 0) onPageRef.current?.(best[0]);
    }, { root: host, threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const element of host.querySelectorAll("[data-slide-id]")) { observer.observe(element); active.observe(element); }
    return () => { observer.disconnect(); active.disconnect(); };
  }, [root, ids]);
  const edit = useCallback(id => onEdit(id), [onEdit]);
  return <div ref={root} className="cw-slide-document" aria-label={zh ? "演示文稿连续浏览" : "Continuous slide viewer"}>
    <span className="sr-only" role="status">{announcement && (zh ? "页面已移动到第 " : "Slide moved to position ") + announcement}</span>
    {content.pages.map((page, index) => <article key={page.id} {...rowProps(page.id)} className="cw-slide-paper" aria-label={(zh ? "第 " : "Slide ") + (index + 1)}>
      <header><button {...handleProps(page.id)} className="cw-slide-grip" aria-label={(zh ? "拖动排序第 " : "Reorder slide ") + (index + 1)} title={zh ? "拖动调整顺序；Alt + 上下方向键移动" : "Drag to reorder; Alt + Up/Down"}><GripVertical size={14} /><span>{index + 1}</span></button><span className="cw-slide-title">{page.title}</span>{page.hidden && <EyeOff size={14} />}<button onClick={() => edit(page.id)}><Pencil size={13} />{zh ? "编辑此页" : "Edit slide"}</button></header>
      <div className="cw-slide-paper-content" style={{ aspectRatio: page.width + "/" + (page.height === "auto" ? heights[page.id] || 720 : page.height) }} onDoubleClick={() => edit(page.id)}>
        {visible.has(page.id) && width > 0 ? <Suspense fallback={<div className="cw-slide-skeleton">{page.title}</div>}><Card page={page} theme={content.theme} master={content.masters?.find(item => item.id === page.masterId)} width={width} measuredHeight={heights[page.id]} onHeight={measured} zh={zh} loadAssets={assets.read} /></Suspense> : <div className="cw-slide-skeleton">{page.title}</div>}
      </div>
    </article>)}
    <footer>{zh ? "已显示 " : "Showing "}{content.pages.length}{zh ? " 页" : " slides"}{content.metadata?.plannedPages > content.pages.length ? (zh ? " · 后续页面生成后会自动出现" : " · New slides appear as they are saved") : ""}</footer>
  </div>;
}
