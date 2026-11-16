"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Copy, Film, FolderOpen, LayoutGrid, Plus, Save, Search, ShoppingBag, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Link from "@/components/ui/NavigationLink";
import Image from "@/components/studio/AssetImage";
import { useDebouncedValue } from "@/components/ui/useDebouncedValue";
import { peekProjectList, readProjectList } from "@/lib/studio/project-list";
import { previewUrl } from "@/lib/studio/image-url";
import "./project-switcher.css";

const KINDS = { canvas: ["自由画布", "Canvas", LayoutGrid], video: ["单镜头视频", "Single shot", Film], motion: ["分镜成片", "Storyboard", Clapperboard], commerce: ["电商套图", "Commerce", ShoppingBag] };

function ago(value, zh, locale) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return zh ? "刚刚" : "Just now";
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes} min ago`;
  if (minutes < 1440) return zh ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 2880) return zh ? "昨天" : "Yesterday";
  return new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric", ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

// 项目切换面板：封面网格、搜索、当前项目高亮、分页加载。画布与视频工作台共用，按 kinds 过滤项目类型。
// editor 存在时显示当前项目的命名与保存（画布使用）；creates 为“新建”入口。
export default function ProjectManager({ userId, locale, kinds = ["canvas"], currentId, ready = true, onChoose, onClose, creates = [], editor }) {
  const zh = locale === "zh", text = (cn, en) => zh ? cn : en;
  const [search, setSearch] = useState(""), query = useDebouncedValue(search.trim(), 300);
  const params = `paged=1&kind=${kinds.join(",")}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const [pages, setPages] = useState(() => ({ params, items: peekProjectList(userId, params)?.items || null, cursor: peekProjectList(userId, params)?.nextCursor || null }));
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [saving, setSaving] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const active = useRef(false), savingRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    readProjectList(userId, params, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setPages({ params, items: data.items, cursor: data.nextCursor }); setError(""); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [userId, params, attempt]);
  const items = pages.params === params ? pages.items : null;
  async function more() {
    if (!pages.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await readProjectList(userId, `${params}&cursor=${pages.cursor}`);
      if (active.current) setPages(current => current.params === params ? { params, items: [...current.items, ...data.items.filter(row => !current.items.some(item => item.id === row.id))], cursor: data.nextCursor } : current);
    } catch (reason) { if (active.current) setError(reason.message); }
    finally { if (active.current) setLoadingMore(false); }
  }
  async function store(copy) {
    if (savingRef.current || !editor) return;
    savingRef.current = true; setSaving(true);
    try { await editor.save(copy); if (active.current) onClose(); }
    catch (reason) { editor.onError?.(reason); }
    finally { savingRef.current = false; if (active.current) setSaving(false); }
  }
  return <Modal className="pj-switcher" label={text("我的项目", "Your projects")} onClose={onClose}>
    <header className="pj-head">
      <div><h2>{text("我的项目", "Your projects")}</h2><p>{text("切换后当前修改会自动保存", "Changes are saved before switching")}</p></div>
      <div className="pj-head-actions">
        {creates.map(item => item.onClick ? <button type="button" key={item.label} className="pj-new" disabled={!ready} onClick={() => { onClose(); item.onClick(); }}><Plus size={14} />{item.label}</button> : <Link key={item.href} className="pj-new" href={item.href} onClick={onClose}><Plus size={14} />{item.label}</Link>)}
        <button type="button" className="pj-close" aria-label={text("关闭", "Close")} onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    {editor && <section className="pj-current" aria-label={text("当前项目", "Current project")}>
      <label><span>{text("当前项目名称", "Current project name")}</span><input value={editor.draft.name} maxLength={100} disabled={!ready || saving} onChange={event => editor.update(current => ({ ...current, name: event.target.value, nameSource: "manual" }))} /></label>
      <button type="button" className="pj-save" disabled={!userId || !ready || saving} onClick={() => store(false)}><Save size={15} />{saving ? text("正在保存…", "Saving…") : text("保存", "Save")}</button>
      <button type="button" className="pj-copy" disabled={!userId || !ready || saving} onClick={() => store(true)}><Copy size={14} />{text("另存为", "Save as new")}</button>
    </section>}
    <label className="pj-search"><Search size={15} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={text("搜索项目名称", "Search projects")} aria-label={text("搜索项目", "Search projects")} /></label>
    <div className="pj-body">
      {!userId ? <p className="pj-note">{text("登录后查看云端项目", "Sign in to view cloud projects")}</p>
        : error ? <div className="pj-note" role="alert"><p>{error}</p><button type="button" className="pj-copy" onClick={() => { setError(""); setAttempt(value => value + 1); }}>{text("重试", "Retry")}</button></div>
        : !items ? <div className="pj-grid" role="status" aria-label={text("正在加载项目", "Loading projects")}>{Array.from({ length: 6 }, (_, index) => <span key={index} className="pj-card is-skeleton"><span className="pj-cover" /><span className="pj-meta"><i /><i /></span></span>)}</div>
        : !items.length ? <div className="pj-empty"><FolderOpen size={34} strokeWidth={1.2} /><p>{query ? text("没有找到匹配的项目", "No matching projects") : text("还没有项目，开始你的第一个创作吧", "No projects yet. Start your first creation.")}</p></div>
        : <div className="pj-grid">{items.map(row => {
          const [cn, en, Icon] = KINDS[row.kind] || KINDS.canvas, current = row.id === currentId;
          return <button type="button" key={row.id} className={`pj-card${current ? " is-current" : ""}`} disabled={!ready || saving || current} onClick={() => onChoose(row)} aria-current={current || undefined}>
            <span className="pj-cover">{row.coverAssetId ? <Image unoptimized src={previewUrl(row.coverAssetId, 640)} alt="" fill sizes="220px" /> : <span className="pj-cover-empty"><Icon size={26} strokeWidth={1.4} /></span>}
              {kinds.length > 1 && <em className="pj-kind"><Icon size={11} />{zh ? cn : en}</em>}
              {current && <b className="pj-badge">{text("当前", "Current")}</b>}</span>
            <span className="pj-meta"><strong title={row.name}>{row.name}</strong><small>{ago(row.updatedAt, zh, locale)}{row.count ? ` · ${row.count} ${row.kind === "motion" ? text("个镜头", "shots") : text("项", "items")}` : ""}</small></span>
          </button>;
        })}</div>}
      {items && pages.cursor && <button type="button" className="pj-more" disabled={loadingMore} onClick={more}>{loadingMore ? text("正在加载…", "Loading…") : text("加载更多", "Load more")}</button>}
    </div>
    <footer className="pj-foot"><Link href="/projects" onClick={onClose}>{text("在作品页管理全部项目", "Manage all projects")}</Link></footer>
  </Modal>;
}
