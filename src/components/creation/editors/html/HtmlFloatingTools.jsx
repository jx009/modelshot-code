"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignLeft, AlignRight, ArrowUp, Bold, Bot, Copy, GripVertical, ImagePlus, Italic, Maximize, MoreHorizontal, Redo2, Replace, RotateCcw, Square, Strikethrough, Trash2, Type, Underline, Undo2, X } from "lucide-react";

export default function HtmlFloatingTools({ anchor, selected, textEditing, readOnly, canUndo, canRedo, onUndo, onRedo, onText, onImage, onShape, onFormat, onResize, onDuplicate, onDelete, onReset, onClose, onAdvanced, onAI, zh }) {
  const toolbar = useRef(null), drag = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 }), [ai, setAI] = useState(false), [prompt, setPrompt] = useState("");
  if (!anchor || typeof document === "undefined") return null;
  const t = (cn, en) => zh ? cn : en;
  const width = Math.min(window.innerWidth - 24, textEditing ? 880 : selected ? 520 : 420);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchor.left + offset.x));
  const top = Math.max(12, Math.min(window.innerHeight - 64, anchor.top + offset.y));
  const action = (Icon, cn, en, click, disabled = false) => <button type="button" aria-label={t(cn, en)} title={t(cn, en)} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={click}><Icon size={17} /></button>;
  return createPortal(<div ref={toolbar} className="cw-floating-editor" style={{ left, top, maxWidth: width }} onPointerDown={event => event.stopPropagation()} role="toolbar" aria-label={t("画布编辑工具", "Canvas editing tools")}>
    <div className="cw-floating-main">
      <button className="cw-floating-grip" aria-label={t("移动工具栏", "Move toolbar")} title={t("拖动工具栏；方向键微调", "Drag toolbar; arrow keys to move")} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerX: event.clientX, pointerY: event.clientY, offsetX: offset.x, offsetY: offset.y }; }} onPointerMove={event => { if (!drag.current) return; const origin = drag.current; setOffset({ x: origin.offsetX + event.clientX - origin.pointerX, y: origin.offsetY + event.clientY - origin.pointerY }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={event => { const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key]; if (delta) { event.preventDefault(); setOffset(value => ({ x: value.x + delta[0], y: value.y + delta[1] })); } }}><GripVertical size={12} /></button>
      <button className="cw-floating-ai" aria-pressed={ai} onMouseDown={event => event.preventDefault()} onClick={() => setAI(value => !value)}><Bot size={21} />{t("AI 编辑", "AI edit")}</button>
      <i />{action(Undo2, "撤销 (Ctrl+Z)", "Undo (Ctrl+Z)", onUndo, readOnly || !canUndo)}{action(Redo2, "重做 (Ctrl+Y)", "Redo (Ctrl+Y)", onRedo, readOnly || !canRedo)}<i />
      {action(ImagePlus, "插入图片", "Insert image", () => onImage(false), readOnly)}{action(Type, "插入文字", "Insert text", onText, readOnly)}{action(Square, "插入形状", "Insert shape", onShape, readOnly)}
      {textEditing && selected && <><i /><select aria-label={t("字体", "Font")} value={selected.fontFamily?.includes("serif") && !selected.fontFamily.includes("sans") ? "serif" : "sans-serif"} disabled={readOnly} onChange={event => onFormat("fontFamily", event.target.value)}><option value="sans-serif">{t("黑体", "Sans serif")}</option><option value="serif">{t("宋体", "Serif")}</option></select>
        <input className="cw-floating-size" type="number" aria-label={t("字号", "Font size")} min={6} max={512} key={selected.id + selected.fontSize} defaultValue={Math.round(parseFloat(selected.fontSize) || 32)} disabled={readOnly} onBlur={event => onFormat("fontSize", Math.min(512, Math.max(6, Number(event.target.value) || 32)) + "px")} />
        <select aria-label={t("行高", "Line spacing")} defaultValue="" disabled={readOnly} onChange={event => onFormat("lineHeight", event.target.value)}><option value="">{t("行高", "Spacing")}</option>{[1, 1.2, 1.5, 2].map(value => <option key={value} value={value}>{value}</option>)}</select>
        {action(Bold, "加粗", "Bold", () => onFormat("fontWeight", Number(selected.fontWeight) >= 600 ? "400" : "700"), readOnly)}{action(Italic, "斜体", "Italic", () => onFormat("fontStyle", selected.fontStyle === "italic" ? "normal" : "italic"), readOnly)}{action(Underline, "下划线", "Underline", () => onFormat("textDecoration", selected.textDecoration?.includes("underline") ? "none" : "underline"), readOnly)}{action(Strikethrough, "删除线", "Strikethrough", () => onFormat("textDecoration", selected.textDecoration?.includes("line-through") ? "none" : "line-through"), readOnly)}
        <label className="cw-floating-color" title={t("文字颜色", "Text color")}>A<input type="color" aria-label={t("文字颜色", "Text color")} disabled={readOnly} onChange={event => onFormat("color", event.target.value)} /></label>
        <label className="cw-floating-color" title={t("文字底色", "Text highlight")}>▧<input type="color" aria-label={t("文字底色", "Text highlight")} disabled={readOnly} onChange={event => onFormat("backgroundColor", event.target.value)} /></label>
        {action(AlignLeft, "左对齐", "Align left", () => onFormat("textAlign", "left"), readOnly)}{action(AlignCenter, "居中对齐", "Align center", () => onFormat("textAlign", "center"), readOnly)}{action(AlignRight, "右对齐", "Align right", () => onFormat("textAlign", "right"), readOnly)}</>}
      {selected?.tag === "IMG" && <><i />{action(Replace, "替换图片", "Replace image", () => onImage(true), readOnly)}{action(Maximize, "调整图片大小", "Resize image", onResize, readOnly)}</>}
      {selected && !textEditing && <><i />{action(Copy, "复制对象", "Duplicate object", onDuplicate, readOnly)}{action(RotateCcw, "重置位置", "Reset position", onReset, readOnly)}{action(Trash2, "删除对象", "Delete object", onDelete, readOnly)}</>}
      {action(MoreHorizontal, "更多编辑工具", "More editing tools", onAdvanced)}{action(X, "关闭工具栏", "Close toolbar", onClose)}
    </div>
    {ai && <form className="cw-floating-prompt" onSubmit={event => { event.preventDefault(); if (!readOnly && prompt.trim()) onAI(prompt.trim()); }}><textarea aria-label={t("AI 编辑指令", "AI edit instruction")} placeholder={t("输入 AI 编辑指令…", "Describe your edit…")} value={prompt} maxLength={12000} disabled={readOnly} onChange={event => setPrompt(event.target.value)} /><button type="submit" disabled={readOnly || !prompt.trim()} title={t("将指令和选中对象带入对话", "Continue with this selection in chat")}><ArrowUp size={17} />{t("继续修改", "Continue")}</button></form>}
  </div>, document.fullscreenElement || document.body);
}
