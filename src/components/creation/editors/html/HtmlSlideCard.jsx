"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inspectHtml } from "@/lib/creation/html/document";
import { projectHtml } from "@/lib/creation/html/projection";
import HtmlPreviewFrame from "./HtmlPreviewFrame";

export default memo(function HtmlSlideCard({ page, theme, master, width, measuredHeight, onHeight, zh, loadAssets }) {
  const frame = useRef(null), [images, setImages] = useState(() => new Map()), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const cleanup = useRef(null);
  const assets = useMemo(() => JSON.stringify([...new Set([...inspectHtml(page.html, { allowEmpty: true }).assets,
    ...(master ? inspectHtml("<style>" + master.css + "</style>" + master.html + "<span>master</span>").assets : [])])]), [page.html, master]);
  const html = useMemo(() => projectHtml(page, images, { theme, master }), [page, images, theme, master]);
  useEffect(() => {
    const abort = new AbortController();
    const next = new Map();
    void loadAssets(JSON.parse(assets), { signal: abort.signal, onImage: (id, url) => next.set(id, url) })
      .then(() => { if (!abort.signal.aborted) { setImages(next); setError(false); } })
      .catch(() => { if (!abort.signal.aborted) { if (next.size) setImages(next); setError(true); } });
    return () => abort.abort();
  }, [assets, loadAssets, attempt]);
  const loaded = useCallback(() => {
    cleanup.current?.();
    const doc = frame.current?.contentDocument;
    if (page.height !== "auto" || !doc?.body) return;
    const measure = () => onHeight(page.id, Math.max(1, Math.min(8192, doc.body.scrollHeight)));
    const observer = new ResizeObserver(measure); observer.observe(doc.body);
    doc.addEventListener("load", measure, true); measure();
    cleanup.current = () => { observer.disconnect(); doc.removeEventListener("load", measure, true); };
  }, [page.height, page.id, onHeight]);
  useEffect(() => () => cleanup.current?.(), []);
  const height = page.height === "auto" ? measuredHeight || 720 : page.height, scale = width / page.width;
  return <><HtmlPreviewFrame frameRef={frame} html={html} onUpdate={loaded} title={page.title || (zh ? "幻灯片预览" : "Slide preview")} tabIndex={-1}
    style={{ width: page.width, height, transform: "scale(" + scale + ")", transformOrigin: "top left", pointerEvents: "none" }} />
    {error && <button className="cw-slide-image-error" onClick={() => setAttempt(value => value + 1)}>{zh ? "部分配图未加载 · 重试" : "Some images unavailable · retry"}</button>}</>;
});
