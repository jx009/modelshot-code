"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import Link from "@/components/ui/NavigationLink";
import { Plus, FolderOpen, Search, X, MoreHorizontal, Pencil, Trash2, LoaderCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";
import Modal from "@/components/ui/Modal";
import CreativeShell from "./CreativeShell";
import "./projects.css";

export default function CreativeProjects() {
  const locale = useLocale(), zh = locale === "zh", { status } = useSession();
  const [rows, setRows] = useState(null), [search, setSearch] = useState(""), [filter, setFilter] = useState("all");
  const [cursor, setCursor] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [menu, setMenu] = useState(null), [editing, setEditing] = useState(null), [name, setName] = useState("");
  const [removing, setRemoving] = useState(null), [saving, setSaving] = useState(false);
  const query = new URLSearchParams({ paged: "1", q: search, kind: filter }).toString();
  const activeQuery = useRef(query);
  useEffect(() => { activeQuery.current = query; }, [query]);
  useEffect(() => {
    if (status !== "authenticated") return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try { const data = await api(`/api/studio/documents?${query}`, { signal: abort.signal }); setRows(data.items); setCursor(data.nextCursor); }
      catch (err) { if (!abort.signal.aborted) setError(err.message); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, status]);
  useEffect(() => {
    if (!menu) return;
    const close = event => {
      if (event.type === "keydown") {
        if (event.key !== "Escape") return;
        event.target.closest?.(".mp-card-menu")?.querySelector("button[aria-expanded]")?.focus();
        setMenu(null);
      } else if (!event.target.closest?.(".mp-card-menu")) setMenu(null);
    };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [menu]);
  async function rename(row) {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try { const result = await api(`/api/studio/documents/${row.id}`, { method: "PATCH", body: { name: name.trim(), version: row.version } }); setRows(current => current.map(item => item.id === row.id ? { ...item, ...result } : item)); setEditing(null); }
    catch (err) { setError(err.code === "DOCUMENT_VERSION_CONFLICT" ? zh ? "项目已在其他页面更新，请刷新后重试" : "Project changed elsewhere. Refresh and retry." : err.message); }
    finally { setSaving(false); }
  }
  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try { const data = await api(`/api/studio/documents?${query}&cursor=${encodeURIComponent(cursor)}`); if (activeQuery.current !== query) return; setRows(current => [...current, ...data.items.filter(item => !current.some(row => row.id === item.id))]); setCursor(data.nextCursor); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  async function remove() {
    setSaving(true);
    try { await api(`/api/studio/documents/${removing.id}`, { method: "DELETE" }); setRows(current => current.filter(row => row.id !== removing.id)); setRemoving(null); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  return <CreativeShell><section className="mp-library">
    <header className="mp-heading"><h1>{zh ? "我的项目" : "My projects"}</h1><label className="mp-search"><Search size={18} /><input type="search" aria-label={zh ? "搜索项目" : "Search projects"} placeholder={zh ? "搜索项目" : "Search projects"} value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label={zh ? "清空搜索" : "Clear search"} onClick={() => setSearch("")}><X size={15} /></button>}</label></header>
    <div className="mp-filters">{[["all", "全部", "All"], ["canvas", "自由画布", "Canvas"], ["commerce", "电商套图", "Commerce"], ["trash", "已删除", "Deleted"]].map(([id, cn, en]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{zh ? cn : en}</button>)}</div>
    {error && <p role="alert" className="mp-error">{error}</p>}
    {status === "unauthenticated" ? <div className="mp-empty"><FolderOpen size={36} /><p>{zh ? "登录后查看和继续你的项目" : "Sign in to continue your projects"}</p><Link href="/login?callbackUrl=/projects">{zh ? "登录" : "Sign in"}</Link></div> : <>
      <div className="mp-grid" aria-busy={loading}>
        <Link href="/studio-v2?new=1" className="mp-new"><span><Plus size={28} /></span><strong>{zh ? "新建项目" : "New project"}</strong></Link>
        {rows === null ? Array.from({ length: 5 }, (_, i) => <div className="mp-skeleton" key={i} />) : rows.map(row => <article className="mp-card" key={row.id}>
          <Link className="mp-cover" href={`/${row.kind === "commerce" ? "commerce" : "studio-v2"}?document=${row.id}`} aria-label={row.name} aria-disabled={filter === "trash"} onClick={event => { if (filter === "trash") event.preventDefault(); }}>{row.coverAssetId ? <Image unoptimized src={previewUrl(row.coverAssetId, 640)} alt="" fill sizes="(max-width:600px) 90vw, 320px" /> : <FolderOpen size={40} strokeWidth={1} />}</Link>
          <div className="mp-card-footer"><div>{editing === row.id ? <form onSubmit={event => { event.preventDefault(); rename(row); }}><input autoFocus aria-label={zh ? "项目名称" : "Project name"} maxLength={100} value={name} disabled={saving} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setEditing(null); }} /><button disabled={saving || !name.trim()}>{zh ? "保存" : "Save"}</button><button type="button" disabled={saving} onClick={() => setEditing(null)}>{zh ? "取消" : "Cancel"}</button></form> : <h2 title={row.name}>{row.name}</h2>}<time dateTime={row.updatedAt}>{zh ? "更新于 " : "Updated "}{new Date(row.updatedAt).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className="mp-card-menu">{filter === "trash" ? <button disabled={saving} onClick={async () => { setSaving(true); try { await api(`/api/studio/documents/${row.id}`, { method: "PATCH", body: { restore: true } }); setRows(current => current.filter(item => item.id !== row.id)); } catch (err) { setError(err.message); } finally { setSaving(false); } }}>{zh ? "恢复" : "Restore"}</button> : <button aria-label={zh ? `项目菜单：${row.name}` : `Project menu: ${row.name}`} aria-expanded={menu === row.id} onClick={() => setMenu(menu === row.id ? null : row.id)}><MoreHorizontal size={20} /></button>}{menu === row.id && <div><button onClick={() => { setEditing(row.id); setName(row.name); setMenu(null); }}><Pencil size={14} />{zh ? "重命名" : "Rename"}</button><button onClick={() => { setRemoving(row); setMenu(null); }}><Trash2 size={14} />{zh ? "删除" : "Delete"}</button></div>}</div>
          </div>
        </article>)}
      </div>
      {rows?.length === 0 && <p className="mp-empty">{search ? zh ? "未找到相关项目" : "No matching projects" : zh ? "从新建项目开始，创作过程会自动保存" : "Start a project. Your work saves automatically."}</p>}
      {cursor && <button className="mp-more" disabled={loading} onClick={more}>{loading && <LoaderCircle className="ms-spin" size={15} />}{zh ? "加载更多" : "Load more"}</button>}
    </>}
    {removing && <Modal label={zh ? "删除项目" : "Delete project"} onClose={() => { if (!saving) setRemoving(null); }}><h2>{zh ? "删除项目？" : "Delete project?"}</h2><p>{removing.name}</p><p>{zh ? "项目移入“已删除”，可恢复；其他项目不受影响。" : "The project moves to Deleted and can be restored. Other projects stay unchanged."}</p><div className="dialog-actions"><button className="button" disabled={saving} onClick={() => setRemoving(null)}>{zh ? "取消" : "Cancel"}</button><button className="button primary" disabled={saving} onClick={remove}>{zh ? "删除" : "Delete"}</button></div></Modal>}
  </section></CreativeShell>;
}
