"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Monitor, X, Circle, RotateCcw } from "lucide-react";
import { presentationPages, presentationStartIndex, presentationKeyIndex } from "@/lib/creation/layout-rendering";
import { presentationWindow, presentationAssetWindow, presentationTime } from "@/lib/creation/html/presentation";
import { inspectHtml } from "@/lib/creation/html/document";
import { projectHtml } from "@/lib/creation/html/projection";
import { createWebPreviewAssetLoader } from "@/lib/creation/client/web-preview-assets";
import HtmlPreviewFrame from "./HtmlPreviewFrame";
import "./html-presentation.css";

// The popup receives only trusted application CSS. Slide HTML remains sandboxed.
const speakerCss = "*{box-sizing:border-box}body{margin:0;background:#11141c;color:#f4f5fa;font:14px system-ui,sans-serif}button{font:inherit;color:inherit;background:#232938;border:1px solid #ffffff24;border-radius:8px;padding:9px 13px;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid #a89cff}header,footer{display:flex;align-items:center;gap:12px;padding:16px 20px}header strong{flex:1}header time{font:28px monospace;font-variant-numeric:tabular-nums}.sp-body{display:grid;grid-template-columns:1.5fr 1fr;gap:20px;padding:0 20px}.sp-view{height:45vh;position:relative;background:#06070a;border-radius:10px;overflow:hidden}.sp-next{height:25vh}.sp-label{margin:0 0 8px;color:#abb5cc}.sp-notes{white-space:pre-wrap;line-height:1.7;max-height:40vh;overflow:auto;font-size:18px}.sp-pages{display:flex;gap:7px;overflow:auto;padding:10px 20px}.sp-pages button{flex-shrink:0}.sp-pages [aria-current=page]{background:#6551ce}iframe{border:0;display:block}.cw-slide-fit{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}.cw-slide-fit>div{position:relative;flex-shrink:0}@media(max-width:640px){.sp-body{grid-template-columns:1fr}.sp-view{height:35vh}.sp-next{height:18vh}}";

