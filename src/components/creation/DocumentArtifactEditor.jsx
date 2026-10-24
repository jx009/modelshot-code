"use client";

import { lazy, Suspense, useCallback, useImperativeHandle, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, Redo2, Save, Type, Undo2 } from "lucide-react";
import DraftSessionGate from "./DraftSessionGate";
import { useDocumentArtifact } from "./useDocumentArtifact";
import { applyDocumentOperations } from "@/lib/creation/document-operations";
import "./creation.css";

const ExportDialog = lazy(() => import("./ExportDialog"));
const BLOCK_PAGE_SIZE = 24;
const textOf = runs => runs.map(run => run.text).join("");
const leafOf = (block, id) => {
  if (["paragraph", "heading"].includes(block.type)) return block.id === id ? block : null;
  if (block.type === "list") return block.items.find(item => item.id === id) || null;
  if (block.type === "table") return block.rows.flatMap(row => row.cells).find(cell => cell.id === id) || null;
  return null;
};
const editableRuns = runs => !runs.length || runs.every(run => JSON.stringify(run.marks) === JSON.stringify(runs[0].marks));
const identifier = () => crypto.randomUUID().replaceAll("-", "_");

export default function DocumentArtifactEditor({ artifactId, userId, zh = true, editorRef, onError, onReference }) {
  return <DraftSessionGate key={`${userId}:${artifactId}`} userId={userId} artifactId={artifactId} editorRef={editorRef} zh={zh}>
    {draftSessionId => <DocumentSession draftSessionId={draftSessionId} artifactId={artifactId} userId={userId} zh={zh} editorRef={editorRef} onError={onError} onReference={onReference} />}
  </DraftSessionGate>;
}

