"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { getTool } from "@/lib/studio/tool-catalog";
import { useCreationRun } from "./useCreationRun";

const active = status => ["queued", "running", "cancelling"].includes(status);
function DurablePlanPanel({ plan, draftRef, save, update, flushLocal, provider, estimatedCost, pricesReady, disabled, onJobsChanged, onError, zh }) {
  const [runId, setRunId] = useState(plan.serverRunId || null);
  const [checking, setChecking] = useState(!plan.serverRunId), [busy, setBusy] = useState(false), [recoveryError, setRecoveryError] = useState(null);
  const [revision, setRevision] = useState(0), [budget, setBudget] = useState(estimatedCost ?? plan.credits);
  const live = useRef(true), operation = useRef(false), signature = useRef("");
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const remember = useCallback(run => {
    if (!live.current || draftRef.current.plan?.id !== plan.id) return;
    setRunId(run.id);
    update(draft => draft.plan?.id !== plan.id ? draft : { ...draft, plan: { ...draft.plan, serverRunId: run.id } });
  }, [draftRef, plan.id, update]);
  useEffect(() => {
    if (runId || !draftRef.current.id) { setChecking(false); return; }
    const abort = new AbortController();
    setChecking(true); setRecoveryError(null);
    api(`/api/creation/runs?documentId=${encodeURIComponent(draftRef.current.id)}`, { signal: abort.signal }).then(result => {
      if (abort.signal.aborted) return;
      const previous = result.items.find(item => item.clientKey === plan.id);
      if (previous) remember(previous);
    }).catch(error => { if (!abort.signal.aborted) setRecoveryError(error); })
      .finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => abort.abort();
  }, [runId, draftRef, plan.id, remember, revision]);
  const receive = useCallback(run => {
    const next = run.steps.map(step => `${step.jobId || ""}:${step.status}`).join("|");
    if (signature.current !== next) { signature.current = next; onJobsChanged(); }
  }, [onJobsChanged]);
  const { run, error } = useCreationRun(runId, receive);
  async function start() {
    if (operation.current || disabled || !pricesReady || checking || recoveryError) return;
    operation.current = true; setBusy(true);
    try {
      const saved = await save();
      if (!live.current || draftRef.current.plan?.id !== plan.id) return;
      const pending = draftRef.current.pendingCreation;
      let body = pending?.planId === plan.id ? { ...pending.body, documentVersion: saved.version } : null;
      if (!body) {
        const source = draftRef.current.layers.find(layer => layer.id === plan.targetId);
        if (plan.targetId && !source) throw new Error("TARGET_CHANGED");
        body = { kind: "image", documentId: saved.id, documentVersion: saved.version,
          summary: plan.summary, steps: plan.steps, maxCredits: estimatedCost ?? plan.credits,
          ...(provider ? { provider } : {}), ...(source ? { source: { targetId: source.id, assetId: source.assetId } } : {}),
        };
        update(draft => ({ ...draft, pendingCreation: { planId: plan.id, body } }));
        await flushLocal();
      }
      const created = await api("/api/creation/runs", { method: "POST", key: plan.id, body });
      if (!live.current) return;
      remember(created);
      update(draft => ({ ...draft, pendingCreation: null }));
      await flushLocal();
      onJobsChanged();
    } catch (failure) {
      if (live.current) {
        // These responses prove admission rolled back. Unknown network outcomes
        // retain the exact request so the next attempt recovers the same run.
        if (["CREATION_BUDGET_EXCEEDED", "PRICE_CHANGED", "TARGET_CHANGED", "DOCUMENT_VERSION_CONFLICT"].includes(failure.code)) update(draft => ({ ...draft, pendingCreation: null }));
        onError(failure);
      }
    }
    finally { operation.current = false; if (live.current) setBusy(false); }
  }
  async function control(action) {
    if (!run || operation.current) return;
    operation.current = true; setBusy(true);
    try {
      await api(`/api/creation/runs/${run.id}/${action}`, { method: "POST", ...(action === "resume" ? { body: { expectedSequence: run.eventSequence, maxCredits: Number(budget), retryFailed: run.status === "failed" } } : {}) });
      if (live.current) { setRunId(null); setRevision(value => value + 1); }
    } catch (failure) { if (live.current) onError(failure); }
    finally { operation.current = false; if (live.current) setBusy(false); }
  }
  const steps = run?.steps || plan.steps;
  const status = run?.status;
  const statusLabel = {
    queued: text("已排队", "Queued"), running: text("正在执行", "Running"), cancelling: text("正在停止", "Stopping"),
    succeeded: text("已完成", "Complete"), failed: text("执行失败", "Failed"), cancelled: text("已停止", "Stopped"),
    awaiting_budget: text("等待确认预算", "Review budget"), awaiting_input: text("需要处理后继续", "Needs attention"),
  }[status];
  return <section className="ms-plan" aria-label={text("后台创作计划", "Background creation plan")}>
    <span className="ms-eyebrow"><Sparkles size={13} />{text("创作计划", "CREATIVE PLAN")}</span>
    <p>{plan.summary}</p>
    {steps.map((step, index) => <div className="ms-plan-step" key={step.id || index}>
      <span>{step.status === "succeeded" ? <Check size={13} /> : ["running", "queued"].includes(step.status) ? <LoaderCircle size={13} className="ms-spin" /> : index + 1}</span>
      <div>{zh ? getTool(step.tool)?.zh : getTool(step.tool)?.en}<small>{step.explanation}</small></div>
    </div>)}
    <p role="status">{checking ? text("正在恢复计划…", "Recovering plan…") : statusLabel || text("确认后，即使关闭页面也会继续执行。", "After confirmation, work continues even if you close this page.")}</p>
    {(recoveryError || error) && <p role="alert">{text("进度暂时无法读取，已提交任务仍在后台。", "Progress is unavailable. Submitted work continues in the background.")}</p>}
    {run?.errorCode && <p role="alert">{run.errorCode}</p>}
    {!runId && !run && <button className="ms-button ms-primary" disabled={disabled || busy || checking || Boolean(recoveryError) || !pricesReady} onClick={start}>{text("确认并执行", "Run plan")} · {estimatedCost ?? "—"} {text("积分", "credits")}</button>}
    {run && ["failed", "awaiting_budget", "awaiting_input"].includes(status) && <>
      <label>{text("本计划积分上限（含已完成步骤）", "Plan credit limit, including completed steps")}<input type="number" min={run.committedCredits} max={200000} step={1} value={budget} onChange={event => setBudget(event.target.value)} /></label>
      <p>{text("继续会按当前价格执行未完成步骤，成功步骤不会重做。", "Continue at current prices. Completed steps will not run again.")}</p>
      <button className="ms-button ms-primary" disabled={busy || !Number.isInteger(Number(budget)) || Number(budget) < run.committedCredits || Number(budget) > 200000} onClick={() => control("resume")}>{text(status === "failed" ? "确认重试未完成步骤" : "确认并继续", "Confirm and continue")}</button>
    </>}
    {run && (active(status) || ["awaiting_budget", "awaiting_input"].includes(status)) && <button className="ms-text-button" disabled={busy || status === "cancelling"} onClick={() => control("cancel")}>{text("停止后续步骤", "Stop remaining steps")}</button>}
    {recoveryError && <button className="ms-text-button" onClick={() => setRevision(value => value + 1)}>{text("重试读取", "Retry")}</button>}
    {(!runId && !checking && !recoveryError || run && ["succeeded", "failed", "cancelled"].includes(status)) && <button className="ms-text-button" disabled={busy} onClick={() => update(draft => ({ ...draft, plan: null }))}>{text("收起计划", "Dismiss plan")}</button>}
  </section>;
}

export default memo(DurablePlanPanel);
