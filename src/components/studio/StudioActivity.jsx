"use client";
import { useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { getTool } from "@/lib/studio/tool-catalog";
import { imageToolErrorMessage } from "@/lib/studio/image-tool-errors";

const terminal = ["succeeded", "failed", "cancelled"];

// This is transient feedback, not a task archive. Completed work lives on the
// canvas; failed work from this visit remains dismissible and actionable.
export default function StudioActivity({ jobs, pending, appliedJobs = [], resultStates, onRetry, onCancel, zh }) {
  const [openedAt] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState([]);
  const rows = [...(pending ? [pending] : []), ...jobs].filter(job => !dismissed.includes(job.id) && (
    !terminal.includes(job.status) || job.status === "succeeded" && !appliedJobs.includes(job.id) ||
    job.status === "failed" && new Date(job.createdAt).getTime() >= openedAt
  ));
  if (!rows.length) return null;
  return <div className="ms-task-status" role="status" aria-live="polite">{rows.map(job => {
    const failed = job.status === "failed", loadFailed = resultStates[job.id] === "failed";
    const label = failed ? imageToolErrorMessage(job.errorCode, zh) : loadFailed ? zh ? "结果加载失败，原图已保留" : "Result failed to load; original kept" : job.status === "succeeded" ? zh ? "正在载入结果…" : "Loading result…" : job.cancelRequested ? zh ? "正在取消…" : "Cancelling…" : zh ? "正在处理…" : "Processing…";
    return <div key={job.id}>
      {!failed && !loadFailed && <LoaderCircle size={14} className="ms-spin" />}
      <span>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · {label}</span>
      {loadFailed && <button className="ms-text-button" onClick={() => onRetry(job)}>{zh ? "重试加载" : "Retry loading"}</button>}
      {!terminal.includes(job.status) && job.status !== "submitting" && <button className="ms-text-button" disabled={job.cancelRequested} onClick={() => onCancel(job)}>{zh ? "取消" : "Cancel"}</button>}
      {failed && <button className="ms-icon" aria-label={zh ? "关闭失败提示" : "Dismiss failure"} onClick={() => setDismissed(current => [...current, job.id])}><X size={14} /></button>}
    </div>;
  })}</div>;
}
