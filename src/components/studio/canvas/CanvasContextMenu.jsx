"use client";
import { useEffect, useRef } from "react";
import { requestKey } from "@/lib/client-api";

export default function CanvasContextMenu({ position, layers, ids, onChange, onSelect, onClose, onFit, zh }) {
  const menu = useRef(null);
  useEffect(() => {
    menu.current?.querySelector("button")?.focus();
    const dismiss = event => { if (!menu.current?.contains(event.target)) onClose(); };
    const escape = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [onClose]);
  const selected = layers.filter(layer => ids.includes(layer.id));
  const editable = selected.filter(layer => !layer.locked);
  function apply(action) {
    if (action === "duplicate") {
      const groups = new Map();
      const copies = selected.map(layer => {
        if (layer.selectionGroup && !groups.has(layer.selectionGroup)) groups.set(layer.selectionGroup, requestKey());
        return { ...layer, id: requestKey(), x: layer.x + 24, y: layer.y + 24, locked: false, selectionGroup: groups.get(layer.selectionGroup) };
      });
      onChange([...layers, ...copies]); onSelect(copies.map(layer => layer.id));
    } else if (action === "front" || action === "back") {
      const rest = layers.filter(layer => !editable.includes(layer));
      onChange(action === "front" ? [...rest, ...editable] : [...editable, ...rest]);
    } else if (action === "delete") {
      onChange(layers.filter(layer => !editable.includes(layer))); onSelect(selected.filter(layer => layer.locked).map(layer => layer.id));
    } else if (action === "group" || action === "ungroup") {
      const selectionGroup = action === "group" ? requestKey() : undefined;
      onChange(layers.map(layer => editable.includes(layer) ? { ...layer, selectionGroup } : layer));
    } else if (action === "lock") {
      const locked = !selected.every(layer => layer.locked);
      onChange(layers.map(layer => selected.includes(layer) ? { ...layer, locked } : layer));
    } else if (action === "all") onSelect(layers.filter(layer => layer.visible && !layer.locked).map(layer => layer.id));
    else onFit();
    onClose();
  }
  const actions = selected.length ? [
    ["duplicate", "复制", "Duplicate", false], ["group", "组合", "Group", editable.length < 2],
    ["ungroup", "解组", "Ungroup", !editable.some(layer => layer.selectionGroup)],
    ["front", "置于顶层", "Bring to front", !editable.length], ["back", "置于底层", "Send to back", !editable.length],
    ["lock", selected.every(layer => layer.locked) ? "解锁" : "锁定", selected.every(layer => layer.locked) ? "Unlock" : "Lock", false],
    ["delete", "删除", "Delete", !editable.length],
  ] : [["all", "选择全部", "Select all", !layers.some(layer => layer.visible && !layer.locked)], ["fit", "适应画布", "Fit canvas", false]];
  return <div ref={menu} className="ms-canvas-menu" role="menu" aria-label={zh ? "画布快捷菜单" : "Canvas actions"} style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}>
    {actions.map(([action, cn, en, disabled]) => <button role="menuitem" key={action} disabled={disabled} onClick={() => apply(action)}>{zh ? cn : en}</button>)}
  </div>;
}
