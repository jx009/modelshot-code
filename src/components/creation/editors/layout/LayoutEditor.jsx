"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Type, Square, Circle, Trash2, Lock, Unlock, ArrowUp, ArrowDown, Undo2, Redo2, Minus, Plus, Copy, MessageSquarePlus, ImagePlus, X, Play, EyeOff, Eye, SlidersHorizontal } from "lucide-react";
import { requestKey } from "@/lib/client-api";
import { inspectLayout } from "@/lib/creation/layout-operations";
import SlideNavigator from "./SlideNavigator";
import ObjectStyles from "./ObjectStyles";
import ThemeRoleField from "./ThemeRoleField";
import { NumberField } from "./InspectorFields";
import { alignNodeToPage, duplicateLayoutNode } from "@/lib/creation/layout-geometry";
import { createThemeOperation } from "@/lib/creation/layout-theme";
import { presentationPages } from "@/lib/creation/layout-rendering";
import Modal from "@/components/ui/Modal";

const Presentation = dynamic(() => import("./SlidePresentation"), { ssr: false, loading: () => <div className="cw-loading" role="status">正在打开演示… / Opening presentation…</div> });
const ThemeDialog = dynamic(() => import("./ThemeDialog"), { ssr: false, loading: () => <div role="status">正在打开主题设置… / Opening theme settings…</div> });
const Canvas = dynamic(() => import("./LayoutCanvas"), { ssr: false, loading: () => <div className="cw-loading" role="status">正在打开画布… / Opening canvas…</div> });
const AssetLibrary = dynamic(() => import("@/components/studio/AssetLibrary"), { loading: () => <div className="cw-loading" role="status">正在打开素材库… / Opening assets…</div> });
const issueLabels = {
  EMPTY_PAGE: ["页面还没有可见内容", "This page has no visible content"],
  NODE_OUTSIDE_PAGE: ["对象超出了画板边界", "Object extends beyond the page"],
  TEXT_HEIGHT_OVERFLOW: ["文字可能超出文本框，请增高文本框或减小字号", "Text may overflow. Increase the box height or reduce the font size"],
};
export default function LayoutEditor({ content, getContent, controllerRef, onPendingChange, onDraftChange, onOperations, onUndo, onRedo, canUndo, canRedo, onReference, onFlush, onError, readOnly: externallyReadOnly, zh = true }) {
  const [pageId, setPageId] = useState(content.pages[0].id), [selectedId, setSelected] = useState(null), [zoom, setZoom] = useState(1);
  const [picker, setPicker] = useState(null), [presentation, setPresentation] = useState(null), [preparing, setPreparing] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false), [layersOpen, setLayersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const alive = useRef(true), presenting = useRef(false), canvas = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const readOnly = externallyReadOnly || preparing || Boolean(presentation);
  const commitPending = useCallback(() => canvas.current?.commitPending(), []);
  useImperativeHandle(controllerRef, () => ({ commitPending, getPendingText: () => canvas.current?.getPendingText(), discardPending: () => canvas.current?.discardPending() }), [commitPending]);
  const afterText = useCallback(action => {
    try { commitPending(); return action(); } catch (error) { onError?.(error); return false; }
  }, [commitPending, onError]);
  const selectPage = useCallback(id => afterText(() => { setPageId(id); setSelected(null); }), [afterText]);
  const selectObject = useCallback(id => afterText(() => { setSelected(id); if (id) setInspectorOpen(true); }), [afterText]);
  const endPresentation = useCallback(() => { setPresentation(null); presenting.current = false; }, []);
  const page = content.pages.find(page => page.id === pageId) || content.pages[0];
  const selected = page.nodes.find(node => node.id === selectedId), selectedIndex = page.nodes.indexOf(selected);
  const issues = useMemo(() => inspectLayout({ pages: [page] }), [page]);
  const text = (cn, en) => zh ? cn : en;
  const commitText = useCallback(operations => !readOnly && onOperations(operations), [onOperations, readOnly]);
  const apply = useCallback(operations => !readOnly && afterText(() => onOperations(typeof operations === "function" ? operations(getContent()) : operations)), [onOperations, readOnly, afterText, getContent]);
  const setNode = changes => apply([{ op: "setNode", pageId: page.id, nodeId: selected.id, changes }]);
  function duplicateSelected() {
    if (!selected || selected.locked || readOnly) return;
    const id = requestKey();
    if (apply(latest => {
      const currentPage = latest.pages.find(item => item.id === page.id), index = currentPage.nodes.findIndex(item => item.id === selected.id);
      return [{ op: "insertNode", pageId: page.id, node: duplicateLayoutNode(currentPage.nodes[index], id, text("副本", "copy")), index: index + 1 }];
    }) !== false) setSelected(id);
  }
  async function present() {
    if (readOnly || presenting.current || !onFlush) return;
    try {
      commitPending();
      presenting.current = true; setPreparing(true);
      const saved = await onFlush();
      if (!alive.current) return;
      if (!presentationPages(saved.content).length) throw new Error("PRESENTATION_NO_VISIBLE_PAGES");
      setPresentation({ content: saved.content, startPageId: page.id });
    } catch (failure) { presenting.current = false; if (alive.current) onError?.(failure); }
    finally { if (alive.current) setPreparing(false); }
  }
  function add(type, shape) {
    const id = requestKey(), base = { id, name: text(type === "text" ? "文字" : "形状", type), x: Math.round(page.width * .1), y: Math.round(page.height * .1), width: Math.min(500, page.width * .7), height: type === "text" ? 100 : 200, rotation: 0, opacity: 1, visible: true, locked: false };
    const node = type === "text" ? { ...base, type, text: text("双击编辑文字", "Double-click to edit"), style: { fontFamily: content.theme.fontFamily, fontRole: "theme", fontSize: 48, fontWeight: "normal", fontStyle: "normal", align: "left", verticalAlign: "top", lineHeight: 1.2, letterSpacing: 0, fill: content.theme.primary, fillRole: "primary" } }
      : { ...base, type, shape, fill: content.theme.accent, fillRole: "accent", stroke: "#00000000", strokeRole: "custom", strokeWidth: 0, radius: 0 };
    if (apply([{ op: "insertNode", pageId: page.id, node }]) !== false) setSelected(id);
  }
  function duplicatePage() {
    const suffix = text("副本", "copy");
    const id = requestKey();
    if (apply(latest => {
      const index = latest.pages.findIndex(item => item.id === page.id), currentPage = latest.pages[index];
      return [{ op: "insertPage", page: { ...currentPage, id, title: `${currentPage.title.slice(0, 159 - suffix.length)} ${suffix}`, nodes: currentPage.nodes.map(node => ({ ...node, id: requestKey() })) }, index: index + 1 }];
    }) !== false) selectPage(id);
  }
  function chooseImage(items) {
    const item = items[0], targetPage = content.pages.find(item => item.id === picker?.pageId);
    if (readOnly || !item || !targetPage) throw new Error(text("画板已变化，请关闭素材库后重试。", "The page changed. Close the asset picker and try again."));
    let operation, nodeId;
    if (picker.nodeId) {
      const target = targetPage.nodes.find(node => node.id === picker.nodeId);
      if (!target || target.type !== "image" || target.locked) throw new Error(text("原图片已移除或锁定，请重新选择。", "The original image was removed or locked. Select it again."));
      nodeId = target.id;
      // Preserve the frame, rotation, layer order and ID for chat references.
      operation = { op: "replaceImage", pageId: targetPage.id, nodeId, assetId: item.assetId, alt: item.name.slice(0, 1000) };
    } else {
      nodeId = requestKey();
      const iw = Math.max(1, item.asset?.width || 800), ih = Math.max(1, item.asset?.height || 800);
      const scale = Math.min(targetPage.width * .8 / iw, targetPage.height * .8 / ih, 1);
      const width = Math.max(1, iw * scale), height = Math.max(1, ih * scale);
      operation = { op: "insertNode", pageId: targetPage.id, node: {
        id: nodeId, type: "image", name: item.name.slice(0, 160), assetId: item.assetId, alt: item.name.slice(0, 1000), fit: "contain",
        x: (targetPage.width - width) / 2, y: (targetPage.height - height) / 2, width, height,
        rotation: 0, opacity: 1, visible: true, locked: false,
      } };
    }
    if (apply([operation]) === false) throw new Error(text("图片未能插入，请检查保存状态后重试。", "Could not apply the image. Check the save status and retry."));
    setPageId(targetPage.id); setSelected(nodeId); setPicker(null);
  }
  if (presentation) return <Presentation content={presentation.content} startPageId={presentation.startPageId} onClose={endPresentation} zh={zh} />;
  return <div className="cw-layout-editor">
    <div className="cw-editor-tools" role="toolbar" aria-label={text("作品编辑工具", "Artwork tools")}>
      <button aria-label={text("作品属性", "Artwork properties")} title={text("作品属性与图层", "Properties and layers")} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><SlidersHorizontal size={16} /></button>
      <button title={text("撤销", "Undo")} aria-label={text("撤销", "Undo")} disabled={!canUndo || readOnly} onClick={() => afterText(onUndo)}><Undo2 size={16} /></button>
      <button title={text("重做", "Redo")} aria-label={text("重做", "Redo")} disabled={!canRedo || readOnly} onClick={() => afterText(onRedo)}><Redo2 size={16} /></button>
      <span className="cw-tool-divider" />
      <button disabled={readOnly} onClick={() => add("text")}><Type size={16} />{text("文字", "Text")}</button>
      <button disabled={readOnly || page.nodes.length >= 500} onClick={() => setPicker({ pageId: page.id })}><ImagePlus size={16} />{text("图片", "Image")}</button>
      <button disabled={readOnly} onClick={() => add("shape", "rectangle")}><Square size={16} />{text("矩形", "Rectangle")}</button>
      <button disabled={readOnly} onClick={() => add("shape", "ellipse")}><Circle size={16} />{text("圆形", "Ellipse")}</button>
      <button disabled={readOnly} onClick={() => setThemeOpen(true)}>{text("主题", "Theme")}</button>
      <button disabled={readOnly || !onReference} onClick={() => afterText(() => onReference({ pageId: page.id, label: page.title }))}><MessageSquarePlus size={15} />{text("对话修改本页", "Edit page with AI")}</button>
      <span className="cw-tool-spacer" />
      {content.kind === "slides" && <button disabled={readOnly || !onFlush || !content.pages.some(item => !item.hidden)} onClick={present}><Play size={15} />{text(preparing ? "正在保存…" : "演示", preparing ? "Saving…" : "Present")}</button>}
      <button aria-label={text("缩小", "Zoom out")} onClick={() => setZoom(value => Math.max(.25, value - .25))}><Minus size={15} /></button>
      <button onClick={() => setZoom(1)} title={text("适应画布", "Fit canvas")}>{Math.round(zoom * 100)}%</button>
      <button aria-label={text("放大", "Zoom in")} onClick={() => setZoom(value => Math.min(3, value + .25))}><Plus size={15} /></button>
    </div>
    <div className="cw-editor-body">
      {content.kind === "slides" && <SlideNavigator pages={content.pages} selectedId={page.id} onSelect={selectPage} zh={zh}>
        <button disabled={readOnly || content.pages.length >= 100} onClick={() => {
          const id = requestKey();
          if (apply([{ op: "insertPage", page: { ...page, id, title: text("新页面", "New slide"), notes: "", background: content.theme.background, backgroundRole: "background", hidden: false, nodes: [] } }]) !== false) selectPage(id);
        }}><Plus size={15} />{text("添加页面", "Add slide")}</button>
        <button disabled={readOnly || content.pages.length >= 100} onClick={duplicatePage}><Copy size={15} />{text("复制当前页", "Duplicate")}</button>
      </SlideNavigator>}
      <Canvas page={page} selectedId={selectedId} onSelect={selectObject} onOperations={apply} onCommitText={commitText} controllerRef={canvas} onPendingChange={onPendingChange} onDraftChange={onDraftChange} onError={onError} zoom={zoom} readOnly={readOnly} />
      {inspectorOpen && <aside className="cw-inspector" aria-label={text("作品属性", "Artwork properties")}>
        <header><span>{selected ? selected.name : text("画板", "Page")}</span><button aria-label={text("收起作品属性", "Close properties")} onClick={() => setInspectorOpen(false)}><X size={15} /></button></header>
        {selected ? <>
          <button className="cw-reference-button" onClick={() => afterText(() => onReference?.({ pageId: page.id, nodeId: selected.id, label: selected.name }))}><MessageSquarePlus size={15} />{text("引用到对话修改", "Reference in chat")}</button>
          <div className="cw-field-grid">
            {["x", "y", "width", "height", "rotation"].map(key => <NumberField key={key} label={{ x: "X", y: "Y", width: text("宽", "Width"), height: text("高", "Height"), rotation: text("旋转", "Rotation") }[key]} value={selected[key]} disabled={readOnly || selected.locked} min={["width", "height"].includes(key) ? 1 : key === "rotation" ? -360 : -32768} max={["width", "height"].includes(key) ? 8192 : key === "rotation" ? 360 : 32768} onChange={value => setNode({ [key]: value })} />)}
          </div>
          <NumberField label={text("对象不透明度 %", "Object opacity %")} value={selected.opacity * 100} min={0} max={100} disabled={readOnly || selected.locked} onChange={value => setNode({ opacity: value / 100 })} />
          <div className="cw-object-actions" role="group" aria-label={text("相对画板对齐对象框", "Align object frame to page")}>
            {[["left", "左对齐", "Left"], ["center", "水平居中", "Center"], ["right", "右对齐", "Right"], ["top", "顶部对齐", "Top"], ["middle", "垂直居中", "Middle"], ["bottom", "底部对齐", "Bottom"]].map(([alignment, cn, en]) => <button key={alignment} disabled={readOnly || selected.locked} onClick={() => setNode(alignNodeToPage(selected, page, alignment))}>{text(cn, en)}</button>)}
          </div>
          <ObjectStyles node={selected} pageId={page.id} apply={apply} disabled={readOnly || selected.locked} onReplaceImage={() => setPicker({ pageId: page.id, nodeId: selected.id })} zh={zh} />
          <div className="cw-object-actions">
            <button disabled={readOnly || selected.locked || page.nodes.length >= 500} onClick={duplicateSelected}><Copy size={15} />{text("复制对象", "Duplicate object")}</button>
            <button disabled={readOnly} onClick={() => setNode({ locked: !selected.locked })}>{selected.locked ? <Unlock size={15} /> : <Lock size={15} />}{text(selected.locked ? "解锁" : "锁定", selected.locked ? "Unlock" : "Lock")}</button>
            <button disabled={readOnly || selected.locked || selectedIndex === page.nodes.length - 1} onClick={() => apply([{ op: "reorderNode", pageId: page.id, nodeId: selected.id, index: selectedIndex + 1 }])}><ArrowUp size={15} />{text("上移一层", "Forward")}</button>
            <button disabled={readOnly || selected.locked || selectedIndex === 0} onClick={() => apply([{ op: "reorderNode", pageId: page.id, nodeId: selected.id, index: selectedIndex - 1 }])}><ArrowDown size={15} />{text("下移一层", "Backward")}</button>
            <button disabled={readOnly || selected.locked} onClick={() => { if (apply([{ op: "removeNode", pageId: page.id, nodeId: selected.id }]) !== false) setSelected(null); }}><Trash2 size={15} />{text("删除", "Delete")}</button>
          </div>
        </> : <>
          <div className="cw-field-grid"><NumberField label={text("宽", "Width")} value={page.width} min={1} max={8192} disabled={readOnly} onChange={width => apply([{ op: "setPage", pageId: page.id, changes: { width } }])} /><NumberField label={text("高", "Height")} value={page.height} min={1} max={8192} disabled={readOnly} onChange={height => apply([{ op: "setPage", pageId: page.id, changes: { height } }])} /></div>
          <label>{text("页面标题", "Page title")}<input value={page.title} maxLength={160} disabled={readOnly} onChange={event => apply([{ op: "setPage", pageId: page.id, changes: { title: event.target.value } }])} /></label>
          <label>{text("背景", "Background")}<input type="color" value={page.background.slice(0, 7)} disabled={readOnly} onChange={event => apply([{ op: "setPage", pageId: page.id, changes: { background: event.target.value } }])} /></label>
          <ThemeRoleField label={text("背景配色来源", "Background color source")} value={page.backgroundRole} disabled={readOnly} zh={zh} onChange={backgroundRole => apply([{ op: "setPage", pageId: page.id, changes: { backgroundRole } }])} />
          {content.kind === "slides" && <>
            <button disabled={readOnly} aria-pressed={page.hidden} onClick={() => apply([{ op: "setPage", pageId: page.id, changes: { hidden: !page.hidden } }])}>{page.hidden ? <Eye size={15} /> : <EyeOff size={15} />}{text(page.hidden ? "恢复演示此页" : "演示时隐藏此页", page.hidden ? "Show in presentation" : "Hide in presentation")}</button>
            <label>{text("演讲备注", "Speaker notes")}<textarea value={page.notes} disabled={readOnly} maxLength={16000} onChange={event => apply([{ op: "setPage", pageId: page.id, changes: { notes: event.target.value } }])} /></label>
            <button disabled={readOnly || content.pages.indexOf(page) === 0} onClick={() => apply([{ op: "reorderPage", pageId: page.id, index: content.pages.indexOf(page) - 1 }])}>{text("页面前移", "Move slide up")}</button>
            <button disabled={readOnly || content.pages.indexOf(page) === content.pages.length - 1} onClick={() => apply([{ op: "reorderPage", pageId: page.id, index: content.pages.indexOf(page) + 1 }])}>{text("页面后移", "Move slide down")}</button>
            <button disabled={readOnly || content.pages.length === 1} onClick={() => apply([{ op: "removePage", pageId: page.id }])}>{text("删除页面", "Delete slide")}</button>
          </>}
        </>}
        <details open={layersOpen} onToggle={event => setLayersOpen(event.currentTarget.open)}><summary>{text("图层", "Layers")} · {page.nodes.length}</summary>{layersOpen && page.nodes.toReversed().map(node => <button className={node.id === selectedId ? "is-selected" : ""} key={node.id} onClick={() => selectObject(node.id)}>{node.locked && <Lock size={12} />}{node.name}</button>)}</details>
        {issues.length > 0 && <details><summary>{text("排版检查", "Layout checks")} · {issues.length}</summary>{issues.slice(0, 10).map((issue, index) => <p key={index}>{issueLabels[issue.code]?.[zh ? 0 : 1] || text("请检查此对象的排版", "Check this object's layout")}{issue.nodeId && `：${page.nodes.find(node => node.id === issue.nodeId)?.name || text("未命名对象", "Untitled object")}`}</p>)}</details>}
      </aside>}
    </div>
    {themeOpen && <ThemeDialog theme={content.theme} pageCount={content.pages.length} readOnly={readOnly} zh={zh} onClose={() => setThemeOpen(false)} onApply={theme => {
      if (apply(latest => [createThemeOperation(latest, theme)]) !== false) setThemeOpen(false);
    }} />}
    {picker && !readOnly && <Modal label={text(picker.nodeId ? "替换图片" : "插入图片", picker.nodeId ? "Replace image" : "Insert image")} className="cw-asset-dialog" onClose={() => setPicker(null)}>
      <header><strong>{text(picker.nodeId ? "替换图片" : "插入图片", picker.nodeId ? "Replace image" : "Insert image")}</strong><button aria-label={text("关闭素材库", "Close assets")} onClick={() => setPicker(null)}><X size={18} /></button></header>
      <AssetLibrary maxSelection={1} onSelect={chooseImage} />
    </Modal>}
  </div>;
}
