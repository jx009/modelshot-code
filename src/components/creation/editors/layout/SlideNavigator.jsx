"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, RefreshCw, GripVertical } from "lucide-react";
import { useSlideReorder } from "../../useSlideReorder";
import { createThumbnailQueue } from "@/lib/creation/client/thumbnail-queue";

const Thumbnail = memo(function Thumbnail({ page, read, zh }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let url;
    // Debounce typing/drag completion. Only the changed page is enqueued.
    const timer = setTimeout(async () => {
      setError(false);
      try {
        const result = await read(page, abort.signal);
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(result.blob); setPreview({ page, url, missingImages: result.missingImages });
      } catch { if (!abort.signal.aborted) setError(true); }
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [page, read]);
  const current = preview?.page === page ? preview : null;
  return <>{current ? <>
    {/* Local derived object URLs only; no Next optimizer or remote image fetch. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={current.url} alt="" draggable={false} />
    {current.missingImages && <small>{zh ? "部分图片未加载" : "Some images unavailable"}</small>}
  </> : <span className="cw-thumbnail-placeholder">{page.title}</span>}
  {error && <small>{zh ? "预览未加载，请刷新" : "Preview unavailable; refresh"}</small>}</>;
});

const Slide = memo(function Slide({ page, index, selected, visible, read, onSelect, zh, revision }) {
  return <button type="button" className={`cw-slide-item${selected ? " is-selected" : ""}`}
    aria-current={selected ? "page" : undefined} aria-label={`${index + 1}. ${page.title}${page.hidden ? zh ? "（演示时隐藏）" : " (hidden in presentation)" : ""}`}
    title={page.title} onClick={() => onSelect(page.id)}>
    <span>{index + 1}{page.hidden && <EyeOff size={11} />}</span>
    <div className="cw-slide-thumbnail" style={{ background: page.background }}>
      {visible ? <Thumbnail key={revision} page={page} read={read} zh={zh} /> : <span className="cw-thumbnail-placeholder">{page.title}</span>}
    </div>
  </button>;
});

export default function SlideNavigator({ pages, selectedId, onSelect, onMove, readOnly, zh, children }) {
  const { root, rowProps, handleProps, announcement } = useSlideReorder({ pages, readOnly: readOnly || !onMove, onMove });
  const queue = useRef(null);
  const [visible, setVisible] = useState(() => new Set()), [foreground, setForeground] = useState(true);
  const [revision, setRevision] = useState(0);
  const read = useCallback((page, signal) => queue.current
    ? queue.current.read(page, signal) : Promise.reject(new Error("THUMBNAIL_NOT_READY")), []);
  useEffect(() => {
    const value = createThumbnailQueue(async (page, signal) => {
      const { renderPageThumbnail } = await import("./thumbnail-renderer");
      signal.throwIfAborted(); return renderPageThumbnail(page, signal);
    });
    queue.current = value;
    const visibility = () => setForeground(document.visibilityState !== "hidden");
    visibility(); document.addEventListener("visibilitychange", visibility);
    return () => { value.dispose(); queue.current = null; document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const ids = pages.map(page => page.id).join(",");
  useEffect(() => {
    if (!foreground) return;
    const intersecting = new Set(); let frame;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target.dataset.slideId);
        else intersecting.delete(entry.target.dataset.slideId);
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVisible(new Set(intersecting)));
    }, { root: root.current, rootMargin: "100px" });
    for (const element of root.current.querySelectorAll("[data-slide-id]")) observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ids, foreground, root]);
  useEffect(() => {
    root.current?.querySelector(`[data-slide-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, ids, root]);
  return <aside className="cw-slide-list" ref={root} aria-label={zh ? "幻灯片页面" : "Slides"}>
    <span className="sr-only" role="status">{announcement && (zh ? "已移动到第 " : "Moved to slide ") + announcement}</span>
    {pages.map((page, index) => <div className="cw-layout-slide-row" key={page.id} {...rowProps(page.id)}><button className="cw-page-handle" {...handleProps(page.id)} aria-label={(zh ? "拖动排序第 " : "Reorder slide ") + (index + 1)}><GripVertical size={13} /></button><Slide page={page} index={index} selected={page.id === selectedId}
      visible={foreground && visible.has(page.id)} read={read} onSelect={onSelect} zh={zh} revision={revision} /></div>)}
    <button onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />{zh ? "刷新预览" : "Refresh previews"}</button>
    {children}
  </aside>;
}
