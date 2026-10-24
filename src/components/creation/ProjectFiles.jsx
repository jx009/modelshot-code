"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileImage, FileText, FolderOpen, Globe, Presentation, Search, Sheet, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { creationError } from "./creation-errors";
import OfficeImport from "./OfficeImport";

// Keep one metadata page in React. Older pages retain only cursor strings,
// never artwork bodies or mounted editors. The parent remounts on refresh.
const icons = { poster: FileImage, slides: Presentation, document: FileText, sheet: Sheet, web: Globe };
export default function ProjectFiles({ project, fileId, onSelect, onImported, zh }) {
  const [page, setPage] = useState({ items: project.artifacts, nextCursor: project.artifactsNextCursor, q: "" });
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState([null]), [loading, setLoading] = useState(false), [error, setError] = useState(null);
  const pending = useRef(null);
  useEffect(() => {
    let connected = true;
    // Activity retains state while disconnecting effects. An interrupted page
    // request must not leave pagination disabled when the workspace reopens.
    queueMicrotask(() => { if (connected && !pending.current) setLoading(false); });
    return () => { connected = false; pending.current?.abort(); pending.current = null; };
  }, []);
  async function load(next, q = page.q) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(null);
    try {
      const cursor = next.at(-1);
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (q) params.set("q", q);
      const suffix = params.toString();
      const result = await api(`/api/creation/projects/${encodeURIComponent(project.id)}/files${suffix ? `?${suffix}` : ""}`, { signal: controller.signal });
      if (!controller.signal.aborted) { setPage({ ...result, q }); setCursors(next); }
    } catch (failure) { if (!controller.signal.aborted) setError({ failure, next, q }); }
    finally { if (!controller.signal.aborted) { setLoading(false); pending.current = null; } }
  }
  return <aside className="cw-file-tree" aria-label={zh ? "项目文件" : "Project files"} aria-busy={loading}>
    <form className="cw-file-search" role="search" aria-label={zh ? "搜索项目文件" : "Search project files"} onSubmit={event => { event.preventDefault(); void load([null], query.trim()); }}>
      <input type="search" aria-label={zh ? "文件名" : "File name"} placeholder={zh ? "搜索文件…" : "Search files…"} maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
      <button type="submit" aria-label={zh ? "搜索" : "Search"}><Search size={14} /></button>
    </form>
    <header><FolderOpen size={15} /><span title={project.name}>{project.name}</span></header>
    {["document", "sheet", "slides"].includes(project.kind) && <OfficeImport projectId={project.id} kind={project.kind} zh={zh} onSelect={onSelect} onImported={onImported} />}
    {page.q && <div className="cw-file-filter"><span title={page.q}>{page.q}</span><button aria-label={zh ? "清除文件搜索" : "Clear file search"} onClick={() => { setQuery(""); void load([null], ""); }}><X size={12} /></button></div>}
    <div className="cw-file-items">{page.items.map(item => {
      const Icon = icons[item.kind] || FileText;
      return <button key={item.id} className={fileId === item.id ? "is-selected" : ""} aria-current={fileId === item.id ? "true" : undefined} onClick={() => onSelect(item.id)} title={item.name}>
        <Icon size={15} /><span>{item.name}</span>{item.currentRevision != null && <small>V{item.currentRevision}</small>}
      </button>;
    })}</div>
    {!page.items.length && !loading && <p>{page.q ? zh ? "没有匹配的文件" : "No matching files" : zh ? "暂无作品，生成的作品会保存在这里" : "Generated artwork will appear here"}</p>}
    {loading && <p role="status">{zh ? "正在读取文件…" : "Loading files…"}</p>}
    {error && <div className="cw-file-error" role="alert"><p>{creationError(error.failure, zh)}</p><button onClick={() => void load(error.next, error.q)}>{zh ? "重试" : "Retry"}</button></div>}
    {(cursors.length > 1 || page.nextCursor) && <nav className="cw-file-pagination" aria-label={zh ? "文件分页" : "File pages"}>
      <button disabled={loading || cursors.length === 1} onClick={() => load(cursors.slice(0, -1))} aria-label={zh ? "上一页文件" : "Previous file page"}><ChevronLeft size={14} /></button>
      <span role="status">{loading ? zh ? "读取中…" : "Loading…" : zh ? `第 ${cursors.length} 页` : `Page ${cursors.length}`}</span>
      <button disabled={loading || !page.nextCursor} onClick={() => load([...cursors, page.nextCursor])} aria-label={zh ? "下一页文件" : "Next file page"}><ChevronRight size={14} /></button>
    </nav>}
    {cursors.length > 1 && <button disabled={loading} onClick={() => load([null])}>{zh ? "回到最新文件" : "Return to latest files"}</button>}
  </aside>;
}
