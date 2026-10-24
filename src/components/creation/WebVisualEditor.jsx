"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { patchWebVisualSource } from "@/lib/creation/client/web-visual-patch";
import { runWebSourceTask } from "@/lib/creation/client/web-source-worker";
import { prepareWebPreviewDocument } from "@/lib/creation/web-preview";
import { loadWebPreviewAssets } from "@/lib/creation/client/web-preview-assets";
import { bindWebVisualSelection } from "@/lib/creation/client/web-visual-selection";
import { creationError } from "./creation-errors";
import WebPreviewViewport from "./WebPreviewViewport";
import { SlidersHorizontal, X } from "lucide-react";

export default function WebVisualEditor({ content, pageId, mode, zh, readOnly, onDraft, onApply, onError, hasPending }) {
  const [state, setState] = useState(null), [selection, setSelection] = useState(null), [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState(""), [styles, setStyles] = useState({}), [foreground, setForeground] = useState(true), [composing, setComposing] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const frame = useRef(null), binding = useRef(null);
  const latest = useRef({ readOnly, hasPending });
  useEffect(() => { latest.current = { readOnly, hasPending }; }, [readOnly, hasPending]);
  const file = content.files.find(file => file.id === pageId && file.kind === "html") || content.files.find(file => file.path === content.entryPath);
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    const visibility = () => { const visible = document.visibilityState !== "hidden"; setForeground(visible); if (!visible) setState(null); }; visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!foreground) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const session = await runWebSourceTask("visual", { source: file.content }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const prepared = prepareWebPreviewDocument({ ...content, entryPath: file.path }, { editing: session });
        const images = await loadWebPreviewAssets(prepared.assetIds, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ content, fileId: file.id, session, editableIds: prepared.editableIds, srcDoc: prepared.render(images), error: null });
      } catch (error) { if (!controller.signal.aborted) setState({ content, fileId: file.id, error }); }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); binding.current?.dispose(); binding.current = null; };
  }, [content, file.id, file.path, file.content, foreground, attempt]);
  const current = foreground && state?.content === content && state.fileId === file.id;
  // Revision identity matters even if undo returns to identical source text:
  // an old inspector must not reappear with the previous uncommitted value.
  const activeSelection = selection?.fileId === file.id && selection?.content === content ? selection : null;
  const options = useMemo(() => state?.editableIds?.map(id => { const target = state.session.targets.get(id); return <option key={id} value={id}>{target.tag}: {target.text.slice(0, 60)}</option>; }), [state]);
  function loaded() {
    binding.current?.dispose(); binding.current = null;
    if (!current || !state.session) return;
    try {
      binding.current = bindWebVisualSelection(frame.current.contentDocument, state.session.targets, selected => {
        setSelection(selected ? { ...selected, fileId: file.id, content } : null); setValue(selected?.text || ""); setStyles({}); setComposing(false);
        if (selected) setInspectorOpen(true);
      }, () => !latest.current.readOnly && !latest.current.hasPending);
    } catch (error) { onError?.(error); }
  }
  function change(nextValue, nextStyles = styles, isComposing = composing) {
    if (readOnly || !activeSelection || !current) return;
    try {
      const source = patchWebVisualSource(state.session, file.content, activeSelection.id, { text: nextValue, styles: nextStyles });
      onDraft({ kind: "web-source", fileId: file.id, path: file.path, fileKind: "html", original: file.content, text: source, composing: isComposing });
      setValue(nextValue); setStyles(nextStyles);
    } catch (error) { onError?.(error); }
  }
  return <div className="cw-web-visual">
    {!inspectorOpen && <button className="cw-web-inspector-toggle" aria-label={text("展开元素属性", "Open element properties")} onClick={() => setInspectorOpen(true)}><SlidersHorizontal size={16} />{text("属性", "Properties")}</button>}
    <WebPreviewViewport mode={mode} width={mode === "mobile" ? content.viewport.mobile : content.viewport.desktop}>
      {current && state.srcDoc ? <iframe ref={frame} title={text("网页可视化编辑", "Visual website editor")} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={state.srcDoc} onLoad={loaded} style={{ width: mode === "mobile" ? content.viewport.mobile : content.viewport.desktop, pointerEvents: readOnly || hasPending ? "none" : "auto" }} />
        : <p role={current && state.error ? "alert" : "status"}>{current && state.error ? creationError(state.error, zh) : text("正在准备编辑画面…", "Preparing visual editor…")}</p>}
      {current && state.error && <button onClick={() => setAttempt(value => value + 1)}>{text("重试", "Retry")}</button>}
    </WebPreviewViewport>
    {inspectorOpen && <aside className="cw-web-inspector" aria-label={text("元素属性", "Element properties")}>
      <header><strong>{text("文字与样式", "Text and style")}</strong>{activeSelection && <code>{activeSelection.tag}</code>}<button aria-label={text("收起元素属性", "Close element properties")} onClick={() => setInspectorOpen(false)}><X size={14} /></button></header>
      {current && state.session && <label>{text("选择文字", "Select text")}<select aria-label={text("选择文字", "Select text")} disabled={readOnly || hasPending} value={activeSelection?.id || ""} onChange={event => binding.current?.select(event.target.value)}><option value="">{text("选择要编辑的文字", "Choose text to edit")}</option>{options}</select></label>}
      {!activeSelection ? <p>{text("点击画面中的标题或文字进行修改。包含子元素的整块内容请使用代码编辑。", "Click a heading or text in the page to edit it. Use the code editor for blocks containing child elements.")}</p> : <>
        <label>{text("文字内容", "Text content")}<textarea aria-label={text("元素文字", "Element text")} value={value} disabled={readOnly || !current} maxLength={16000} onChange={event => change(event.target.value, styles, composing || event.nativeEvent.isComposing)} onCompositionStart={() => { setComposing(true); change(value, styles, true); }} onCompositionEnd={event => { setComposing(false); change(event.currentTarget.value, styles, false); }} /></label>
        <label>{text("字号", "Font size")}<input aria-label={text("元素字号", "Element font size")} type="number" min={8} max={300} placeholder={text("保持原值", "Keep current")} value={styles["font-size"]?.replace("px", "") || ""} disabled={readOnly} onChange={event => { const size = Number(event.target.value); if (Number.isInteger(size) && size >= 8 && size <= 300) change(value, { ...styles, "font-size": `${size}px` }); }} /></label>
        <label>{text("文字颜色", "Text color")}<input aria-label={text("元素颜色", "Element color")} type="color" value={styles.color || activeSelection.color || "#111111"} disabled={readOnly} onChange={event => change(value, { ...styles, color: event.target.value })} /></label>
        <label>{text("字重", "Weight")}<select aria-label={text("元素字重", "Element weight")} value={styles["font-weight"] || ""} disabled={readOnly} onChange={event => { if (event.target.value) change(value, { ...styles, "font-weight": event.target.value }); }}><option value="">{text("保持原值", "Keep current")}</option><option value="normal">{text("常规", "Normal")}</option><option value="bold">{text("粗体", "Bold")}</option></select></label>
        <label>{text("对齐", "Alignment")}<select aria-label={text("元素对齐", "Element alignment")} value={styles["text-align"] || ""} disabled={readOnly} onChange={event => { if (event.target.value) change(value, { ...styles, "text-align": event.target.value }); }}><option value="">{text("保持原值", "Keep current")}</option><option value="left">{text("左对齐", "Left")}</option><option value="center">{text("居中", "Center")}</option><option value="right">{text("右对齐", "Right")}</option></select></label>
        <button disabled={readOnly || !hasPending || composing || !current} onClick={onApply}>{text("应用修改", "Apply changes")}</button>
        <p>{hasPending ? text("应用当前修改后，可以选择其他文字。", "Apply these changes before selecting other text.") : text("仅修改选中文字和指定样式。", "Only the selected text and chosen styles change.")}</p>
      </>}
    </aside>}
  </div>;
}
