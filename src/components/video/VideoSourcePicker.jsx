"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export default function VideoSourcePicker({ provider, field, value, onChange, disabled, configured, zh }) {
  const [page, setPage] = useState({ items: [], nextCursor: null }), [error, setError] = useState(""), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => {
    const abort = new AbortController();
    if (!provider) return;
    api(`/api/studio/jobs?paged=1&videoProvider=${encodeURIComponent(provider)}`, { signal: abort.signal }).then(result => { if (!abort.signal.aborted) { setPage(result); setError(""); } }).catch(failure => { if (!abort.signal.aborted) setError(failure.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [provider, attempt]);
  const idFor = job => field === "video_id" ? job.resultData?.providerVideoId : job.resultData?.providerTaskId;
  const candidates = page.items.filter(job => idFor(job));
  async function more() {
    setLoading(true);
    try { const next = await api(`/api/studio/jobs?paged=1&videoProvider=${encodeURIComponent(provider)}&cursor=${encodeURIComponent(page.nextCursor)}`); setPage(current => ({ ...next, items: [...current.items, ...next.items.filter(item => !current.items.some(old => old.id === item.id))] })); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }
  return <div className="vg-source-picker">
    <select aria-label={text("选择原视频作品", "Choose original video")} disabled={disabled || !provider || loading} value={value || ""} onChange={event => onChange(event.target.value)}>
      <option value="">{configured ? text("使用已配置的原视频", "Use configured source") : text("选择已完成的视频", "Choose a completed video")}</option>
      {value && !candidates.some(job => idFor(job) === value) && <option value={value}>{text("已选择的原视频", "Selected original video")}</option>}
      {candidates.map((job, index) => <option key={job.id} value={idFor(job)}>{text("视频", "Video")} {index + 1} · {new Date(job.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}</option>)}
    </select>
    <small>{text("只显示本账号在同一视频服务账号下、接口兼容的已完成作品。", "Completed videos from your account with a compatible API and the same upstream account.")}</small>
    {page.nextCursor && <button type="button" disabled={loading || disabled} onClick={more}>{text("加载更多", "Load more")}</button>}
    {error && <div role="alert">{text("作品加载失败", "Could not load videos")}<button type="button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>{text("重试", "Retry")}</button></div>}
  </div>;
}
