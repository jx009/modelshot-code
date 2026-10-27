"use client";

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState } from "react";
import { GripVertical, EyeOff, Plus, PanelLeftOpen } from "lucide-react";
import { useSlideReorder } from "../../useSlideReorder";
import { createSlidePreviewAssets } from "@/lib/creation/client/slide-preview-assets";
import { requestKey } from "@/lib/client-api";
import SlideThumbnails from "./SlideThumbnails";
import "./html-viewer.css";

const Card = lazy(() => import("./HtmlSlideCard"));
const InlineEditor = lazy(() => import("./HtmlEditor"));
export default function HtmlSlideViewer({ content, controllerRef, onOperations, onError, onEdit, onPage, initialPageId, readOnly, zh, editing = false, thumbnails = false, onThumbnails, notes = false, editorProps }) {
  const [assets] = useState(createSlidePreviewAssets);
  useEffect(() => () => assets.clear(), [assets]);
  const activeEditor = useRef(null), scrollTarget = useRef(null);
  const [selected, setSelected] = useState(initialPageId || content.pages[0]?.id);
  function commitPending() { activeEditor.current?.commitPending(); }
  function apply(operations) {
    if (readOnly) return false;
    try { commitPending(); return onOperations(operations); } catch (error) { onError?.(error); return false; }
  }
  const move = (pageId, index) => apply([{ op: "reorderHtmlPage", pageId, index }]);
  const { root, rowProps, handleProps, announcement, isDragging } = useSlideReorder({ pages: content.pages, readOnly, onMove: move });
  const [visible, setVisible] = useState(() => new Set([initialPageId || content.pages[0]?.id]));
  const [heights, setHeights] = useState({});
  const measured = useCallback((id, height) => setHeights(current => current[id] === height ? current : { ...current, [id]: height }), []);
  const [width, setWidth] = useState(0), initial = useRef(initialPageId), onPageRef = useRef(onPage);
  useEffect(() => { onPageRef.current = onPage; }, [onPage]);
  const editorPageChanged = useCallback(id => {
    // The inline editor can duplicate or remove its page. Keep the surrounding
    // continuous document and thumbnail selection on the resulting page.
    setSelected(id);
    onPageRef.current?.(id);
  }, []);
  useImperativeHandle(controllerRef, () => ({
    commitPending, getPendingText: () => activeEditor.current?.getPendingText() || null,
    discardPending: () => activeEditor.current?.discardPending(),
    // Keep an editing session stable; resume live cloud updates on exit.
    canRefreshRemote: () => !editing && !isDragging(),
  }));
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
  useLayoutEffect(() => {
    if (!scrollTarget.current) return;
    const host = root.current, slide = host.querySelector('[data-slide-id="' + CSS.escape(scrollTarget.current) + '"]');
    if (slide) { host.scrollTo({ top: host.scrollTop + slide.getBoundingClientRect().top - host.getBoundingClientRect().top, behavior: "instant" }); scrollTarget.current = null; }
  });
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
      if (best?.[1] > 0 && !editing) onPageRef.current?.(best[0]);
    }, { root: host, threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const element of host.querySelectorAll("[data-slide-id]")) { observer.observe(element); active.observe(element); }
    return () => { observer.disconnect(); active.disconnect(); };
  }, [root, ids, editing]);
  function select(id, scroll = false) {
    try {
      commitPending();
      if (scroll) scrollTarget.current = id;
      setSelected(id); onPage?.(id);
      if (scroll && selected === id) {
        const host = root.current, slide = host.querySelector('[data-slide-id="' + CSS.escape(id) + '"]');
        if (slide) host.scrollTo({ top: host.scrollTop + slide.getBoundingClientRect().top - host.getBoundingClientRect().top, behavior: "instant" });
      }
    } catch (error) { onError?.(error); }
  }
  function insert(after) {
    const id = "page_" + requestKey(), index = content.pages.indexOf(after) + 1;
    const page = { id, width: after.width, height: after.height, title: zh ? "新页面" : "New slide", notes: "", hidden: false,
      html: '<!DOCTYPE html><html><head><style>body{margin:0;background:var(--creation-background,#fff);color:var(--creation-primary,#222);font-family:sans-serif}h1{margin:64px;font-size:64px}</style></head><body><h1 data-node-id="title">' + (zh ? "新页面" : "New slide") + '</h1></body></html>' };
    if (apply([{ op: "insertHtmlPage", index, page }]) !== false) { scrollTarget.current = id; setSelected(id); onPage?.(id); }
  }
  const activeId = content.pages.some(page => page.id === selected) ? selected : content.pages[0]?.id;
  return <div className="cw-deck-surface" data-editing={editing}>
    {thumbnails && <SlideThumbnails content={content} selectedId={editing ? activeId : initialPageId} onSelect={id => select(id, true)} onMove={move} onHidden={page => apply([{ op: "setHtmlPageMeta", pageId: page.id, changes: { hidden: !page.hidden } }])} onClose={() => onThumbnails?.(false)} readOnly={readOnly} loadAssets={assets.read} zh={zh} />}
    {editing && !thumbnails && <button className="cw-deck-open-thumbnails" aria-label={zh ? "展开缩略图" : "Show thumbnails"} onClick={() => onThumbnails?.(true)}><PanelLeftOpen size={15} /></button>}
    <div ref={root} className="cw-slide-document" aria-label={zh ? "演示文稿连续浏览" : "Continuous slide viewer"}>
    <span className="sr-only" role="status">{announcement && (zh ? "页面已移动到第 " : "Slide moved to position ") + announcement}</span>
    {content.pages.map((page, index) => <article key={page.id} {...rowProps(page.id)} draggable={false} className="cw-slide-paper" aria-label={(zh ? "第 " : "Slide ") + (index + 1)}>
      <header><button {...handleProps(page.id)} className="cw-slide-grip" aria-label={(zh ? "拖动排序第 " : "Reorder slide ") + (index + 1)} title={zh ? "拖动调整顺序；Alt + 上下方向键移动" : "Drag to reorder; Alt + Up/Down"}><GripVertical size={12} /><span>{index + 1}</span></button>{page.hidden && <EyeOff size={14} />}</header>
      <div className="cw-slide-paper-content" style={{ aspectRatio: page.width + "/" + (page.height === "auto" ? heights[page.id] || 720 : page.height) }} onClick={() => { if (editing && activeId !== page.id) select(page.id); }} onDoubleClick={() => { if (!editing) onEdit(page.id); }}>
        {editing && activeId === page.id ? <Suspense fallback={<div className="cw-slide-skeleton">{zh ? "正在打开编辑…" : "Opening editor…"}</div>}><InlineEditor key={page.id} {...editorProps} embedded onHeight={measured} content={content} initialPageId={page.id} onPageChange={editorPageChanged} controllerRef={activeEditor} onOperations={onOperations} onError={onError} readOnly={readOnly} zh={zh} /></Suspense>
          : visible.has(page.id) && width > 0 ? <Suspense fallback={<div className="cw-slide-skeleton">{page.title}</div>}><Card page={page} theme={content.theme} master={content.masters?.find(item => item.id === page.masterId)} width={width} measuredHeight={heights[page.id]} onHeight={measured} zh={zh} loadAssets={assets.read} /></Suspense> : <div className="cw-slide-skeleton">{page.title}</div>}
      </div>
      {(editing || notes) && <div className="cw-deck-notes"><span className="cw-deck-notes-handle" />{editing ? <textarea aria-label={(zh ? "第 " : "Slide ") + (index + 1) + (zh ? " 页备注" : " notes")} placeholder={zh ? "暂无备注内容，请输入" : "Add speaker notes"} value={page.notes || ""} maxLength={16000} disabled={readOnly} onChange={event => apply([{ op: "setHtmlPageMeta", pageId: page.id, changes: { notes: event.target.value } }])} /> : <p>{page.notes || (zh ? "暂无备注" : "No notes")}</p>}</div>}
      {editing && <div className="cw-deck-insert"><button disabled={readOnly || content.pages.length >= 100} onClick={() => insert(page)}><Plus size={12} />{zh ? "新建页面" : "New slide"}</button></div>}
    </article>)}
    <footer>{zh ? "已显示 " : "Showing "}{content.pages.length}{zh ? " 页" : " slides"}{content.metadata?.plannedPages > content.pages.length ? (zh ? " · 后续页面生成后会自动出现" : " · New slides appear as they are saved") : ""}</footer>
  </div></div>;
}
