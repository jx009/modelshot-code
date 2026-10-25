"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { useAdminReason } from "@/hooks/useAdminReason";
import { CREATION_ACCESS_FLAGS } from "@/lib/creation/access-flags";

export default function CreationAccessSettings() {
  const [data, setData] = useState(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const approval = useAdminReason();
  useEffect(() => {
    let active = true;
    api("/api/admin/creation-access").then(value => { if (active) setData(value); }).catch(() => { if (active) setMessage("创作权限加载失败，请刷新重试。"); });
    return () => { active = false; };
  }, []);
  async function save(event) {
    event.preventDefault();
    const reason = await approval.ask(); if (!reason) return;
    setBusy(true); setMessage("");
    try {
      await api("/api/admin/creation-access", { method: "PATCH", key: reason.key, body: { config: data.config, reason: reason.reason } });
      setMessage("已保存，权限立即生效。已打开的页面刷新后更新入口。");
    } catch { setMessage("保存失败，请重试。"); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4 rounded-[16px] border border-divider bg-bg-card p-5">
    {approval.dialog}
    <div><h2 className="text-sm font-medium text-primary-text">创作功能开放权限</h2>
      <p className="mt-1 text-xs leading-6 text-secondary-text">关闭：仅 root 可进入和使用。开启：所有已登录用户可进入和使用。开关仅 root 可修改。</p>
      <p className="text-xs leading-6 text-secondary-text">普通用户使用各创作模块，需要同时开启「创作工作台」和对应模块；AI 生成还需要开启「AI 创作任务」。</p></div>
    {!data && !message && <p className="text-xs text-secondary-text">加载中…</p>}
    {data && <fieldset disabled={!data.canManage || busy} className="grid gap-3 md:grid-cols-2">{CREATION_ACCESS_FLAGS.map(({ key, env, label }) => <label key={key} className="flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border border-divider px-4 py-3">
      <span className="min-w-0"><span className="block text-sm text-primary-text">{label}</span><span className="block break-all text-[11px] text-secondary-text">{env}</span></span>
      <span className="flex shrink-0 items-center gap-2"><span className="text-xs text-secondary-text">{data.config[key] ? "全部用户" : "仅 root"}</span><input type="checkbox" role="switch" aria-label={label} checked={data.config[key]} onChange={event => { const checked = event.target.checked; setMessage(""); setData(current => ({ ...current, config: { ...current.config, [key]: checked } })); }} className="peer sr-only" /><span aria-hidden="true" className="relative h-6 w-10 rounded-full bg-secondary-text/30 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:opacity-50"><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${data.config[key] ? "translate-x-5" : "translate-x-1"}`} /></span></span>
    </label>)}</fieldset>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <button className="button primary compact" disabled={!data?.canManage || busy}>{busy ? "保存中…" : "保存创作权限"}</button>
  </form>;
}
