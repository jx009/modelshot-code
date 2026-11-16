"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// 锚定在触发按钮旁的弹出面板：自动选择上方或下方、随滚动与缩放重新定位，
// 点击外部、焦点离开或按 Esc 关闭。面板挂到最近的 <dialog> 或 body，避免被裁切。
export default function useAnchoredPanel({ width = 296, maxHeight = 600, disabled = false } = {}) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null), [host, setHost] = useState(null);
  const trigger = useRef(null), panel = useRef(null);
  const expanded = open && !disabled;
  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect(), panelWidth = Math.min(width, innerWidth - 24);
      const above = rect.top - 12, below = innerHeight - rect.bottom - 12, up = above > below;
      setPosition({ width: panelWidth, left: Math.max(12, Math.min(rect.left, innerWidth - panelWidth - 12)), maxHeight: Math.max(140, Math.min(maxHeight, up ? above : below)), ...(up ? { bottom: innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [expanded, width, maxHeight]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("focusin", dismiss); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); document.removeEventListener("keydown", escape, true); };
  }, [expanded]);
  const positioned = Boolean(position);
  useEffect(() => { if (expanded && positioned) panel.current?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }); }, [expanded, positioned]);
  return {
    expanded, position, host, trigger, panel,
    toggle: event => { setHost(event.currentTarget.closest("dialog") || document.body); setOpen(value => !value); },
    close: () => { setOpen(false); trigger.current?.focus(); },
  };
}
