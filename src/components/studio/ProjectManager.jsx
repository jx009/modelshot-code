"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FolderOpen, Save, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Link from "@/components/ui/NavigationLink";
import { peekProjectList, readProjectList } from "@/lib/studio/project-list";

export default function ProjectManager({ userId, locale, draft, ready, update, save, onChoose, onClose, onError }) {
  const zh = locale === "zh", text = (cn, en) => zh ? cn : en;
  const [page, setPage] = useState(() => peekProjectList(userId));
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [saving, setSaving] = useState(false);
  const active = useRef(false), savingRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    readProjectList(userId, "paged=1", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setPage(data);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [userId, attempt]);
  async function store(copy) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try { await save(copy); if (active.current) onClose(); }
    catch (reason) { onError(reason); }
    finally { savingRef.current = false; if (active.current) setSaving(false); }
  }
  return <Modal className="ms-project-modal" label={text("项目管理", "Projects")} onClose={onClose}>
    <div className="ms-panel-title">{text("我的项目", "Your projects")}<button className="ms-icon" title={text("关闭", "Close")} onClick={onClose}><X size={18} /></button></div>
    <label>{text("当前项目名称", "Current project name")}<input value={draft.name} maxLength={100} disabled={!ready || saving} onChange={event => update(current => ({ ...current, name: event.target.value, nameSource: "manual" }))} /></label>
    <div className="ms-project-buttons">
      <button className="ms-button ms-primary" disabled={!userId || !ready || saving} onClick={() => store(false)}><Save size={15} />{saving ? text("正在保存…", "Saving…") : text("保存项目", "Save project")}</button>
      <button className="ms-button" disabled={!userId || !ready || saving} onClick={() => store(true)}>{text("另存为", "Save as new")}</button>
    </div>
    <div className="ms-project-list">
      {!userId ? <p>{text("登录后查看云端项目", "Sign in to view cloud projects")}</p> : error ? <div role="alert"><p>{error}</p><button className="ms-button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>{text("重试", "Retry")}</button></div> : !page ? <p role="status">{text("正在加载项目…", "Loading projects…")}</p> : page.items.length ? page.items.map(row => <button key={row.id} disabled={!ready || saving} onClick={() => onChoose(row.id)}><FolderOpen size={20} /><span>{row.name}<small>{new Date(row.updatedAt).toLocaleString(locale)}</small></span><ArrowUpRight size={15} /></button>) : <p>{text("还没有云端项目。保存你的第一个作品。", "No cloud projects yet. Save your first creation.")}</p>}
    </div>
    <Link href="/projects" onClick={onClose}>{text("查看全部项目", "View all projects")}</Link>
  </Modal>;
}
