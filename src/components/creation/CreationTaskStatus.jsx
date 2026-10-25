"use client";

import { AlertCircle, Check, ChevronDown, ChevronRight, CirclePause, ListChecks, LoaderCircle, Square } from "lucide-react";
import { runProgress } from "@/lib/creation/run-progress";
import { creationError } from "./creation-errors";

export function taskTitle(run, zh = true) {
  const p = runProgress(run), t = (cn, en) => zh ? cn : en;
  if (run.status === "failed") return t(p.complete.length ? "部分步骤失败 · 已停止" : "生成失败 · 已停止", "Generation stopped with errors");
  if (run.status === "succeeded") return t("全部完成", "Completed");
  if (run.status === "queued") return t("已提交 · 等待执行", "Queued for generation");
  if (run.status === "cancelling") return t("正在停止后续步骤", "Stopping subsequent steps");
  if (run.status === "running") return t(p.failed.length ? "继续生成中 · 部分步骤失败" : "正在生成", p.failed.length ? "Generating · some steps failed" : "Generating");
  if (run.status === "cancelled") return t("已取消 · 已停止", "Cancelled");
  if (run.status === "awaiting_budget") return t("已暂停 · 等待确认预算", "Paused · budget required");
  return t(run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED" ? "大纲已完成 · 请确认" : "已暂停 · 需要处理", "Paused · action required");
}
function StatusIcon({ progress, size = 15 }) {
  const Icon = progress.tone === "failed" ? AlertCircle : progress.tone === "succeeded" ? Check : progress.active ? LoaderCircle : CirclePause;
  return <Icon size={size} className={progress.active ? "animate-spin" : undefined} />;
}
export function RunStatusStrip({ run, error, zh, onDetails, onRefresh }) {
  if (!run && !error) return null;
  const p = runProgress(run), t = (cn, en) => zh ? cn : en;
  return <div className="cw-run-strip" data-tone={error ? "paused" : p.tone} role="status" aria-live="polite">
    {!run && error && <span>{t("暂时无法读取任务状态", "Task status is unavailable")}</span>}
    {run && <button type="button" onClick={onDetails}><StatusIcon progress={p} /><span><strong>{error ? t("状态连接中断，正在重连", "Reconnecting to task status") : taskTitle(run, zh)}</strong><small>{p.pages ? t(`已保存 ${p.publishedPages}/${p.pages} 页`, `${p.publishedPages}/${p.pages} slides saved`) : t(`${p.complete.length}/${p.total} 步骤完成`, `${p.complete.length}/${p.total} steps complete`)}</small></span><ChevronRight size={14} /></button>}
    {error && <button type="button" onClick={onRefresh}>{t("刷新状态", "Refresh status")}</button>}
  </div>;
}
export default function CreationTaskStatus({ run, expanded, onToggle, zh, busy, budget, onBudget, onCancel, onResume, onChild, onReview }) {
  const p = runProgress(run), t = (cn, en) => zh ? cn : en;
  const review = run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED";
  const issues = p.failed;
  const ordered = [...issues, ...p.running, ...run.steps.filter(step => !issues.includes(step) && !p.running.includes(step))];
  const stepLabel = step => ({ succeeded: t("已完成", "Completed"), running: t("正在执行", "Running"), failed: t("失败", "Failed"), cancelled: t("已取消", "Cancelled"), blocked: p.active ? t("等待依赖步骤", "Waiting for dependencies") : t("尚未执行", "Not executed"), ready: t("待执行", "Ready"), queued: t("排队中", "Queued") }[step.status] || t("待处理", "Pending"));
  return <section className="cw-task cw-task-summary" data-tone={p.tone}>
    <button className="cw-task-heading" aria-expanded={expanded} onClick={onToggle}><ListChecks size={16} /><strong>{t("任务进度", "Task progress")}</strong><span>{p.complete.length}/{p.total}</span>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
    <div className="cw-task-result" role="status"><StatusIcon progress={p} /><strong>{taskTitle(run, zh)}</strong></div>
    <progress max={p.total || 1} value={p.complete.length} aria-label={t("已完成步骤", "Completed steps")} />
    {p.pages > 0 && <p>{t(`已保存 ${p.publishedPages}/${p.pages} 页，可在右侧浏览。`, `${p.publishedPages}/${p.pages} slides saved and available in the viewer.`)}</p>}
    {run.status === "failed" && <p>{t("任务已停止，不会继续自动生成。已完成内容保留，重试只处理失败步骤及后续步骤。", "The task has stopped. Completed work is retained; retry resumes failed and dependent steps.")}</p>}
    {run.status === "succeeded" && <p>{t("结果已保存，可继续编辑、演示或导出。", "Saved. You can edit, present, or export the result.")}</p>}
    {p.running.length > 0 && !expanded && <p>{t("正在执行：", "Running: ")}{p.running.map(step => step.explanation).join(" · ")}</p>}
    {!expanded && issues.map(step => <div className="cw-step-error" key={step.id}><AlertCircle size={14} /><span>{step.explanation}<small>{creationError({ code: step.errorCode || run.errorCode }, zh)}</small></span></div>)}
    {expanded && <ol>{ordered.map(step => <li key={step.id} data-state={step.status}><span>{step.status === "succeeded" ? <Check size={13} /> : step.status === "running" ? <LoaderCircle size={13} className="animate-spin" /> : step.status === "failed" ? <AlertCircle size={13} /> : step.position + 1}</span><div>{step.explanation}<small>{stepLabel(step)}</small>{step.status === "failed" && <p>{creationError({ code: step.errorCode || run.errorCode }, zh)}{step.errorCode && <code>{step.errorCode}</code>}</p>}{step.result?.childRunId && <button onClick={() => onChild(step.result.childRunId)}>{t("查看子任务", "View task")}</button>}</div></li>)}</ol>}
    {run.errorCode && !issues.length && <p>{creationError({ code: run.errorCode }, zh)}</p>}
    {p.active ? <button disabled={busy || run.status === "cancelling"} onClick={onCancel}><Square size={13} />{t("停止生成", "Stop generating")}</button> : ["failed", "awaiting_budget", "awaiting_input"].includes(run.status) && <div className="cw-run-actions">
      <button className="cw-resume-primary" disabled={busy} onClick={review ? onReview : onResume}>{t(review ? "检查并确认大纲" : run.status === "failed" ? "重试失败步骤" : "继续任务", review ? "Review outline" : run.status === "failed" ? "Retry failed steps" : "Resume task")}</button><button disabled={busy} onClick={onCancel}>{t("取消任务", "Cancel task")}</button>
      <details><summary>{t("预算设置", "Budget settings")}</summary><label>{t("任务总预算", "Total task budget")}<input type="number" min={run.committedCredits} max={200000} value={budget || run.maxCredits} onChange={event => onBudget(event.target.value)} /></label></details>
    </div>}
  </section>;
}
