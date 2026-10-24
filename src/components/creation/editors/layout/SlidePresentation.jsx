"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Maximize, Minimize, X, StickyNote } from "lucide-react";
import LayoutCanvas from "./LayoutCanvas";
import { presentationPages, presentationStartIndex, presentationKeyIndex } from "@/lib/creation/layout-rendering";

const ignore = () => {};
export default function SlidePresentation({ content, startPageId, onClose, zh }) {
  const pages = useMemo(() => presentationPages(content), [content]);
  const [index, setIndex] = useState(() => presentationStartIndex(pages, startPageId));
  const [fullscreen, setFullscreen] = useState(false), [notice, setNotice] = useState(false), [notes, setNotes] = useState(false);
  const host = useRef(null), notesButton = useRef(null), wasFullscreen = useRef(false), close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const text = (cn, en) => zh ? cn : en, page = pages[index];
  const finish = useCallback(() => close.current(), []);
  useEffect(() => {
    const dialog = host.current, previous = document.activeElement;
    dialog.showModal();
    const changed = () => {
      const active = document.fullscreenElement === dialog;
      setFullscreen(active);
      if (wasFullscreen.current && !active) finish();
      wasFullscreen.current = active;
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement === dialog) void document.exitFullscreen().catch(() => {});
      dialog.close(); if (previous?.isConnected) previous.focus();
    };
  }, [finish]);
  async function toggleFullscreen() {
    setNotice(false);
    try {
      if (document.fullscreenElement === host.current) {
        // An explicit windowed-mode request is different from Escape/exit.
        wasFullscreen.current = false; await document.exitFullscreen();
      } else if (host.current.requestFullscreen) await host.current.requestFullscreen();
      else setNotice(true);
    } catch { setNotice(true); }
  }
  return createPortal(<dialog ref={host} className="cw-presentation" aria-label={text("幻灯片演示", "Slide presentation")}
    onCancel={event => { event.preventDefault(); finish(); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      // Space/Enter on controls retains normal button semantics.
      if (event.target.closest("button") && [" ", "Enter"].includes(event.key)) return;
      const next = presentationKeyIndex(event.key, index, pages.length);
      if (next !== null) { event.preventDefault(); setIndex(next); }
    }}>
    <div className="cw-presentation-stage">{page ? <LayoutCanvas key={page.id} page={page} readOnly presentation onSelect={ignore} onOperations={ignore} /> : <p>{text("所有页面都已隐藏，请返回编辑器显示至少一页。", "All slides are hidden. Show a slide in the editor first.")}</p>}</div>
    {notes && <aside className="cw-presentation-notes" aria-label={text("演讲备注", "Speaker notes")}><header><strong>{text("演讲备注（当前屏幕可见）", "Speaker notes (visible on this screen)")}</strong><button aria-label={text("关闭备注", "Close notes")} onClick={() => { setNotes(false); notesButton.current?.focus(); }}><X size={16} /></button></header><p>{page?.notes || text("本页没有备注", "No notes for this slide")}</p></aside>}
    <footer><div className="cw-presentation-controls"><button disabled={index === 0 || !page} onClick={() => setIndex(value => Math.max(0, value - 1))} aria-label={text("上一页", "Previous slide")}><ChevronLeft size={20} /></button>
      <span role="status">{page ? index + 1 : 0} / {pages.length}</span>
      <button disabled={index >= pages.length - 1 || !page} onClick={() => setIndex(value => Math.min(pages.length - 1, value + 1))} aria-label={text("下一页", "Next slide")}><ChevronRight size={20} /></button></div>
      <span className="cw-presentation-title">{page?.title}</span>
      <button ref={notesButton} aria-pressed={notes} disabled={!page} onClick={() => setNotes(value => !value)} title={text("备注会显示在当前屏幕", "Notes will be visible on this screen")}><StickyNote size={17} />{text("备注", "Notes")}</button>
      <button aria-label={text(fullscreen ? "退出全屏" : "全屏演示", fullscreen ? "Exit fullscreen" : "Enter fullscreen")} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
      <button onClick={finish} aria-label={text("结束演示", "End presentation")}><X size={18} /></button>
    </footer>
    {notice && <div role="status" className="cw-presentation-notice">{text("浏览器未允许全屏，可继续在当前窗口演示。", "Fullscreen is unavailable. Continue presenting in this window.")}</div>}
  </dialog>, document.body);
}
