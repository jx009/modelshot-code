"use client";
import { useState } from "react";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { getTool } from "@/lib/studio/tool-catalog";
import { imageToolErrorMessage } from "@/lib/studio/image-tool-errors";

const terminal = ["succeeded", "failed", "cancelled"];

// This is transient feedback, not a task archive. Completed work lives on the
// canvas; failed work from this visit remains dismissible and actionable.
export default function StudioActivity({ jobs, pending, appliedJobs = [], resultStates, onRetry, onCancel, zh, conversation = false }) {
  const [openedAt] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState([]);
  const [observation, setObservation] = useState(() => ({ jobs, ids: jobs.filter(job => !terminal.includes(job.status)).map(job => job.id) }));
  if (observation.jobs !== jobs) {
    setObservation({ jobs, ids: [...new Set([...observation.ids, ...jobs.filter(job => !terminal.includes(job.status)).map(job => job.id)])] });
  }
  const rows = [...(pending ? [pending] : []), ...jobs].filter(job => !dismissed.includes(job.id) && (
    !terminal.includes(job.status) || job.status === "succeeded" && !appliedJobs.includes(job.id) ||
    job.status === "failed" && (conversation || observation.ids.includes(job.id) || new Date(job.createdAt).getTime() >= openedAt) ||
    conversation && job.status === "cancelled"
  ));
  if (!rows.length) return null;
  return <div className={conversation ? "ms-chat-activity" : "ms-task-status"} role="status" aria-live="polite">{rows.map(job => {
    const failed = job.status === "failed", loadFailed = resultStates[job.id] === "failed";
    const reconciling = job.status === "reconciling";
    const label = failed ? imageToolErrorMessage(job.errorCode, zh) : loadFailed ? zh ? "结果加载失败，原图已保留" : "Result failed to load; original kept" : job.status === "succeeded" ? zh ? "正在载入结果…" : "Loading result…" : job.status === "cancelled" ? zh ? "已取消" : "Cancelled" : job.cancelRequested ? zh ? "正在取消…" : "Cancelling…" : reconciling ? job.errorCode === "PROVIDER_PENDING" ? zh ? "正在查询生成结果…" : "Checking generation result…" : zh ? "连接中断，正在核对结果…" : "Connection interrupted; checking result…" : job.status === "queued" ? zh ? "排队中…" : "Queued…" : job.status === "submitting" ? zh ? "正在提交…" : "Submitting…" : zh ? "正在处理…" : "Processing…";
    return <div key={job.id}>
      {(failed || reconciling && job.errorCode !== "PROVIDER_PENDING") ? <CircleAlert size={14} /> : !loadFailed && job.status !== "cancelled" && <LoaderCircle size={14} className="ms-spin" />}
      <span>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · {label}</span>
      {loadFailed && <button className="ms-text-button" onClick={() => onRetry(job)}>{zh ? "重试加载" : "Retry loading"}</button>}
      {!terminal.includes(job.status) && job.status !== "submitting" && <button className="ms-text-button" disabled={job.cancelRequested} onClick={() => onCancel(job)}>{zh ? "取消" : "Cancel"}</button>}
      {failed && <button className="ms-icon" aria-label={zh ? "关闭失败提示" : "Dismiss failure"} onClick={() => setDismissed(current => [...current, job.id])}><X size={14} /></button>}
    </div>;
  })}</div>;
}
