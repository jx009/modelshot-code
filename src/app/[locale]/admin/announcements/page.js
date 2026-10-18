"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Megaphone } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { announcementsSchema } from "@/lib/announcements";
import { AnnouncementContent } from "@/components/AnnouncementBanner";
import { useAdminReason } from "@/hooks/useAdminReason";

const fieldClass = "w-full min-w-0 rounded-xl border border-divider bg-bg-page px-3 py-2 text-sm text-primary-text";
function Field({ label, children }) { return <label className="block space-y-1.5 text-xs text-secondary-text"><span>{label}</span>{children}</label>; }
function dateValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export default function AnnouncementsPage() {
  const [items, setItems] = useState(null), [version, setVersion] = useState("");
  const [selected, setSelected] = useState(null), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [previewLocale, setPreviewLocale] = useState("zh");
  const reasonPrompt = useAdminReason();
  async function load() {
    const data = await api("/api/admin/announcements");
    setItems(data.items); setVersion(data.version);
    setSelected(current => data.items.some(a => a.id === current) ? current : data.items[0]?.id || null);
  }
  useEffect(() => { void Promise.resolve().then(load).catch(() => setError("无法加载公告，请检查管理员权限或稍后重试。")); }, []);
  const current = items?.find(a => a.id === selected);
  function update(key, value) { setMessage(""); setItems(rows => rows.map(a => a.id === selected ? { ...a, [key]: value } : a)); }
  function add() {
    const item = { id: requestKey(), title: "新的创作，从这里开始", content: "来塔 AI 最新功能现已上线", titleEn: "", contentEn: "", enabled: false, closable: true, priority: 0, style: "info", startAt: null, endAt: null, buttonText: "立即查看", buttonTextEn: "", buttonUrl: "" };
    setItems(rows => [...rows, item]); setSelected(item.id); setMessage("");
  }
  async function save(event) {
    event.preventDefault(); setError(""); setMessage("");
    const parsed = announcementsSchema.safeParse(items);
    if (!parsed.success) { setError("请检查必填标题、按钮链接、优先级与发布时间；结束时间须晚于开始时间。链接仅支持站内路径或 http(s) 地址。"); return; }
    setSaving(true);
    try {
      const approval = await reasonPrompt.ask();
      await api("/api/admin/announcements", { method: "PATCH", key: approval.key, body: { items: parsed.data, version, reason: approval.reason } });
      await load(); setMessage("公告已保存，符合时间条件的已启用公告将在前台显示。");
      window.dispatchEvent(new Event("announcements-updated"));
    } catch (e) { setError(e.code === "ANNOUNCEMENTS_CHANGED" ? "其他管理员已修改公告。请先重新加载，再编辑保存。" : "保存失败，请检查权限或稍后重试。"); }
    finally { setSaving(false); }
  }
  if (!items) return <div className="space-y-3"><p role={error ? "alert" : "status"}>{error || "正在加载公告…"}</p>{error && <button className="button compact" onClick={() => void load().catch(() => {})}>重试</button>}</div>;
  return <form onSubmit={save} className="space-y-6 max-w-6xl">
    <header className="flex flex-wrap justify-between items-start gap-4"><div><h1 className="text-lg font-semibold flex items-center gap-2"><Megaphone size={19} />公告管理</h1><p className="text-xs text-secondary-text mt-2 leading-6">公告显示在网站最上方。多条公告同时生效时，展示优先级最高的一条；相同优先级按 ID 排序。最多 20 条。</p></div><button className="button primary compact" type="submit" disabled={saving}><Save size={15} />{saving ? "保存中…" : "保存所有公告"}</button></header>
    {error && <div role="alert" className="text-danger text-sm flex flex-wrap gap-3">{error}<button type="button" className="underline" onClick={() => void load().then(() => setError("")).catch(() => setError("重新加载失败"))}>重新加载（丢弃未保存修改）</button></div>}
    {message && <p role="status" className="text-primary text-sm">{message}</p>}
    <fieldset disabled={saving} className="grid lg:grid-cols-[240px_1fr] gap-5 min-w-0">
      <div className="space-y-3"><button type="button" className="button compact w-full" disabled={items.length >= 20} onClick={add}><Plus size={15} />新建公告</button>{items.map(a => <button type="button" key={a.id} onClick={() => setSelected(a.id)} aria-pressed={selected === a.id} className={`block w-full text-left p-4 rounded-xl border ${selected === a.id ? "border-primary bg-primary/10" : "border-divider bg-bg-card"}`}><span className="text-sm block break-words">{a.title || "未命名公告"}</span><span className="text-xs text-secondary-text block mt-2">{a.enabled ? "已启用" : "草稿 / 已停用"} · 优先级 {a.priority}</span></button>)}</div>
      {current ? <section className="rounded-2xl border border-divider bg-bg-card p-5 space-y-5 min-w-0">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="font-medium">编辑公告</h2><button type="button" className="button compact text-danger" onClick={() => { setItems(rows => rows.filter(a => a.id !== selected)); setSelected(items.find(a => a.id !== selected)?.id || null); setMessage(""); }}><Trash2 size={14} />删除公告</button></div>
        <div className="flex flex-wrap gap-6 text-sm">{[["enabled", "启用公告"], ["closable", "允许用户关闭"]].map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={current[key]} onChange={e => update(key, e.target.checked)} />{label}</label>)}</div>
        <Field label="标题"><input required className={fieldClass} maxLength={80} value={current.title} onChange={e => update("title", e.target.value)} /></Field>
        <Field label="公告内容（纯文本）"><textarea className={fieldClass} rows={3} maxLength={300} value={current.content} onChange={e => update("content", e.target.value)} /></Field>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="展示风格"><select className={fieldClass} value={current.style} onChange={e => update("style", e.target.value)}>{[["info", "品牌通知"], ["success", "更新上线"], ["warning", "重要提醒"], ["error", "维护通知"]].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label="优先级（越大越优先）"><input className={fieldClass} type="number" min={0} max={9999} required value={current.priority} onChange={e => update("priority", Number(e.target.value))} /></Field>
          {[["startAt", "开始时间（本地时间，留空立即）"], ["endAt", "结束时间（本地时间，留空长期）"]].map(([key, label]) => <Field key={key} label={label}><input type="datetime-local" className={fieldClass} value={dateValue(current[key])} onChange={e => update(key, e.target.value ? new Date(e.target.value).toISOString() : null)} /></Field>)}
          <Field label="按钮文案"><input className={fieldClass} maxLength={24} value={current.buttonText} onChange={e => update("buttonText", e.target.value)} /></Field><Field label="按钮链接（留空隐藏按钮）"><input className={fieldClass} placeholder="/explore 或 https://…" maxLength={500} value={current.buttonUrl} onChange={e => update("buttonUrl", e.target.value)} /></Field></div>
        <details className="text-xs text-secondary-text"><summary className="cursor-pointer">英文版本（可选，未填使用中文）</summary><div className="space-y-3 mt-4">{[["titleEn", "英文标题", 120], ["contentEn", "英文内容", 400], ["buttonTextEn", "英文按钮", 40]].map(([key, label, max]) => <Field key={key} label={label}><input className={fieldClass} maxLength={max} value={current[key]} onChange={e => update(key, e.target.value)} /></Field>)}</div></details>
        <div className="space-y-3"><div className="flex justify-between items-center"><h3 className="text-xs text-secondary-text">前台样式预览（不代表已发布）</h3><select aria-label="预览语言" className="bg-bg-page border border-divider rounded-lg px-2 py-1 text-xs" value={previewLocale} onChange={e => setPreviewLocale(e.target.value)}><option value="zh">中文</option><option value="en">English</option></select></div><div className="announcement-preview"><AnnouncementContent announcement={current} locale={previewLocale} /></div></div>
      </section> : <div className="rounded-2xl border border-dashed border-divider p-10 text-center text-secondary-text text-sm">暂无公告，点击「新建公告」开始配置。</div>}
    </fieldset>
    <p className="text-xs text-secondary-text leading-6">修改、启停或删除后，请点击「保存所有公告」。前台切换页面、返回窗口或每 60 秒刷新公告；用户关闭仅在当前浏览器会话有效，公告内容更新后会重新展示。管理后台仅展示预览。</p>
  </form>;
}
