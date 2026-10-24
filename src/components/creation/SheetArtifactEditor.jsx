"use client";

import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Redo2, Save, Undo2, Table2 } from "lucide-react";
import DraftSessionGate from "./DraftSessionGate";
import { useSheetArtifact } from "./useSheetArtifact";
import { usePendingTextDraft } from "./usePendingTextDraft";
import { columnName, cellPosition } from "@/lib/creation/sheet-formula";
import { pendingSheetCellSnapshot, pendingSheetCellOperations, sheetCellText, sheetCellSource } from "@/lib/creation/client/pending-sheet-cell";
import { creationError } from "./creation-errors";
import "./creation.css";

const ExportDialog = lazy(() => import("./ExportDialog"));
const ROW_WINDOW = 32;
const COLUMN_WINDOW = 12;
const identifier = () => crypto.randomUUID().replaceAll("-", "_");
const address = (row, column) => `${columnName(column)}${row}`;
const EMPTY_CELLS = [];

export default function SheetArtifactEditor({ artifactId, userId, zh = true, editorRef, onError, onReference }) {
  return <DraftSessionGate key={`${userId}:${artifactId}`} userId={userId} artifactId={artifactId} editorRef={editorRef} zh={zh}>
    {draftSessionId => <SheetSession draftSessionId={draftSessionId} artifactId={artifactId} userId={userId} zh={zh} editorRef={editorRef} onError={onError} onReference={onReference} />}
  </DraftSessionGate>;
}