const SlideFrame = memo(function SlideFrame({ page, theme, master, images, onKeyDown, onPointer, onTap }) {
  const host = useRef(null), frame = useRef(null), cleanup = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [autoHeight, setAutoHeight] = useState(720);
  const html = useMemo(() => projectHtml(page, images, { theme, master }), [page, images, theme, master]);
  useEffect(() => {
    const element = host.current, ViewResizeObserver = element.ownerDocument.defaultView.ResizeObserver;
    const observer = new ViewResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize(old => Math.abs(old.width - width) < 1 && Math.abs(old.height - height) < 1 ? old : { width, height });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const loaded = useCallback(() => {
    cleanup.current?.();
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const measure = () => { if (page.height === "auto") setAutoHeight(Math.max(1, Math.min(8192, doc.body.scrollHeight))); };
    const move = event => {
      const rect = frame.current.getBoundingClientRect();
      const ratio = rect.width / page.width;
      onPointer?.({ x: rect.left + event.clientX * ratio, y: rect.top + event.clientY * ratio });
    };
    const tap = event => { if (event.button === 0 && !event.target.closest("a")) onTap?.(); };
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("pointermove", move);
    doc.addEventListener("click", tap);
    doc.addEventListener("load", measure, true); measure();
    cleanup.current = () => { doc.removeEventListener("keydown", onKeyDown); doc.removeEventListener("pointermove", move); doc.removeEventListener("click", tap); doc.removeEventListener("load", measure, true); };
  }, [onKeyDown, onPointer, onTap, page]);
  useEffect(() => () => cleanup.current?.(), []);
  const height = page.height === "auto" ? autoHeight : page.height;
  const scale = Math.max(0.001, Math.min(size.width / page.width, size.height / height));
  return <div ref={host} className="cw-slide-fit"><div style={{ width: page.width * scale, height: height * scale }}>
    <HtmlPreviewFrame frameRef={frame} html={html} onUpdate={loaded} title={page.title} tabIndex={-1}
      style={{ width: page.width, height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }} />
  </div></div>;
});

function SpeakerClock({ reset }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tick = () => setSeconds(Math.floor((Date.now() - started) / 1000));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [reset]);
  return <time>{presentationTime(seconds)}</time>;
}

function SpeakerView({ pages, index, go, frameFor, zh }) {
  const [reset, setReset] = useState(0), page = pages[index];
  return <><header><strong>{zh ? "演讲者视图 · 此窗口不投屏" : "Speaker view · keep this window private"}</strong><SpeakerClock reset={reset} /><button onClick={() => setReset(value => value + 1)} aria-label={zh ? "重置计时" : "Reset timer"}><RotateCcw size={16} /></button></header>
    <div className="sp-body"><section><p className="sp-label">{zh ? "当前页" : "Current slide"} · {index + 1} / {pages.length}</p><div className="sp-view">{page && frameFor(page)}</div><p className="sp-notes">{page?.notes || (zh ? "此页没有演讲备注" : "No speaker notes")}</p></section>
      <section><p className="sp-label">{zh ? "下一页" : "Next slide"}</p><div className="sp-view sp-next">{pages[index + 1] ? frameFor(pages[index + 1]) : <p>{zh ? "已到最后一页" : "End of presentation"}</p>}</div></section></div>
    <footer><button disabled={!index} onClick={() => go(index - 1)}>{zh ? "上一页" : "Previous"}</button><button disabled={index >= pages.length - 1} onClick={() => go(index + 1)}>{zh ? "下一页" : "Next"}</button><span>{page?.title}</span></footer>
    <nav className="sp-pages" aria-label={zh ? "跳转页面" : "Go to slide"}>{pages.map((item, number) => <button key={item.id} aria-current={number === index ? "page" : undefined} title={item.title} onClick={() => go(number)}>{number + 1}</button>)}</nav>
  </>;
}

export default function HtmlSlidePresentation({ content, startPageId, initialImages, onClose, zh = true }) {
  const pages = useMemo(() => presentationPages(content), [content]);
  const [index, setIndex] = useState(() => presentationStartIndex(pages, startPageId));
  const [images, setImages] = useState(() => new Map(initialImages)), [loadAssets] = useState(() => createWebPreviewAssetLoader(initialImages));
  const [notice, setNotice] = useState(""), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0);
  const [fullscreen, setFullscreen] = useState(false), [controls, setControls] = useState(true), [laser, setLaser] = useState(false), [speaker, setSpeaker] = useState(null);
  const host = useRef(null), pointer = useRef(null), popup = useRef(null), hideTimer = useRef(null), current = useRef(null);
  const text = (cn, en) => zh ? cn : en;
  useLayoutEffect(() => { current.current = { index, count: pages.length, onClose }; }, [index, pages.length, onClose]);
  const showControls = useCallback(() => {
    setControls(true); clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 2300);
  }, []);
  const go = useCallback(number => { setIndex(Math.max(0, Math.min(pages.length - 1, number))); showControls(); }, [pages.length, showControls]);
  const keydown = useCallback(event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.("input,textarea,select")) return;
    if (event.key === "Escape") { event.preventDefault(); current.current?.onClose(); return; }
    if (event.target.closest?.("button") && [" ", "Enter"].includes(event.key)) return;
    const state = current.current;
    if (!state) return;
    const next = presentationKeyIndex(event.key, state.index, state.count);
    if (next !== null) { event.preventDefault(); go(next); }
  }, [go]);
  useEffect(() => {
    const dialog = host.current, previous = document.activeElement;
    dialog.showModal(); dialog.focus();
    hideTimer.current = setTimeout(() => setControls(false), 2300);
    const changed = () => setFullscreen(document.fullscreenElement === dialog);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed); clearTimeout(hideTimer.current);
      popup.current?.close();
      if (document.fullscreenElement === dialog) void document.exitFullscreen().catch(() => {});
      dialog.close(); if (previous?.isConnected) previous.focus();
    };
  }, []);
  const windowPages = useMemo(() => presentationWindow(pages, index), [pages, index]);
  const assetPlan = useMemo(() => {
    const assetsFor = page => {
      const master = content.masters?.find(item => item.id === page.masterId);
      return [...inspectHtml(page.html).assets, ...(master ? inspectHtml("<style>" + master.css + "</style>" + master.html + "<span>master</span>").assets : [])];
    };
    return { key: JSON.stringify(presentationAssetWindow(pages, index, assetsFor)), priorityIds: pages[index] ? assetsFor(pages[index]) : [] };
  }, [pages, index, content.masters]);
  const assetKey = assetPlan.key;
  useEffect(() => {
    const controller = new AbortController(), ids = JSON.parse(assetKey);
    void loadAssets(ids, { signal: controller.signal, priorityIds: assetPlan.priorityIds, onEvict(id) {
      if (!controller.signal.aborted) setImages(old => new Map([...old].filter(([key]) => key !== id)));
    }, onImage(id, url) {
      if (!controller.signal.aborted) setImages(old => old.get(id) === url ? old : new Map([...old].filter(([key]) => ids.includes(key))).set(id, url));
    } }).then(result => {
      if (!controller.signal.aborted) setImages(old => old.size === result.size && [...result].every(([id, url]) => old.get(id) === url) ? old : result);
    }).catch(() => { if (!controller.signal.aborted) setFailure({ key: assetKey, retry }); });
    return () => controller.abort();
  }, [assetPlan, assetKey, loadAssets, retry]);
  const fault = failure?.key === assetKey && failure.retry === retry;
  const movePointer = useCallback(position => {
    if (pointer.current) {
      const rect = host.current.getBoundingClientRect();
      pointer.current.style.left = (position.x - rect.left) + "px";
      pointer.current.style.top = (position.y - rect.top) + "px";
    }
    showControls();
  }, [showControls]);
  const advance = useCallback(() => { if (current.current) go(current.current.index + 1); }, [go]);
  const frameFor = (page, audience = false) => <SlideFrame key={page.id} page={page} theme={content.theme} master={content.masters?.find(item => item.id === page.masterId)} images={images} onKeyDown={keydown} onPointer={audience ? movePointer : undefined} onTap={audience ? advance : undefined} />;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === host.current) await document.exitFullscreen();
      else if (host.current.requestFullscreen) await host.current.requestFullscreen();
      else setNotice(text("浏览器不支持全屏，可继续窗口演示。", "Fullscreen is unavailable. Continue in this window."));
    } catch { setNotice(text("浏览器未允许全屏，可继续窗口演示。", "Fullscreen was denied. Continue in this window.")); }
  }
  function openSpeaker() {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const win = window.open("about:blank", "", "popup,width=1120,height=780");
    if (!win) { setNotice(text("演讲者窗口被拦截，请允许本站弹窗后重试。", "Allow popups for this site to open speaker view.")); return; }
    win.document.title = text("演讲者视图", "Speaker view");
    const style = win.document.createElement("style"), root = win.document.createElement("main");
    style.textContent = speakerCss; win.document.head.append(style); win.document.body.append(root);
    popup.current = win; setSpeaker({ win, root });
  }
  useEffect(() => {
    if (!speaker) return;
    const win = speaker.win;
    win.addEventListener("keydown", keydown);
    const timer = setInterval(() => { if (win.closed) { setSpeaker(null); popup.current = null; } }, 1000);
    return () => { clearInterval(timer); win.removeEventListener("keydown", keydown); };
  }, [speaker, keydown]);
  const page = pages[index];
  return <>{createPortal(<dialog ref={host} tabIndex={-1} className={"cw-html-presentation" + (controls ? " has-controls" : "")} aria-label={text("幻灯片演示", "Slide presentation")}
    onKeyDown={event => keydown(event.nativeEvent)} onCancel={event => { event.preventDefault(); onClose(); }} onPointerMove={showControls}>
    <div className="cw-slide-screen">
      {windowPages.map(item => <div key={item.id} className="cw-slide-slot" style={{ visibility: item.id === page?.id ? "visible" : "hidden" }} aria-hidden={item.id !== page?.id} inert={item.id !== page?.id}>{frameFor(item, item.id === page?.id)}</div>)}
      {!page && <p>{text("所有页面均已隐藏，请返回编辑器显示至少一页。", "All slides are hidden. Show a slide in the editor.")}</p>}
      {laser && <span ref={pointer} className="cw-slide-laser" aria-hidden="true" />}
    </div>
    <footer className="cw-slide-controls" onFocus={showControls} onPointerEnter={showControls}>
      <button disabled={!index || !page} onClick={() => go(index - 1)} aria-label={text("上一页", "Previous slide")}><ChevronLeft size={20} /></button>
      <span role="status">{page ? index + 1 : 0} / {pages.length}</span>
      <button disabled={!page || index >= pages.length - 1} onClick={() => go(index + 1)} aria-label={text("下一页", "Next slide")}><ChevronRight size={20} /></button>
      <span className="cw-slide-title">{page?.title}</span>
      <button aria-pressed={laser} onClick={() => setLaser(value => !value)} title={text("激光笔", "Laser pointer")} aria-label={text("激光笔", "Laser pointer")}><Circle size={16} /></button>
      <button onClick={openSpeaker} title={text("演讲者窗口", "Speaker window")} aria-label={text("演讲者窗口", "Speaker window")}><Monitor size={18} /><span>{text("演讲者", "Speaker")}</span></button>
      <button onClick={toggleFullscreen} aria-label={text(fullscreen ? "退出全屏" : "全屏演示", fullscreen ? "Exit fullscreen" : "Fullscreen")}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
      <button onClick={onClose} aria-label={text("结束演示", "End presentation")}><X size={20} /></button>
    </footer>
    {(notice || fault) && <div className="cw-slide-notice" role="status">{notice || text("部分配图未加载，文字仍可演示。", "Some images failed to load. Text remains available.")}{fault && <button onClick={() => setRetry(value => value + 1)}>{text("重试图片", "Retry images")}</button>}<button onClick={() => { setNotice(""); setFailure(null); }} aria-label={text("关闭提示", "Dismiss")}><X size={14} /></button></div>}
  </dialog>, document.body)}
    {speaker && !speaker.win.closed && createPortal(<SpeakerView pages={pages} index={index} go={go} frameFor={frameFor} zh={zh} />, speaker.root)}
  </>;
}
