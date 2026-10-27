"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileImage, FileText, FolderOpen, Globe, Presentation, Search, Sheet, X, Plus, LoaderCircle } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { creationError } from "./creation-errors";
import OfficeImport from "./OfficeImport";
import ProjectResources from "./ProjectResources";

// Keep one metadata page in React. Older pages retain only cursor strings,
// never artwork bodies or mounted editors. Refresh updates the first page in place.
const icons = { poster: FileImage, slides: Presentation, document: FileText, sheet: Sheet, web: Globe };
export default function ProjectFiles({ project, fileId, onSelect, onImported, onWarm, resources, zh, externalImport = false }) {
  const [page, setPage] = useState({ items: project.artifacts, nextCursor: project.artifactsNextCursor, q: "", source: project.artifacts });
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState([null]), [loading, setLoading] = useState(false), [error, setError] = useState(null);
  const pending = useRef(null);
  const creation = useRef(null), creating = useRef(false);
  const [createBusy, setCreateBusy] = useState(false), [createError, setCreateError] = useState(null);
  async function createFile() {
    if (creating.current) return;
    creating.current = true; setCreateBusy(true); setCreateError(null);
    try {
      const title = zh ? "未命名演示文稿" : "Untitled presentation";
      creation.current ||= { key: requestKey(), body: { projectId: project.id, content: {
        schemaVersion: 3, format: "html-slides", kind: "slides", title,
        theme: { name: "Default", primary: "#243530", accent: "#1e7a6f", background: "#ffffff", fontFamily: "sans" }, metadata: {},
        pages: [{ id: "page_" + requestKey(), title, width: 1920, height: 1080, notes: "", hidden: false, html: '<html><head><style>body{margin:0;background:#fff;color:#243530;font-family:sans-serif}h1{margin:96px;font-size:80px}</style></head><body><h1 data-node-id="title">' + title + '</h1></body></html>' }],
      } } };
      const result = await api("/api/creation/artifacts", { method: "POST", ...creation.current, timeoutMs: 30000 });
      await onImported?.();
      await onSelect(result.artifactId, false, "slides");
      creation.current = null;
    } catch (failure) { setCreateError(failure); }
    finally { creating.current = false; setCreateBusy(false); }
  }
  const shown = cursors.length === 1 && !page.q && page.source !== project.artifacts ? { ...page, items: project.artifacts, nextCursor: project.artifactsNextCursor } : page;
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
      if (!controller.signal.aborted) { setPage({ ...result, q, source: project.artifacts }); setCursors(next); }
    } catch (failure) { if (!controller.signal.aborted) setError({ failure, next, q }); }
    finally { if (!controller.signal.aborted) { setLoading(false); pending.current = null; } }
  }
  return <aside className="cw-file-tree" aria-label={zh ? "项目文件" : "Project files"} aria-busy={loading}>
    <form className="cw-file-search" role="search" aria-label={zh ? "搜索项目文件" : "Search project files"} onSubmit={event => { event.preventDefault(); void load([null], query.trim()); }}>
      <input type="search" aria-label={zh ? "文件名" : "File name"} placeholder={zh ? "搜索文件…" : "Search files…"} maxLength={100} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
      <button type="submit" aria-label={zh ? "搜索" : "Search"}><Search size={14} /></button>
    </form>
    {project.kind === "slides" && <button className="cw-new-file" disabled={createBusy} onClick={createFile}>{createBusy ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}{zh ? createError ? "重试新建文件" : "新建文件" : createError ? "Retry new file" : "New file"}</button>}
    {createError && <p role="alert">{creationError(createError, zh)}</p>}
    <header><FolderOpen size={15} /><span title={project.name}>{project.name}</span></header>
    {!externalImport && ["document", "sheet", "slides"].includes(project.kind) && <OfficeImport projectId={project.id} kind={project.kind} zh={zh} onSelect={onSelect} onImported={onImported} />}
    {page.q && <div className="cw-file-filter"><span title={page.q}>{page.q}</span><button aria-label={zh ? "清除文件搜索" : "Clear file search"} onClick={() => { setQuery(""); void load([null], ""); }}><X size={12} /></button></div>}
    <div className="cw-file-items">{shown.items.map(item => {
      const Icon = icons[item.kind] || FileText;
      const entry = <button className={fileId === item.id ? "is-selected" : ""} aria-current={fileId === item.id ? "true" : undefined} onPointerEnter={() => onWarm?.(item.kind)} onFocus={() => onWarm?.(item.kind)} onClick={() => onSelect(item.id, false, item.kind)} title={item.name}>
        <Icon size={15} data-kind={item.kind} /><span>{item.name}</span>{item.currentRevision != null && <small>V{item.currentRevision}</small>}
      </button>;
      return <div className="cw-file-entry" key={item.id}>{fileId === item.id && resources?.artifactId === item.id ? <ProjectResources resources={resources} zh={zh}>{entry}</ProjectResources> : entry}</div>;
    })}</div>
    {!shown.items.length && !loading && <p>{page.q ? zh ? "没有匹配的文件" : "No matching files" : zh ? "暂无作品，生成的作品会保存在这里" : "Generated artwork will appear here"}</p>}
    {loading && <p role="status">{zh ? "正在读取文件…" : "Loading files…"}</p>}
    {error && <div className="cw-file-error" role="alert"><p>{creationError(error.failure, zh)}</p><button onClick={() => void load(error.next, error.q)}>{zh ? "重试" : "Retry"}</button></div>}
    {(cursors.length > 1 || shown.nextCursor) && <nav className="cw-file-pagination" aria-label={zh ? "文件分页" : "File pages"}>
      <button disabled={loading || cursors.length === 1} onClick={() => load(cursors.slice(0, -1))} aria-label={zh ? "上一页文件" : "Previous file page"}><ChevronLeft size={14} /></button>
      <span role="status">{loading ? zh ? "读取中…" : "Loading…" : zh ? `第 ${cursors.length} 页` : `Page ${cursors.length}`}</span>
      <button disabled={loading || !shown.nextCursor} onClick={() => load([...cursors, shown.nextCursor])} aria-label={zh ? "下一页文件" : "Next file page"}><ChevronRight size={14} /></button>
    </nav>}
    {cursors.length > 1 && <button disabled={loading} onClick={() => load([null])}>{zh ? "回到最新文件" : "Return to latest files"}</button>}
  </aside>;
}
