"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { FolderOpen, ImagePlus, Images, Plus, Search, Trash2, Undo2, X, Check } from "lucide-react";
import { api } from "@/lib/client-api";
import { previewUrl, imageUrl } from "@/lib/studio/image-url";
import Modal from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import "./asset-library.css";

export default function AssetLibrary({ onSelect, maxSelection = 10 }) {
  const zh = useLocale() === "zh", { status } = useSession(), fileInput = useRef(null);
  const [selecting, setSelecting] = useState(false);
  const [category, setCategory] = useState("all"), [categories, setCategories] = useState([]), [search, setSearch] = useState("");
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [newCategory, setNewCategory] = useState(false), [categoryName, setCategoryName] = useState("");
  const [selected, setSelected] = useState([]), [preview, setPreview] = useState(null), [renaming, setRenaming] = useState(null), [name, setName] = useState("");
  const query = new URLSearchParams({ category, q: search }).toString();
  const activeQuery = useRef(query);
  useEffect(() => { activeQuery.current = query; }, [query]);
  useEffect(() => {
    if (status !== "authenticated") return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const [data, groups] = await Promise.all([api(`/api/library?${query}`, { signal: abort.signal }), api("/api/library/categories", { signal: abort.signal })]);
        setItems(data.items); setCursor(data.nextCursor); setCategories(groups);
      } catch (err) { if (!abort.signal.aborted) setError(err.message); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, refresh, status]);
  async function mutate(id, body) {
    setBusy(true); setError("");
    try { await api(`/api/library/${id}`, { method: "PATCH", body }); setRefresh(value => value + 1); setRenaming(null); setSelected(current => current.filter(item => item.id !== id)); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function upload(files) {
    setBusy(true); setError("");
    try {
      for (const file of Array.from(files).slice(0, 20)) {
        const body = new FormData(); body.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body }), data = await response.json();
        if (!response.ok) throw new Error(data.code || "UPLOAD_FAILED");
        await api("/api/library", { method: "POST", body: { assetId: data.assetId, name: file.name.slice(0, 160), ...(!["all", "uncategorized", "trash"].includes(category) ? { categoryId: category } : {}) } });
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); setRefresh(value => value + 1); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function addCategory() {
    setBusy(true);
    try { const row = await api("/api/library/categories", { method: "POST", body: { name: categoryName } }); setCategory(row.id); setNewCategory(false); setCategoryName(""); setRefresh(value => value + 1); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function more() {
    setLoading(true);
    try { const data = await api(`/api/library?${query}&cursor=${encodeURIComponent(cursor)}`); if (activeQuery.current !== query) return; setItems(current => [...current, ...data.items]); setCursor(data.nextCursor); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }
  async function bulk(action, categoryId) {
    if (busy || !selected.length) return;
    setBusy(true); setError("");
    try { await api("/api/library/batch", { method: "POST", body: { ids: selected.map(item => item.id), action, ...(categoryId !== undefined ? { categoryId } : {}) } }); setSelected([]); setRefresh(value => value + 1); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  function choose(item) {
    if (!onSelect && !selecting) { setPreview(item); return; }
    setSelected(current => current.some(row => row.id === item.id) ? current.filter(row => row.id !== item.id) : current.length < (onSelect ? maxSelection : 100) ? [...current, item] : current);
  }
  if (status === "unauthenticated") return <div className="ml-empty"><FolderOpen size={32} /><p>{zh ? "登录后管理你的素材" : "Sign in to manage your assets"}</p><Link href="/login?callbackUrl=/assets">{zh ? "登录" : "Sign in"}</Link></div>;
  return <div className={`ml-library ${onSelect ? "is-picker" : ""}`}>
    <aside className="ml-sidebar"><button className="ml-upload" disabled={busy} onClick={() => fileInput.current.click()}><ImagePlus size={18} />{busy ? zh ? "处理中…" : "Working…" : zh ? "上传素材" : "Upload assets"}</button><h2>{zh ? "素材管理" : "Asset library"}</h2>
      {[["all", Images, "全部素材", "All assets"], ["uncategorized", FolderOpen, "未分类", "Uncategorized"]].map(([id, Icon, cn, en]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}><Icon size={16} />{zh ? cn : en}</button>)}
      <h3>{zh ? "我的分类" : "My categories"}</h3>{categories.map(row => <button key={row.id} className={category === row.id ? "active" : ""} onClick={() => setCategory(row.id)}><FolderOpen size={16} /><span>{row.name}</span><small>{row._count.items}</small></button>)}
      <button onClick={() => setNewCategory(true)}><Plus size={16} />{zh ? "新增分类" : "New category"}</button>
      {!onSelect && <button className={`ml-trash ${category === "trash" ? "active" : ""}`} onClick={() => setCategory("trash")}><Trash2 size={16} />{zh ? "回收站" : "Trash"}</button>}
    </aside>
    <section className="ml-content"><header><h1>{onSelect ? zh ? "选择素材" : "Choose assets" : category === "trash" ? zh ? "回收站" : "Trash" : zh ? "我的素材" : "My assets"}</h1><label className="ml-search"><Search size={16} /><input type="search" aria-label={zh ? "搜索素材" : "Search assets"} placeholder={zh ? "搜索素材" : "Search assets"} value={search} onChange={event => setSearch(event.target.value)} /></label></header>
      {!onSelect && <div className="ml-bulk"><button disabled={busy} onClick={() => { setSelecting(value => !value); setSelected([]); }}>{selecting ? zh ? "退出多选" : "Exit selection" : zh ? "批量管理" : "Select items"}</button>{selecting && <><button disabled={busy || !items.length} onClick={() => setSelected(current => items.every(item => current.some(row => row.id === item.id)) ? current.filter(row => !items.some(item => item.id === row.id)) : [...current, ...items.filter(item => !current.some(row => row.id === item.id))].slice(0, 100))}>{zh ? "全选当前页" : "Select this page"}</button><span>{zh ? `已选 ${selected.length} 项` : `${selected.length} selected`}</span>{category === "trash" ? <button disabled={busy || !selected.length} onClick={() => bulk("restore")}>{zh ? "恢复选中素材" : "Restore selected"}</button> : <><select aria-label={zh ? "批量移动分类" : "Move selected to category"} disabled={busy || !selected.length} value="" onChange={event => bulk("category", event.target.value === "none" ? null : event.target.value)}><option value="" disabled>{zh ? "移动到分类…" : "Move to category…"}</option><option value="none">{zh ? "未分类" : "Uncategorized"}</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button disabled={busy || !selected.length} onClick={() => bulk("trash")}>{zh ? "移入回收站" : "Move selected to trash"}</button></>}</>}</div>}
      {category === "trash" && <p className="ml-note">{zh ? "素材在回收站保留 30 天。正在被项目使用的图片会继续保留。" : "Items stay in Trash for 30 days. Images used by projects remain available."}</p>}
      {error && <p role="alert" className="ml-error">{error}</p>}
      <div className="ml-grid" aria-busy={loading}>{items.map(item => <article key={item.id} className={selected.some(row => row.id === item.id) ? "selected" : ""}>
        <button className="ml-image" aria-label={item.name} aria-pressed={onSelect || selecting ? selected.some(row => row.id === item.id) : undefined} onClick={() => choose(item)}><Image unoptimized src={previewUrl(item.assetId, 320)} width={320} height={320} alt="" />{selected.some(row => row.id === item.id) && <span><Check size={16} /></span>}</button>
        {renaming === item.id ? <form onSubmit={event => { event.preventDefault(); mutate(item.id, { name }); }}><input autoFocus maxLength={160} aria-label={zh ? "素材名称" : "Asset name"} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setRenaming(null); }} /><button disabled={busy || !name.trim()}>{zh ? "保存" : "Save"}</button></form> : <button className="ml-name" title={item.name} onClick={() => { if (!onSelect && category !== "trash") { setRenaming(item.id); setName(item.name); } }}>{item.name}</button>}
        {!onSelect && <div className="ml-actions">{category === "trash" ? <button disabled={busy} onClick={() => mutate(item.id, { restore: true })}><Undo2 size={14} />{zh ? "恢复" : "Restore"}</button> : <><select aria-label={zh ? `分类：${item.name}` : `Category: ${item.name}`} disabled={busy} value={item.categoryId || ""} onChange={event => mutate(item.id, { categoryId: event.target.value || null })}><option value="">{zh ? "未分类" : "Uncategorized"}</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button disabled={busy} aria-label={zh ? `移入回收站：${item.name}` : `Move to trash: ${item.name}`} onClick={() => mutate(item.id, { trash: true })}><Trash2 size={15} /></button></>}</div>}
      </article>)}</div>
      {!items.length && <div className="ml-empty"><Images size={36} strokeWidth={1} /><p>{loading ? zh ? "正在加载…" : "Loading…" : search ? zh ? "未找到相关素材" : "No matching assets" : zh ? "暂无素材" : "No assets yet"}</p></div>}
      {cursor && <button className="ml-more" disabled={loading} onClick={more}>{zh ? "加载更多" : "Load more"}</button>}
      {onSelect && <footer><span>{zh ? `已选择 ${selected.length} / ${maxSelection} 个素材` : `${selected.length} / ${maxSelection} selected`}</span><button disabled={!selected.length || busy} onClick={async () => { setBusy(true); try { await onSelect(selected); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>{zh ? "确认" : "Confirm"}</button></footer>}
    </section>
    <input hidden type="file" multiple accept="image/png,image/jpeg,image/webp" ref={fileInput} aria-label={zh ? "上传素材文件" : "Upload asset files"} onChange={event => upload(event.target.files)} />
    {newCategory && <Modal label={zh ? "创建分类" : "Create category"} onClose={() => { if (!busy) setNewCategory(false); }}><h2>{zh ? "创建分类" : "Create category"}</h2><input autoFocus aria-label={zh ? "分类名称" : "Category name"} placeholder={zh ? "10 字内" : "Up to 10 characters"} maxLength={10} value={categoryName} onChange={event => setCategoryName(event.target.value)} />{error && <p role="alert">{error}</p>}<div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setNewCategory(false)}>{zh ? "取消" : "Cancel"}</button><button className="button primary" disabled={busy || !categoryName.trim()} onClick={addCategory}>{zh ? "确认" : "Confirm"}</button></div></Modal>}
    {preview && <Modal label={zh ? "素材预览" : "Asset preview"} className="ml-preview-dialog" onClose={() => setPreview(null)}><button aria-label={zh ? "关闭预览" : "Close preview"} onClick={() => setPreview(null)}><X size={20} /></button><Image unoptimized src={imageUrl(preview.assetId)} width={preview.asset.width} height={preview.asset.height} alt={preview.name} /><a href={imageUrl(preview.assetId)} download={preview.name}>{zh ? "下载原图" : "Download original"}</a></Modal>}
  </div>;
}
