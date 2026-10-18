"use client";
import { useEffect, useRef, useState } from "react";
import { TEXT_LIMIT, TEXT_LINE_HEIGHT, textLayerHeight } from "@/lib/studio/text-layer";

export default function CanvasTextEditor({ layer, camera, color, zh, onCommit, onCancel }) {
  const input = useRef(null), ended = useRef(false), composing = useRef(false);
  const [text, setText] = useState(layer.text || "");
  const fontSize = layer.fontSize || 24;
  const height = textLayerHeight(text, layer.width, fontSize);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  function finish(cancel = false) {
    if (ended.current) return;
    ended.current = true;
    if (cancel || !text.trim()) { onCancel(); return; }
    onCommit({ ...layer, text, height });
  }
  return <textarea ref={input} className="ms-inline-text-editor" aria-label={zh ? "画布文字" : "Canvas text"}
    placeholder={zh ? "输入文字…" : "Write something…"} value={text} maxLength={TEXT_LIMIT} spellCheck={false}
    style={{ left: camera.x + layer.x * camera.scale, top: camera.y + layer.y * camera.scale, width: layer.width, height,
      fontSize, lineHeight: TEXT_LINE_HEIGHT, color: layer.fill || color,
      transform: `scale(${camera.scale}) rotate(${layer.rotation || 0}deg)` }}
    onChange={event => setText(event.target.value)} onBlur={() => finish()}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || composing.current) return;
      if (event.key === "Escape") { event.preventDefault(); finish(true); }
      else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); }
    }} />;
}
