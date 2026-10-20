"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { useAdminReason } from "@/hooks/useAdminReason";
export default function ExecutionSettings() {
  const [data, setData] = useState(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const approval = useAdminReason();
  useEffect(() => { api("/api/admin/execution").then(setData).catch(() => setMessage("无法加载并发配置，请刷新重试。")); }, []);
  async function save(event) {
    event.preventDefault(); const reason = await approval.ask(); if (!reason) return;
    setBusy(true); setMessage("");
    try {
      await api("/api/admin/execution", { method: "PATCH", key: reason.key, body: { config: data.config, reason: reason.reason } });
      setMessage("配置已保存，Worker 将在一分钟内应用，无需重启。正在执行的任务会继续。");
    } catch { setMessage("保存失败，请检查权限与输入范围后重试。"); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mt-6 max-w-5xl space-y-4 rounded-2xl border border-divider bg-bg-card p-6">
    {approval.dialog}<h2 className="font-medium">生图与图片处理并发</h2>
    <p className="text-xs leading-6 text-secondary-text">生图拥有独立队列，不再与导出、支付任务共用执行名额，也不再限制每分钟 30 次。以下数量为每个 Worker 实例的同时执行数。</p>
    {data && <fieldset disabled={!data.canManage || busy} className="grid sm:grid-cols-3 gap-4">{[
      ["generationConcurrency", "生图任务并发", 4096], ["transferConcurrency", "图片传输并发", 64], ["processingConcurrency", "图片校验与转码并发", 32],
    ].map(([key, label, max]) => <label key={key} className="text-sm space-y-2"><span>{label}</span><input required type="number" min={1} max={max} value={data.config[key]} className="w-full rounded-xl border border-divider bg-bg-page p-3" onChange={e => setData(current => ({ ...current, config: { ...current.config, [key]: Number(e.target.value) } }))} /></label>)}</fieldset>}
    <p className="text-xs text-secondary-text">16 GB 服务器默认：生图 128、图片传输 8、校验与转码 4。提高生图并发不会提高单张图片的模型生成速度。</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    <button className="button primary compact" disabled={!data?.canManage || busy}>{busy ? "保存中…" : "保存并发配置"}</button>
  </form>;
}
