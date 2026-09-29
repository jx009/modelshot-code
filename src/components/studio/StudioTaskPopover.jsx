"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Sparkles, X, LocateFixed } from "lucide-react";
import { api } from "@/lib/client-api";
import { getTool } from "@/lib/studio/tools";
import { previewUrl } from "@/lib/studio/image-url";
import { taskPhase, taskSummary } from "@/lib/studio/task-presentation";
import "./task-popover.css";

export default function StudioTaskPopover({ documentId, jobs, pending, appliedJobs, resultStates, zh, onRetry, onCancel, onLocate }) {
  const [open, setOpen] = useState(false), [history, setHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!open) return; const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, [open]);
  const root = useRef(null), trigger = useRef(null);
  const [older, setOlder] = useState([]), [cursor, setCursor] = useState(null), [historyError, setHistoryError] = useState(""), [loadingHistory, setLoadingHistory] = useState(false);
  useEffect(() => {
    if (!history || !documentId) return;
    const abort = new AbortController();
    api(`/api/studio/jobs?documentId=${encodeURIComponent(documentId)}&paged=1`, { signal: abort.signal }).then(data => { setOlder(data.items); setCursor(data.nextCursor); }).catch(error => { if (!abort.signal.aborted) setHistoryError(error.message); });
    return () => abort.abort();
  }, [history, documentId]);
  async function moreHistory() {
    if (loadingHistory || !cursor) return;
    setLoadingHistory(true);
    try { const data = await api(`/api/studio/jobs?documentId=${encodeURIComponent(documentId)}&paged=1&cursor=${encodeURIComponent(cursor)}`); setOlder(items => [...items, ...data.items]); setCursor(data.nextCursor); setHistoryError(""); }
    catch (error) { setHistoryError(error.message); } finally { setLoadingHistory(false); }
  }
  const merged = history ? [...jobs, ...older.filter(job => !jobs.some(current => current.id === job.id))] : jobs;
  const rows = pending ? [pending, ...merged] : merged;
  const summary = taskSummary(rows, appliedJobs, resultStates);
  useEffect(() => {
    if (!open) return;
    const pointer = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [open]);
  const labels = zh ? { submitting: "正在提交…", queued: "排队中…", processing: "正在处理…", running: "正在处理…", reconciling: "正在核对模型结果…", loading: "已生成，正在加载图片…", complete: "已完成", failed: "任务失败", cancelled: "已取消", "load-failed": "已生成，图片加载失败" } : { submitting: "Submitting…", queued: "Queued…", processing: "Processing…", running: "Processing…", reconciling: "Checking provider result…", loading: "Generated, loading image…", complete: "Complete", failed: "Task failed", cancelled: "Cancelled", "load-failed": "Generated, image failed to load" };
  return <div className="ms-task-center" ref={root}>
    <button ref={trigger} className={`ms-task-trigger ${summary.active ? "is-running" : ""}`} aria-label={zh ? "任务列表" : "Task list"} aria-expanded={open} aria-controls="studio-task-list" onClick={() => setOpen(value => !value)}><Sparkles size={24} />{summary.active > 0 && <span>{summary.active}</span>}</button>
    {open && <section id="studio-task-list" className="ms-task-popover" aria-label={zh ? "当前项目任务" : "Current project tasks"}>
      <header><span>{zh ? "当前项目任务" : "Project tasks"}</span><button className="ms-icon" aria-label={zh ? "关闭任务列表" : "Close task list"} onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></header>
      {summary.complete && !history ? <div className="ms-task-complete" role="status"><CheckCircle2 size={64} strokeWidth={2} /><p>{zh ? "任务完成" : "Tasks complete"}</p><button onClick={() => setHistory(true)}>{zh ? "查看任务记录" : "View task history"}</button></div> : !rows.length ? <div className="ms-task-empty">{zh ? "暂无任务，开始创作后可在这里查看进度" : "Start creating to see task progress here"}</div> : <div className="ms-task-cards">{rows.map(job => {
        const phase = taskPhase(job, appliedJobs, resultStates), complete = phase === "complete", failed = ["failed", "load-failed"].includes(phase);
        const active = !complete && !failed && phase !== "cancelled";
        const asset = job.assetId || job.resultData?.assets?.find(item => item.contentType?.startsWith("image/"))?.id;
        return <article key={job.id} className="ms-task-card" data-state={phase}>
          <div className="ms-task-thumb">{asset ? <Image unoptimized src={previewUrl(asset, 320)} width={96} height={96} alt="" /> : <Sparkles size={25} />}<span>{active ? <LoaderCircle size={16} className="ms-spin" /> : complete ? <CheckCircle2 size={16} /> : failed ? <CircleAlert size={16} /> : <X size={16} />}</span></div>
          <div className="ms-task-details"><strong>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en}</strong><p role="status">{labels[phase] || labels.processing}</p>{failed && job.errorCode && <small>{job.errorCode}</small>}<time dateTime={job.createdAt}>{job.createdAt ? (now - new Date(job.createdAt) < 60000 ? zh ? "刚刚" : "Just now" : now - new Date(job.createdAt) < 3600000 ? zh ? `${Math.floor((now - new Date(job.createdAt)) / 60000)} 分钟前` : `${Math.floor((now - new Date(job.createdAt)) / 60000)} min ago` : new Date(job.createdAt).toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })) : zh ? "刚刚" : "Just now"}</time>
            <div className="ms-task-card-actions">{phase === "load-failed" && <button onClick={() => onRetry(job)}>{zh ? "重试加载" : "Retry loading"}</button>}{complete && job.resultData?.assets?.length > 0 && <button onClick={() => onLocate(job)}><LocateFixed size={13} />{zh ? "定位结果" : "Locate result"}</button>}{active && job.status !== "submitting" && phase !== "loading" && <button disabled={job.cancelRequested} onClick={() => onCancel(job)}>{job.cancelRequested ? zh ? "正在取消…" : "Cancelling…" : zh ? "取消" : "Cancel"}</button>}</div>
          </div>
        </article>;
      })}{historyError && <p role="alert">{historyError}</p>}{history && cursor && <button className="ms-text-button" disabled={loadingHistory} onClick={moreHistory}>{zh ? "加载更早任务" : "Load earlier tasks"}</button>}</div>}
      {!history && !summary.complete && rows.length > 0 && <button className="ms-text-button" onClick={() => setHistory(true)}>{zh ? "查看全部任务记录" : "View all task history"}</button>}
    </section>}
  </div>;
}
