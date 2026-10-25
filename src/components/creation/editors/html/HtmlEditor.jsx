"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Undo2, Redo2, Type, Square, ImagePlus, Trash2, Copy, SlidersHorizontal, MessageSquarePlus, Code, X, Plus, Play } from "lucide-react";
import { groupHtmlNodes, ungroupHtmlNode, alignHtmlNodes, inspectRenderedHtml } from "@/lib/creation/html/dom-edit";
import { inspectHtml } from "@/lib/creation/html/document";
import { projectHtml } from "@/lib/creation/html/projection";
import { loadWebPreviewAssets } from "@/lib/creation/client/web-preview-assets";
import { requestKey } from "@/lib/client-api";
import Modal from "@/components/ui/Modal";
import "./html-editor.css";

const ThemeDialog = dynamic(() => import("../layout/ThemeDialog"));
const HtmlDataDialog = dynamic(() => import("./HtmlDataDialog"));
const AssetLibrary = dynamic(() => import("@/components/studio/AssetLibrary"));
const key = () => `n_${requestKey()}`;
function sourceDocument(html) { return new DOMParser().parseFromString(html, "text/html"); }
function sourceHtml(doc) { return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`; }
const byId = (doc, id) => doc.querySelector(`[data-node-id="${CSS.escape(id)}"]`);

export default function HtmlEditor({ content, getContent, controllerRef, onOperations, onUndo, onRedo, canUndo, canRedo, onReference, onError, onDraftChange, onPendingChange, readOnly, zh = true }) {
  const [pageId, setPageId] = useState(content.pages[0].id), [selection, setSelection] = useState([]), [inspector, setInspector] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false), [source, setSource] = useState("");
  const [picker, setPicker] = useState(false), [presenting, setPresenting] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false), [masterOpen, setMasterOpen] = useState(false), [masterCss, setMasterCss] = useState(""), [masterHtml, setMasterHtml] = useState("");
  const [projection, setProjection] = useState(null), [fault, setFault] = useState(null), [size, setSize] = useState({ width: 800, height: 600 });
  const [autoHeight, setAutoHeight] = useState(720);
  const [issues, setIssues] = useState([]);
  const [dataEdit, setDataEdit] = useState(null);
  const host = useRef(null), frame = useRef(null), pending = useRef(null), clean = useRef(null), latest = useRef(null);
  const page = content.pages.find(item => item.id === pageId) || content.pages[0];
  const text = (cn, en) => zh ? cn : en;
  useLayoutEffect(() => { latest.current = { page, readOnly: readOnly || presenting, selection, sourceOpen, source, onOperations, onError, onDraftChange, onPendingChange }; });
  const master = content.masters?.find(item => item.id === page.masterId);
  const theme = content.theme;
  const previewPage = useMemo(() => ({ id: page.id, html: page.html, width: page.width, height: page.height }), [page.id, page.html, page.width, page.height]);
  const apply = useCallback(operations => {
    try { return latest.current.onOperations(operations); } catch (error) { latest.current.onError?.(error); return false; }
  }, []);
  const commitPending = useCallback(() => {
    const draft = pending.current;
    if (!draft) return;
    const current = getContent().pages.find(item => item.id === draft.pageId);
    if (!current || current.html !== draft.base) throw new Error("HTML_SOURCE_CHANGED");
    let html;
    if (draft.source !== undefined) html = inspectHtml(draft.source, { assignIds: true }).html;
    else {
      const doc = sourceDocument(current.html), node = byId(doc, draft.nodeId);
      if (!node) throw new Error("LANGUAGE_SELECTION_CHANGED");
      node.textContent = draft.text; html = sourceHtml(doc);
    }
    if (apply([{ op: "setHtmlPage", pageId: draft.pageId, html }]) === false) throw new Error("HTML_EDIT_NOT_COMMITTED");
    pending.current = null; latest.current.onDraftChange?.(null); latest.current.onPendingChange?.(false);
  }, [getContent, apply]);
  useImperativeHandle(controllerRef, () => ({ commitPending, getPendingText: () => pending.current?.recovery || null, discardPending: () => { pending.current = null; latest.current.onDraftChange?.(null); latest.current.onPendingChange?.(false); } }), [commitPending]);
  useEffect(() => {
    const warn = event => { if (pending.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const r = entries[0].contentRect; setSize(old => Math.abs(old.width - r.width) < 1 && Math.abs(old.height - r.height) < 1 ? old : { width: r.width, height: r.height }); });
    if (host.current) observer.observe(host.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const parsed = inspectHtml(previewPage.html), masterAssets = master ? inspectHtml(`<style>${master.css}</style>${master.html}<span>master</span>`).assets : [];
        const images = await loadWebPreviewAssets([...new Set([...parsed.assets, ...masterAssets])], { signal: controller.signal });
        if (!controller.signal.aborted) { setFault(null); setProjection({ id: previewPage.id, html: previewPage.html, value: projectHtml(previewPage, images, { theme, master }) }); }
      } catch (error) { if (!controller.signal.aborted) { setFault(error); onError?.(error); } }
    })();
    return () => controller.abort();
  }, [previewPage, onError, theme, master]);
  useEffect(() => () => clean.current?.(), []);
  useEffect(() => {
    if (!presenting) return;
    const keydown = event => {
      if (event.key === "Escape") { setPresenting(false); return; }
      const visible = content.pages.filter(p => !p.hidden), index = visible.findIndex(p => p.id === pageId);
      if (["ArrowRight", "PageDown", " "].includes(event.key)) { event.preventDefault(); setPageId(visible[Math.min(visible.length - 1, index + 1)]?.id || pageId); }
      if (["ArrowLeft", "PageUp"].includes(event.key)) { event.preventDefault(); setPageId(visible[Math.max(0, index - 1)]?.id || pageId); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [presenting, content.pages, pageId]);

  const stageDraft = useCallback(draft => {
    const current = latest.current.page;
    const original = draft.source !== undefined ? current.html : byId(sourceDocument(current.html), draft.nodeId)?.textContent;
    const recovery = draft.source !== undefined ? { format: "html-source", pageId: draft.pageId, original, text: draft.source } : { pageId: draft.pageId, nodeId: draft.nodeId, original, text: draft.text, composing: false };
    latest.current.onDraftChange?.(recovery); latest.current.onPendingChange?.(true);
    pending.current = { ...draft, recovery };
  }, []);
  const edit = useCallback(mutator => {
    if (latest.current.readOnly) return false;
    try {
      commitPending();
      const current = getContent().pages.find(item => item.id === latest.current.page.id), doc = sourceDocument(current.html);
      mutator(doc, latest.current.selection);
      const html = inspectHtml(sourceHtml(doc), { assignIds: true }).html;
      return apply([{ op: "setHtmlPage", pageId: current.id, html }]);
    } catch (error) { latest.current.onError?.(error); return false; }
  }, [apply, getContent, commitPending]);
  const loaded = useCallback(() => {
    clean.current?.();
    const doc = frame.current?.contentDocument; if (!doc) return;
    setAutoHeight(Math.min(8192, Math.max(720, doc.body.scrollHeight)));
    const currentPage = latest.current.page;
    setIssues(inspectRenderedHtml(doc, currentPage.width, currentPage.height === "auto" ? doc.body.scrollHeight : currentPage.height));
    // The iframe is same-origin ONLY for DOM editing; sandbox never allows scripts.
    let drag = null;
    const select = event => {
      if (event.target.closest("a")) event.preventDefault();
      if (latest.current.readOnly || presenting) return;
      const element = event.target.closest("[data-node-id]"); if (!element) { setSelection([]); return; }
      if (element.isContentEditable || element.closest("[data-cw-master]")) return;
      event.preventDefault();
      const id = element.dataset.nodeId;
      setSelection(current => event.shiftKey ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id]);
      const style = doc.defaultView.getComputedStyle(element);
      if (!event.shiftKey) drag = { id, x: event.clientX, y: event.clientY, left: parseFloat(style.left) || 0, top: parseFloat(style.top) || 0, position: style.position, element, moved: false, transform: element.style.transform };
    };
    const move = event => {
      if (!drag || !event.buttons || latest.current.readOnly) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true; drag.dx = dx; drag.dy = dy;
      drag.element.style.transform = `${drag.transform} translate(${dx}px,${dy}px)`;
    };
    const up = () => {
      const ended = drag; drag = null; if (!ended) return;
      ended.element.style.transform = ended.transform;
      if (!ended.moved) return;
      edit(doc => {
        const node = byId(doc, ended.id); if (!node) return;
        if (["absolute", "fixed"].includes(ended.position)) { node.style.left = `${ended.left + ended.dx}px`; node.style.top = `${ended.top + ended.dy}px`; }
        else { node.style.position = "relative"; node.style.left = `${ended.left + ended.dx}px`; node.style.top = `${ended.top + ended.dy}px`; }
      });
    };
    const double = event => {
      if (latest.current.readOnly || presenting) return;
      const node = event.target.closest("[data-node-id]"); if (!node || node.children.length || ["IMG", "SVG", "PATH"].includes(node.tagName)) return;
      node.contentEditable = "plaintext-only"; node.focus();
    };
    const input = event => {
      const node = event.target.closest("[contenteditable]"); if (!node) return;
      const current = latest.current.page;
      stageDraft({ pageId: current.id, base: current.html, nodeId: node.dataset.nodeId, text: node.textContent });
    };
    const blur = event => {
      const node = event.target.closest("[contenteditable]"); if (!node) return;
      node.removeAttribute("contenteditable");
      try { commitPending(); } catch (error) { latest.current.onError?.(error); }
    };
    doc.addEventListener("pointerdown", select); doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", up); doc.addEventListener("dblclick", double); doc.addEventListener("input", input); doc.addEventListener("focusout", blur);
    clean.current = () => { doc.removeEventListener("pointerdown", select); doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); doc.removeEventListener("dblclick", double); doc.removeEventListener("input", input); doc.removeEventListener("focusout", blur); };
  }, [edit, commitPending, presenting, stageDraft]);
  useEffect(() => {
    const doc = frame.current?.contentDocument; if (!doc) return;
    doc.querySelectorAll("[data-cw-selected]").forEach(node => { node.removeAttribute("data-cw-selected"); node.style.outline = node.dataset.cwOutline || ""; delete node.dataset.cwOutline; });
    for (const id of selection) { const node = byId(doc, id); if (node) { node.dataset.cwOutline = node.style.outline; node.dataset.cwSelected = "true"; node.style.outline = "2px solid #6759ed"; } }
  }, [selection, projection]);
  const selected = useMemo(() => { try { const doc = sourceDocument(page.html); return selection[0] ? byId(doc, selection[0]) : null; } catch { return null; } }, [page.html, selection]);
  const style = (name, value) => edit((doc, ids) => ids.forEach(id => { const node = byId(doc, id); if (node) node.style[name] = value; }));
  const add = (tag, label) => edit(doc => { const node = doc.createElement(tag); node.dataset.nodeId = key(); node.textContent = label; node.style.cssText = tag === "div" ? "width:160px;height:100px;background:#7868e6;position:absolute;left:60px;top:60px" : "font-size:48px;position:absolute;left:60px;top:60px"; doc.body.append(node); setSelection([node.dataset.nodeId]); });
  function selectPage(id) { try { commitPending(); setPageId(id); setSelection([]); setSourceOpen(false); } catch (error) { onError?.(error); } }
  function openSource() { try { commitPending(); setSource(getContent().pages.find(p => p.id === page.id).html); setSourceOpen(true); } catch (error) { onError?.(error); } }
  const pageHeight = page.height === "auto" ? autoHeight : page.height;
  const scale = Math.min(Math.max(0.05, (size.width - 24) / page.width), Math.max(0.05, (size.height - 24) / pageHeight), 1);
  const current = projection?.id === page.id && projection.html === page.html;
  return <div className={`cw-html-editor${presenting ? " is-presenting" : ""}`}>
    {dataEdit && <HtmlDataDialog {...dataEdit} zh={zh} onClose={() => setDataEdit(null)} onApply={html => { if (edit(doc => { const node = sourceDocument(html).body.firstElementChild; node.dataset.nodeId ||= key(); if (dataEdit.id) { const target = byId(doc, dataEdit.id); if (!target) throw new Error("LANGUAGE_SELECTION_CHANGED"); target.replaceWith(node); } else doc.body.append(node); }) !== false) setDataEdit(null); }} />}
    <div className="cw-html-tools">
      <button disabled={readOnly || !canUndo} title={text("撤销", "Undo")} onClick={() => { commitPending(); onUndo(); }}><Undo2 size={16} /></button>
      <button disabled={readOnly || !canRedo} title={text("重做", "Redo")} onClick={() => { commitPending(); onRedo(); }}><Redo2 size={16} /></button>
      <button disabled={readOnly} onClick={() => add("p", text("添加文字", "Your text"))}><Type size={16} />{text("文字", "Text")}</button>
      <button disabled={readOnly} onClick={() => add("div", "")}><Square size={16} />{text("形状", "Shape")}</button>
      <button disabled={readOnly} onClick={() => setPicker(true)}><ImagePlus size={16} />{text("图片", "Image")}</button>
      <button disabled={readOnly} onClick={() => { commitPending(); const table = selected?.closest("table"); setDataEdit({ kind: "table", id: table?.dataset.nodeId, html: table?.outerHTML }); }}>{text("表格", "Table")}</button>
      <button disabled={readOnly} onClick={() => { commitPending(); const chart = selected?.closest("[data-chart]"); setDataEdit({ kind: "chart", id: chart?.dataset.nodeId, html: chart?.outerHTML }); }}>{text("图表", "Chart")}</button>
      <button disabled={!selection.length || readOnly} onClick={() => edit((doc, ids) => ids.forEach(id => { const node = byId(doc, id); if (!node) return; const clone = node.cloneNode(true); [clone, ...clone.querySelectorAll("[data-node-id]")].forEach(n => { n.dataset.nodeId = key(); }); node.after(clone); }))}><Copy size={16} /><span className="sr-only">{text("复制对象", "Duplicate object")}</span></button>
      <button disabled={!selection.length || readOnly} onClick={() => { if (edit((doc, ids) => ids.forEach(id => byId(doc, id)?.remove())) !== false) setSelection([]); }}><Trash2 size={16} /><span className="sr-only">{text("删除对象", "Delete object")}</span></button>
      <button onClick={() => { commitPending(); onReference?.({ pageId: page.id, nodeId: selection[0] || null, nodeIds: selection, label: selected?.textContent?.slice(0, 40) || page.title || text("当前页面", "Current page") }); }}><MessageSquarePlus size={16} />{text("引用修改", "Ask AI")}</button>
      <span className="cw-html-spacer" />
      <button disabled={readOnly} onClick={() => { commitPending(); setThemeOpen(true); }}>{text("主题", "Theme")}</button>
      {content.kind === "slides" && <button disabled={readOnly} onClick={() => { commitPending(); setMasterCss(master?.css || ""); setMasterHtml(master?.html || ""); setMasterOpen(true); }}>{text("母版", "Master")}</button>}
      <button onClick={openSource}><Code size={16} />HTML</button>
      {content.kind === "slides" && <button onClick={() => { commitPending(); setPresenting(value => !value); }}><Play size={16} />{text(presenting ? "退出演示" : "演示", presenting ? "Exit" : "Present")}</button>}
      <button aria-pressed={inspector} onClick={() => setInspector(value => !value)}><SlidersHorizontal size={16} /><span className="sr-only">{text("属性", "Properties")}</span></button>
    </div>
    <div className="cw-html-body">
      {content.kind === "slides" && <nav className="cw-html-pages" aria-label={text("幻灯片", "Slides")}>
        {content.pages.map((item, index) => <button key={item.id} aria-current={item.id === page.id} onClick={() => selectPage(item.id)}><b>{index + 1}</b><span>{item.title || text("幻灯片", "Slide")}</span></button>)}
        <button disabled={readOnly} onClick={() => { commitPending(); const id = key(); apply([{ op: "insertHtmlPage", index: content.pages.length, page: { ...page, id, title: text("新页面", "New slide"), html: '<!DOCTYPE html><html><head><style>body{margin:0;background:#fff;font-family:sans-serif}h1{padding:64px}</style></head><body><h1 data-node-id="title">新页面</h1></body></html>' } }]); setPageId(id); }}><Plus size={15} /></button>
      </nav>}
      <div className="cw-html-stage" ref={host}>
        {current ? <div style={{ width: page.width * scale, height: pageHeight * scale }}><iframe ref={frame} title={text("可编辑作品", "Editable artwork")} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={projection.value} onLoad={loaded} style={{ width: page.width, height: pageHeight, transform: `scale(${scale})`, transformOrigin: "top left" }} /></div> : <p role={fault ? "alert" : "status"}>{fault ? text("作品预览失败，请重试打开。", "Preview failed. Reopen to retry.") : text("正在打开作品…", "Opening artwork…")}</p>}
      </div>
      {inspector && <aside className="cw-html-inspector">
        <header><strong>{text("属性", "Properties")}</strong><button aria-label={text("关闭属性", "Close properties")} onClick={() => setInspector(false)}><X size={14} /></button></header>
        {selected ? <>
          {!selected.children.length && selected.tagName !== "IMG" && <label>{text("文字", "Text")}<textarea key={`${page.id}:${selection[0]}:${page.html.length}`} defaultValue={selected.textContent} disabled={readOnly} onChange={e => { stageDraft({ pageId: page.id, base: page.html, nodeId: selection[0], text: e.target.value }); }} onBlur={() => { try { commitPending(); } catch (error) { onError?.(error); } }} /></label>}
          <label>{text("字号", "Font size")}<input type="number" min="6" max="512" disabled={readOnly} defaultValue={parseFloat(selected.style.fontSize) || 32} key={`font:${selection[0]}`} onBlur={e => style("fontSize", `${Math.max(6, Math.min(512, Number(e.target.value) || 32))}px`)} /></label>
          <label>{text("文字颜色", "Text color")}<input type="color" disabled={readOnly} onChange={e => style("color", e.target.value)} /></label>
          <label>{text("背景颜色", "Background")}<input type="color" disabled={readOnly} onChange={e => style("backgroundColor", e.target.value)} /></label>
          <label>{text("对齐", "Alignment")}<select disabled={readOnly} value={selected.style.textAlign || "left"} onChange={e => style("textAlign", e.target.value)}><option value="left">{text("左", "Left")}</option><option value="center">{text("中", "Center")}</option><option value="right">{text("右", "Right")}</option></select></label>
          <label>{text("宽度", "Width")}<input key={`width:${selection[0]}`} type="number" min="1" max="8192" defaultValue={parseFloat(selected.style.width) || 200} disabled={readOnly} onBlur={e => style("width", `${Math.max(1, Math.min(8192, Number(e.target.value) || 200))}px`)} /></label>
          <label>{text("旋转", "Rotation")}<input type="number" min="-360" max="360" disabled={readOnly} onBlur={e => style("rotate", `${Math.max(-360, Math.min(360, Number(e.target.value) || 0))}deg`)} /></label>
          {selected.tagName === "IMG" && <><button disabled={readOnly} onClick={() => setPicker(true)}>{text("替换图片", "Replace image")}</button><select disabled={readOnly} onChange={e => style("objectFit", e.target.value)} defaultValue={selected.style.objectFit || "cover"}><option value="cover">{text("填充", "Cover")}</option><option value="contain">{text("完整显示", "Contain")}</option></select></>}
          <button disabled={readOnly} onClick={() => edit((doc, ids) => ids.forEach(id => { const node = byId(doc, id); if (node) node.parentElement.append(node); }))}>{text("置于顶层", "Bring forward")}</button>
          <button disabled={readOnly} onClick={() => edit((doc, ids) => ids.forEach(id => { const node = byId(doc, id); if (node) node.parentElement.prepend(node); }))}>{text("置于底层", "Send backward")}</button>
          <label>{text("高度", "Height")}<input key={`height:${selection[0]}`} type="number" min="1" max="8192" defaultValue={parseFloat(selected.style.height) || 100} disabled={readOnly} onBlur={e => style("height", `${Math.max(1, Math.min(8192, Number(e.target.value) || 100))}px`)} /></label>
          <label>{text("圆角", "Corner radius")}<input type="number" min="0" max="4096" disabled={readOnly} onBlur={e => style("borderRadius", `${Math.max(0, Math.min(4096, Number(e.target.value) || 0))}px`)} /></label>
          <label>{text("描边", "Border")}<input type="color" disabled={readOnly} onChange={e => style("border", `2px solid ${e.target.value}`)} /></label>
          <label>{text("不透明度", "Opacity")}<input type="range" min="0" max="1" step="0.05" defaultValue={selected.style.opacity || 1} disabled={readOnly} onPointerUp={e => style("opacity", e.target.value)} /></label>
          <label>{text("对齐对象", "Align objects")}<select value="" disabled={readOnly} onChange={e => edit((doc, ids) => alignHtmlNodes(doc, frame.current.contentDocument, ids, e.target.value))}><option value="">{text("选择对齐方式", "Choose alignment")}</option>{[["left","左侧"],["center","水平居中"],["right","右侧"],["top","顶部"],["middle","垂直居中"],["bottom","底部"]].map(([value,label]) => <option key={value} value={value}>{zh ? label : value}</option>)}</select></label>
          <button disabled={readOnly || selection.length < 2} onClick={() => { const id = key(); if (edit((doc, ids) => groupHtmlNodes(doc, ids, id)) !== false) setSelection([id]); }}>{text("组合", "Group")}</button>
          <button disabled={readOnly || selected.dataset.group !== "true"} onClick={() => { if (edit(doc => ungroupHtmlNode(doc, selection[0])) !== false) setSelection([]); }}>{text("取消组合", "Ungroup")}</button>

        </> : <p>{text("点击作品中的文字、图片或形状。双击文字直接编辑。", "Select text, an image or a shape. Double-click text to edit.")}</p>}
        <details><summary>{text("图层", "Layers")}</summary>{[...inspectHtml(page.html).ids.entries()].slice(0, 150).map(([id, node]) => <button key={id} onClick={() => setSelection([id])}>{node.tagName} · {id}</button>)}</details>
        {issues.length > 0 && <details><summary>{text("排版检查", "Layout checks")} · {issues.length}</summary>{issues.map((issue, index) => <button key={index} onClick={() => setSelection([issue.id])}>{text(issue.code === "HTML_OUTSIDE_PAGE" ? "内容超出页面" : issue.code === "HTML_TEXT_OVERFLOW" ? "文字可能被截断" : "图片未加载", issue.code)} · {issue.id}</button>)}</details>}
        {content.kind === "slides" && <>
          <button disabled={readOnly} onClick={() => { commitPending(); const id = key(); if (apply([{ op: "insertHtmlPage", index: content.pages.indexOf(page) + 1, page: { ...page, id, title: `${page.title.slice(0, 145)} ${text("副本", "copy")}` } }]) !== false) selectPage(id); }}>{text("复制页面", "Duplicate slide")}</button>
          <button disabled={readOnly || content.pages.indexOf(page) === 0} onClick={() => { commitPending(); apply([{ op: "reorderHtmlPage", pageId: page.id, index: content.pages.indexOf(page) - 1 }]); }}>{text("页面前移", "Move slide up")}</button>
          <button disabled={readOnly || content.pages.indexOf(page) === content.pages.length - 1} onClick={() => { commitPending(); apply([{ op: "reorderHtmlPage", pageId: page.id, index: content.pages.indexOf(page) + 1 }]); }}>{text("页面后移", "Move slide down")}</button>
          <button disabled={readOnly} aria-pressed={page.hidden} onClick={() => apply([{ op: "setHtmlPageMeta", pageId: page.id, changes: { hidden: !page.hidden } }])}>{text(page.hidden ? "恢复演示此页" : "演示隐藏此页", page.hidden ? "Show slide" : "Hide slide")}</button>
        </>}
        {content.kind === "slides" && <><label>{text("备注", "Notes")}<textarea key={page.id} defaultValue={page.notes} disabled={readOnly} onBlur={e => apply([{ op: "setHtmlPageMeta", pageId: page.id, changes: { notes: e.target.value } }])} /></label><button disabled={readOnly || content.pages.length < 2} onClick={() => { commitPending(); apply([{ op: "removeHtmlPage", pageId: page.id }]); }}>{text("删除页面", "Delete slide")}</button></>}
      </aside>}
    </div>
    {themeOpen && <ThemeDialog theme={content.theme} pageCount={content.pages.length} readOnly={readOnly} zh={zh} onClose={() => setThemeOpen(false)} onApply={theme => { if (apply([{ op: "setHtmlTheme", theme }]) !== false) setThemeOpen(false); }} />}
    {masterOpen && <Modal label={text("共享母版", "Shared master")} className="cw-html-source" onClose={() => setMasterOpen(false)}><header><strong>{text("共享母版", "Shared master")}</strong><button onClick={() => setMasterOpen(false)}><X size={16} /></button></header><p>{text("公共样式和页眉页脚应用到引用此母版的页面；页面自身样式保留。", "Shared styles and headers/footers apply to linked slides. Page overrides are retained.")}</p><label>CSS</label><textarea aria-label="Master CSS" value={masterCss} onChange={e => setMasterCss(e.target.value)} /><label>HTML</label><textarea aria-label="Master HTML" value={masterHtml} onChange={e => setMasterHtml(e.target.value)} /><button onClick={() => { const value = { id: master?.id || key(), name: master?.name || "Default", version: (master?.version || 0) + 1, css: masterCss, html: masterHtml }; const masters = [...(content.masters || []).filter(m => m.id !== value.id), value]; if (apply([{ op: "setHtmlMasters", masters }, ...content.pages.map(p => ({ op: "bindHtmlMaster", pageId: p.id, masterId: value.id }))]) !== false) setMasterOpen(false); }}>{text("应用到全部页面", "Apply to all slides")}</button></Modal>}
    {sourceOpen && <Modal label="HTML" className="cw-html-source" onClose={() => { try { commitPending(); setSourceOpen(false); } catch (error) { onError?.(error); } }}><header><strong>HTML</strong><button onClick={() => { try { commitPending(); setSourceOpen(false); } catch (error) { onError?.(error); } }}><X size={16} /></button></header><textarea aria-label="HTML" value={source} readOnly={readOnly} onChange={e => { setSource(e.target.value); stageDraft({ pageId: page.id, base: page.html, source: e.target.value }); }} /><button onClick={() => { try { commitPending(); setSourceOpen(false); } catch (error) { onError?.(error); } }}>{text("应用并关闭", "Apply and close")}</button></Modal>}
    {picker && <Modal label={text("选择图片", "Choose image")} className="cw-asset-dialog" onClose={() => setPicker(false)}><AssetLibrary maxSelection={1} onSelect={items => {
      const asset = Array.isArray(items) ? items[0] : items; if (!asset?.id) return;
      if (edit((doc, ids) => { let image = ids[0] ? byId(doc, ids[0]) : null; if (image?.tagName !== "IMG") { image = doc.createElement("img"); image.dataset.nodeId = key(); image.style.cssText = "width:320px;height:320px;object-fit:cover;position:absolute;left:40px;top:40px"; doc.body.append(image); } image.setAttribute("src", `asset:${asset.id}`); image.setAttribute("alt", asset.name || ""); }) !== false) setPicker(false);
    }} /></Modal>}
  </div>;
}