function SheetSession({ draftSessionId, artifactId, userId, zh, editorRef, onError, onReference }) {
  const editor = useSheetArtifact(userId, artifactId, draftSessionId);
  const draft = usePendingTextDraft(userId, artifactId, editor.persistLocal, draftSessionId, pendingSheetCellSnapshot);
  const [sheetIndex, setSheetIndex] = useState(0), [rowPage, setRowPage] = useState(0), [columnPage, setColumnPage] = useState(0);
  const [selectedAddress, setSelectedAddress] = useState("A1"), [live, setLive] = useState(null), [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false), [discarding, setDiscarding] = useState(false);
  const gate = useRef(false), lifetime = useRef(null), formulaInput = useRef(null), focusFrame = useRef(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }; }, []);
  const text = (cn, en) => zh ? cn : en;
  const commit = useCallback(async () => {
    if (!editor.ready || !draft.ready || draft.recovery) throw new Error("TEXT_DRAFT_REVIEW_REQUIRED");
    const pending = draft.snapshot();
    if (!pending) { await draft.flush(); if (!lifetime.current.signal.aborted) setLive(null); return; }
    const operations = pendingSheetCellOperations(editor.getContent(), pending);
    if (operations.length && editor.change(operations) === false) throw new Error("ARTIFACT_NOT_READY");
    await draft.clear();
    if (!lifetime.current.signal.aborted) setLive(null);
  }, [editor, draft]);
  const flush = useCallback(async () => {
    if (gate.current) throw new Error("ARTIFACT_NOT_READY");
    gate.current = true; setBusy(true);
    try { await commit(); return await editor.flush(); }
    finally { gate.current = false; if (!lifetime.current.signal.aborted) setBusy(false); }
  }, [commit, editor]);
  useImperativeHandle(editorRef, () => ({ flush }), [flush]);
  useEffect(() => {
    if (!live && !draft.recovery) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live, draft.recovery]);
  const workbook = editor.content;
  const sheet = workbook?.sheets[sheetIndex], cells = sheet?.cells || EMPTY_CELLS;
  // Index and extents change only on a committed workbook edit, not on each key.
  const { cellMap, maxRow, maxColumn } = useMemo(() => {
    const cellMap = new Map(); let maxRow = 1, maxColumn = 1;
    for (const cell of cells) { cellMap.set(cell.address, cell); const position = cellPosition(cell.address); if (position) { maxRow = Math.max(maxRow, position.row); maxColumn = Math.max(maxColumn, position.column); } }
    return { cellMap, maxRow, maxColumn };
  }, [cells]);
  if (!workbook) return <div className="cw-loading" role="status">{text("正在打开工作簿…", "Opening workbook…")}</div>;
  const firstRow = rowPage * ROW_WINDOW + 1;
  const lastRow = Math.min(maxRow + 1, firstRow + ROW_WINDOW);
  const firstColumn = columnPage * COLUMN_WINDOW + 1;
  const lastColumn = Math.min(maxColumn + 1, firstColumn + COLUMN_WINDOW);
  const columns = Array.from({ length: Math.max(1, lastColumn - firstColumn) }, (_, index) => firstColumn + index);
  const rows = Array.from({ length: Math.max(1, lastRow - firstRow) }, (_, index) => firstRow + index);
  const locked = !editor.ready || !draft.ready || busy || Boolean(draft.recovery) || ["conflict", "copying"].includes(editor.status);
  const currentLive = draft.ready && !draft.recovery ? live : null;
  const display = target => currentLive?.sheetId === sheet.id && currentLive.address === target ? currentLive.text : sheetCellText(cellMap.get(target));

  async function perform(action) {
    if (gate.current) return;
    gate.current = true; setBusy(true);
    try { await action(); } catch (error) { if (!lifetime.current.signal.aborted) onError?.(error); }
    finally { gate.current = false; if (!lifetime.current.signal.aborted) setBusy(false); }
  }
  function update(target, value, composing) {
    if (locked || gate.current) return;
    try {
      const previous = cellMap.get(target), pending = draft.snapshot();
      if (pending && (pending.sheetId !== sheet.id || pending.address !== target)) throw new Error("SHEET_CELL_INPUT_PENDING");
      const next = { ...(pending || { kind: "sheet-cell", sheetId: sheet.id, address: target, cellId: previous?.id || identifier(), original: sheetCellSource(previous) }), text: value, composing: composing ?? pending?.composing ?? false };
      draft.change(next); setLive(next); setSelectedAddress(target); setDiscarding(false);
    } catch (error) { onError?.(error); }
  }
  function selectCell(value, input) {
    if (selectedAddress === value || gate.current) return;
    if (!draft.snapshot()) { setSelectedAddress(value); return; }
    void perform(async () => {
      try { await commit(); if (!lifetime.current.signal.aborted) { setSelectedAddress(value); focusLater(input); } }
      catch (error) { focusLater(formulaInput.current); throw error; }
    });
  }
  function focusLater(input) {
    const signal = lifetime.current.signal;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; if (!signal.aborted && input?.isConnected) input.focus(); });
  }
  const changeView = action => void perform(async () => { await commit(); if (!lifetime.current.signal.aborted) action(); });
  const keys = event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) void perform(commit); } };

  return <section className="cw-artifact cw-structured-editor cw-sheet-editor" aria-label={text("表格编辑器", "Spreadsheet editor")}>
    <header className="cw-artifact-bar"><div><Table2 size={15} /><strong>{workbook.title}</strong><span>V{editor.revision}</span></div>
      <span className="cw-save-state" role="status">{currentLive ? text("单元格有待应用输入", "Unapplied cell input") : text(editor.status === "saved" ? "已保存" : editor.status === "saving" ? "正在保存…" : editor.status === "local" ? "有未同步修改" : "保存或读取失败", editor.status === "saved" ? "Saved" : editor.status === "saving" ? "Saving…" : editor.status === "local" ? "Unsynced changes" : "Save or load failed")}</span>
      <button disabled={locked || !currentLive && !editor.undoCount} aria-label={text("撤销", "Undo")} title={text("撤销", "Undo")} onClick={() => changeView(editor.undo)}><Undo2 size={15} /></button>
      <button disabled={locked || Boolean(currentLive) || !editor.redoCount} aria-label={text("重做", "Redo")} title={text("重做", "Redo")} onClick={() => changeView(editor.redo)}><Redo2 size={15} /></button>
      <button disabled={locked} aria-label={text("保存", "Save")} title={text("保存", "Save")} onClick={() => void flush().catch(onError)}><Save size={15} /></button>
      <button disabled={locked} aria-label={text("导出", "Export")} title={text("导出", "Export")} onClick={() => setExportOpen(true)}><Download size={15} /></button>
    </header>
    {(editor.error || draft.error) && <div role="alert" className="cw-error"><span>{creationError(editor.error || draft.error, zh)}</span><button disabled={busy} onClick={() => { if (draft.error) draft.retry(); else editor.retry(); }}>{text("重试", "Retry")}</button></div>}
    {draft.recovery && <section className="cw-sheet-recovery" aria-label={text("恢复单元格输入", "Recover cell input")}><p>{text("发现未应用的单元格输入。继续编辑或明确放弃后再修改工作簿。", "Unapplied cell input was recovered. Continue editing or discard it before changing the workbook.")}</p><textarea aria-label={text("恢复的单元格内容", "Recovered cell text")} readOnly value={draft.recovery.text} /><button disabled={busy || !editor.ready || !draft.ready} onClick={() => void perform(async () => {
      const pending = { ...draft.snapshot(), composing: false }, index = workbook.sheets.findIndex(item => item.id === pending.sheetId), position = cellPosition(pending.address);
      if (index < 0 || !position) throw new Error("SHEET_CELL_CHANGED");
      draft.change(pending); draft.acceptRecovery(); setLive(pending); setSheetIndex(index); setRowPage(Math.floor((position.row - 1) / ROW_WINDOW)); setColumnPage(Math.floor((position.column - 1) / COLUMN_WINDOW)); setSelectedAddress(pending.address);
    })}>{text("继续编辑", "Continue editing")}</button></section>}
    {(live || draft.recovery) && <div className="cw-sheet-pending"><span>{text("Enter 应用；未完成的公式会保留在本地草稿。", "Enter to apply; unfinished formulas remain in local drafts.")}</span>{discarding ? <><span>{text("放弃尚未应用的单元格输入？", "Discard the unapplied cell input?")}</span><button disabled={busy} onClick={() => void perform(async () => { await draft.clear(); setLive(null); setDiscarding(false); })}>{text("确认放弃", "Confirm discard")}</button><button onClick={() => setDiscarding(false)}>{text("取消", "Cancel")}</button></> : <button disabled={busy} onClick={() => setDiscarding(true)}>{text("放弃输入", "Discard input")}</button>}<button disabled={locked || !currentLive} onClick={() => void perform(commit)}>{text("应用修改", "Apply changes")}</button></div>}
    <nav className="cw-sheet-toolbar" aria-label={text("工作簿工具", "Workbook tools")}>
      <label>{text("工作表", "Sheet")}<select disabled={locked} value={sheetIndex} onChange={event => { const index = Number(event.target.value); changeView(() => { setSheetIndex(index); setRowPage(0); setColumnPage(0); setSelectedAddress("A1"); }); }}>{workbook.sheets.map((item, index) => <option key={item.id} value={index}>{item.name}</option>)}</select></label>
      <span>{text("单元格", "Cell")} <strong>{selectedAddress}</strong></span>
      <input ref={formulaInput} aria-label={text("单元格内容或公式", "Cell value or formula")} value={display(selectedAddress)} disabled={locked} maxLength={16000} onChange={event => update(selectedAddress, event.target.value, event.nativeEvent.isComposing || undefined)} onCompositionStart={event => update(selectedAddress, event.currentTarget.value, true)} onCompositionEnd={event => update(selectedAddress, event.currentTarget.value, false)} onKeyDown={keys} />
      <button disabled={!onReference || locked} onClick={() => changeView(() => onReference?.({ kind: "sheet", sheetId: sheet.id, addresses: [selectedAddress], label: `${sheet.name}!${selectedAddress}` }))}>{text("引用单元格", "Reference cell")}</button>
      <span>{text(`${sheet.cells.length} 个非空单元格`, `${sheet.cells.length} non-empty cells`)}</span>
    </nav>
    <div className="cw-sheet-grid-scroll" role="region" aria-label={text(`${sheet.name} 网格`, `${sheet.name} grid`)} tabIndex={0}>
      <table className="cw-sheet-grid"><thead><tr><th aria-label={text("行号", "Row number")}></th>{columns.map(column => <th key={column}>{columnName(column)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row}><th scope="row">{row}</th>{columns.map(column => {
          const cellAddress = address(row, column), cell = cellMap.get(cellAddress);
          return <td key={cellAddress} data-selected={selectedAddress === cellAddress || undefined}>
            <input aria-label={`${cellAddress}${cell?.formula ? ` ${text("公式", "formula")}` : ""}`} value={display(cellAddress)} disabled={locked} maxLength={16000} onFocus={event => selectCell(cellAddress, event.currentTarget)} onChange={event => update(cellAddress, event.target.value, event.nativeEvent.isComposing || undefined)} onCompositionStart={event => update(cellAddress, event.currentTarget.value, true)} onCompositionEnd={event => update(cellAddress, event.currentTarget.value, false)} onKeyDown={keys} />
          </td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <footer className="cw-sheet-pagination"><button aria-label={text("更早行", "Previous rows")} disabled={locked || rowPage === 0} onClick={() => changeView(() => setRowPage(page => Math.max(0, page - 1)))}><ArrowLeft size={14} /></button><span>{firstRow}–{lastRow - 1} / {maxRow}</span><button aria-label={text("更多行", "Next rows")} disabled={locked || lastRow > maxRow} onClick={() => changeView(() => setRowPage(page => page + 1))}><ArrowRight size={14} /></button>
      <button aria-label={text("更早列", "Previous columns")} disabled={locked || columnPage === 0} onClick={() => changeView(() => setColumnPage(page => Math.max(0, page - 1)))}><ArrowLeft size={14} /></button><span>{columnName(firstColumn)}–{columnName(lastColumn - 1)} / {columnName(maxColumn)}</span><button aria-label={text("更多列", "Next columns")} disabled={locked || lastColumn > maxColumn} onClick={() => changeView(() => setColumnPage(page => page + 1))}><ArrowRight size={14} /></button></footer>
    {exportOpen && <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开导出面板…", "Opening export panel…")}</div>}><ExportDialog artifactId={artifactId} userId={userId} kind="sheet" onFlush={flush} onClose={() => setExportOpen(false)} zh={zh} /></Suspense>}
  </section>;
}