function DocumentSession({ draftSessionId, artifactId, userId, zh, editorRef, onError, onReference }) {
  const editor = useDocumentArtifact(userId, artifactId, draftSessionId);
  const [sectionIndex, setSectionIndex] = useState(0), [blockPage, setBlockPage] = useState(0), [exportOpen, setExportOpen] = useState(false);
  const text = (cn, en) => zh ? cn : en;
  const flush = editor.flush;
  const applyChange = editor.change;
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  const content = editor.content;
  const section = content?.sections[sectionIndex];
  const visibleBlocks = section?.blocks.slice(blockPage * BLOCK_PAGE_SIZE, (blockPage + 1) * BLOCK_PAGE_SIZE) || [];
  const change = useCallback(operations => {
    try { return applyChange(operations); } catch (error) { onError?.(error); return false; }
  }, [applyChange, onError]);

  function updateText(block, leafId, value) {
    const leaf = leafOf(block, leafId);
    if (!leaf || textOf(leaf.runs) === value) return;
    if (!editableRuns(leaf.runs)) { onError?.(new Error("DOCUMENT_MIXED_FORMAT_EDIT_UNSUPPORTED")); return; }
    const operation = { op: "replaceDocumentText", sectionId: section.id, blockId: block.id, leafId,
      start: 0, end: textOf(leaf.runs).length, expectedText: textOf(leaf.runs), text: value };
    change([operation]);
  }

  function addBlock(type) {
    const block = type === "heading" ? { id: identifier(), type, level: 2, runs: [{ text: "", marks: {} }], style: { align: "left", lineHeight: 1.5, spaceBefore: 0, spaceAfter: 8 }, locked: false }
      : { id: identifier(), type: "paragraph", runs: [{ text: "", marks: {} }], style: { align: "left", lineHeight: 1.5, spaceBefore: 0, spaceAfter: 8 }, locked: false };
    const index = section.blocks.length;
    if (change([{ op: "insertDocumentBlock", sectionId: section.id, block, index }])) setBlockPage(Math.floor(index / BLOCK_PAGE_SIZE));
  }

  if (!content) return <div className="cw-loading" role="status">{text("正在打开文档…", "Opening document…")}</div>;
  return <section className="cw-artifact cw-structured-editor" aria-label={text("文档编辑器", "Document editor")}>
    <header className="cw-artifact-bar"><div><FileText size={15} /><strong>{content.title}</strong><span>V{editor.revision}</span></div>
      <span className="cw-save-state" role="status">{text(editor.status === "saved" ? "已保存" : editor.status === "saving" ? "正在保存…" : editor.status === "local" ? "有未同步修改" : "保存或读取失败", editor.status === "saved" ? "Saved" : editor.status === "saving" ? "Saving…" : editor.status === "local" ? "Unsynced changes" : "Save or load failed")}</span>
      <button disabled={!editor.ready || ["conflict", "copying"].includes(editor.status)} aria-label={text("撤销", "Undo")} title={text("撤销", "Undo")} onClick={editor.undo}><Undo2 size={15} /></button>
      <button disabled={!editor.ready || ["conflict", "copying"].includes(editor.status)} aria-label={text("重做", "Redo")} title={text("重做", "Redo")} onClick={editor.redo}><Redo2 size={15} /></button>
      <button disabled={!editor.ready || ["conflict", "copying"].includes(editor.status)} aria-label={text("保存", "Save")} title={text("保存", "Save")} onClick={() => void flush().catch(onError)}><Save size={15} /></button>
      <button disabled={!editor.ready || ["conflict", "copying"].includes(editor.status)} aria-label={text("导出", "Export")} title={text("导出", "Export")} onClick={() => setExportOpen(true)}><Download size={15} /></button>
    </header>
    <nav className="cw-structured-toolbar" aria-label={text("文档工具", "Document tools")}>
      <label>{text("章节", "Section")}<select value={sectionIndex} onChange={event => { setSectionIndex(Number(event.target.value)); setBlockPage(0); }}>{content.sections.map((item, index) => <option key={item.id} value={index}>{item.title || `${text("章节", "Section")} ${index + 1}`}</option>)}</select></label>
      <button disabled={!editor.ready || section.blocks.length >= 300} onClick={() => addBlock("heading")}><Type size={14} />{text("标题", "Heading")}</button>
      <button disabled={!editor.ready || section.blocks.length >= 300} onClick={() => addBlock("paragraph")}>{text("段落", "Paragraph")}</button>
      <span>{text(`${section.blocks.length} 个内容块`, `${section.blocks.length} blocks`)}</span>
    </nav>
    <main className="cw-document-page">
      <input className="cw-document-title" aria-label={text("文档标题", "Document title")} value={content.title} maxLength={160} disabled={!editor.ready || ["conflict", "copying"].includes(editor.status)} onChange={event => change([{ op: "setDocumentTitle", title: event.target.value || text("未命名文档", "Untitled document") }])} />
      {visibleBlocks.map((block, localIndex) => {
        const index = blockPage * BLOCK_PAGE_SIZE + localIndex;
        const input = (leaf, label) => <textarea key={leaf.id} aria-label={label} rows={Math.min(12, Math.max(2, Math.ceil(textOf(leaf.runs).length / 80)))} value={textOf(leaf.runs)} readOnly={block.locked || !editableRuns(leaf.runs) || !editor.ready || ["conflict", "copying"].includes(editor.status)} onChange={event => updateText(block, leaf.id, event.target.value)} />;
        return <article className={`cw-document-block is-${block.type}`} key={block.id}>
          <div className="cw-document-block-tools"><span>{block.type === "heading" ? `H${block.level}` : block.type}</span><div>
            <button aria-label={text("上移内容块", "Move block up")} disabled={!editor.ready || index === 0} onClick={() => change([{ op: "moveDocumentBlock", sectionId: section.id, blockId: block.id, index: index - 1 }])}><ArrowUp size={13} /></button>
            <button aria-label={text("下移内容块", "Move block down")} disabled={!editor.ready || index === section.blocks.length - 1} onClick={() => change([{ op: "moveDocumentBlock", sectionId: section.id, blockId: block.id, index: index + 1 }])}><ArrowDown size={13} /></button>
            <button aria-label={text("引用此内容", "Reference this block")} onClick={() => onReference?.({ kind: "document", sectionId: section.id, blockIds: [block.id], label: block.type === "heading" ? text("文档标题", "Document heading") : text("文档段落", "Document block") })}>{text("引用", "Reference")}</button>
          </div></div>
          {block.type === "paragraph" || block.type === "heading" ? input(block, text(block.type === "heading" ? "标题内容" : "段落内容", block.type === "heading" ? "Heading text" : "Paragraph text"))
            : block.type === "list" ? <ol>{block.items.map(item => <li key={item.id}>{input(item, text("列表项", "List item"))}</li>)}</ol>
              : block.type === "table" ? <div className="cw-document-table"><table><tbody>{block.rows.map(row => <tr key={row.id}>{row.cells.map((cell, cellIndex) => <td key={cell.id}>{input(cell, `${text("表格单元格", "Table cell")} ${cellIndex + 1}`)}</td>)}</tr>)}</tbody></table></div>
                : block.type === "image" ? <figure><img src={`/api/assets/${encodeURIComponent(block.assetId)}?preview=640&delivery=proxy`} alt={block.alt} loading="lazy" /><figcaption>{block.caption}</figcaption></figure>
                  : <div className="cw-document-page-break">{text("分页符", "Page break")}</div>}
        </article>;
      })}
      <footer className="cw-document-pagination"><button disabled={blockPage === 0} onClick={() => setBlockPage(page => Math.max(0, page - 1))}>{text("上一组", "Previous")}</button><span>{blockPage + 1} / {Math.max(1, Math.ceil(section.blocks.length / BLOCK_PAGE_SIZE))}</span><button disabled={(blockPage + 1) * BLOCK_PAGE_SIZE >= section.blocks.length} onClick={() => setBlockPage(page => page + 1)}>{text("下一组", "Next")}</button></footer>
    </main>
    {exportOpen && <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开导出面板…", "Opening export panel…")}</div>}><ExportDialog artifactId={artifactId} userId={userId} kind="document" onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
  </section>;
}
