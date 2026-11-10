"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/NavigationLink";
import { api, requestKey } from "@/lib/client-api";
import { submissionRejected } from "@/lib/studio/submission-recovery";
import { videoModelOffer } from "@/lib/video/model-choice";
import { appendVideoReference } from "@/lib/video/references";
import { videoMessage, videoPlanStatus } from "@/lib/video/messages";
import { useCreationRun } from "@/components/creation/useCreationRun";
import VideoParameterFields from "./VideoParameterFields";

export default function VideoShotPlan({ project, caps, zh, disabled, onRefreshQuote }) {
  const video = project.draft.content.video, scenes = video.composition.scenes;
  const [settings, setSettings] = useState({ provider: caps?.videoProvider, duration: 5, ratio: video.ratio, media: [] });
  const [rows, setRows] = useState(() => scenes.map((scene, index) => ({ id: scene.id, selected: index < 12, prompt: [scene.title, scene.subtitle].filter(Boolean).join("\n"), reference: Boolean(scene.assetId) })));
  const [runId, setRunId] = useState(video.shotRunId || null), [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [recoveryFailed, setRecoveryFailed] = useState(false), [recoveryRevision, setRecoveryRevision] = useState(0);
  const [uncertain, setUncertain] = useState(false), [budget, setBudget] = useState(0);
  const pending = useRef(null), operation = useRef(false);
  const storageKey = `video-shot-plan:${project.id}`, text = (cn, en) => zh ? cn : en;
  const { run: fetchedRun, error: progressError } = useCreationRun(runId, undefined, revision);
  const run = fetchedRun?.id === runId ? fetchedRun : null;
  const offer = videoModelOffer(caps, settings.provider, settings);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (abort.signal.aborted) return;
      setChecking(true); setRecoveryFailed(false);
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey));
        if (stored?.key && stored?.body) { pending.current = stored; setUncertain(true); }
      } catch { /* Ignore invalid local recovery data. */ }
      try {
        const result = await api(`/api/creation/runs?documentId=${encodeURIComponent(project.id)}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const previous = result.items.find(item => item.kind === "video");
        if (previous) { setRunId(previous.id); setBudget(previous.maxCredits); }
      } catch (failure) { if (!abort.signal.aborted) { setRecoveryFailed(true); setError(failure.message); } }
      finally { if (!abort.signal.aborted) setChecking(false); }
    })();
    return () => abort.abort();
  }, [project.id, storageKey, recoveryRevision]);
  const currentRows = scenes.map((scene, index) => rows.find(row => row.id === scene.id) || { id: scene.id, selected: index < 12, prompt: [scene.title, scene.subtitle].filter(Boolean).join("\n"), reference: Boolean(scene.assetId) });
  const updateRow = (id, patch) => setRows(currentRows.map(row => row.id === id ? { ...row, ...patch } : row));
  const clearRecovery = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Server run listing can recover accepted plans. */ } };
  const shots = currentRows.filter(row => row.selected).map(row => {
    const scene = scenes.find(scene => scene.id === row.id), asset = video.media.find(item => item.id === scene.assetId);
    const media = row.reference && asset ? appendVideoReference([], asset, offer?.referenceLayout || "reference") : [];
    const input = { ...settings, media, prompt: row.prompt }, selected = videoModelOffer(caps, settings.provider, input);
    return { sceneId: row.id, provider: selected?.provider || caps?.videoProvider, params: { prompt: row.prompt, ratio: input.ratio, duration: input.duration, media, ...(input.videoFields ? { videoFields: input.videoFields } : {}), ...(input.videoVariant ? { videoVariant: input.videoVariant } : {}) }, offer: selected };
  });
  const total = shots.reduce((sum, shot) => sum + (shot.offer?.cost || 0), 0);
  const canStart = shots.length > 0 && shots.length <= 12 && shots.every(shot => shot.offer?.available && (shot.params.prompt.trim() || shot.offer.promptOptional && shot.params.media.length));
  async function start() {
    if (operation.current || disabled || checking || recoveryFailed || !uncertain && !canStart) return;
    operation.current = true; setBusy(true); setError("");
    try {
      if (!pending.current) {
        const saved = await project.save();
        pending.current = { key: requestKey(), body: { documentId: saved.id, documentVersion: saved.version, summary: text("分镜视频生成计划", "Storyboard video generation"), maxCredits: total, shots: shots.map(({ offer: _offer, ...shot }) => shot), expectedCosts: shots.map(shot => shot.offer.cost) } };
      }
      setUncertain(true);
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending.current)); } catch { /* Keep the exact pending request in memory; server listing recovers accepted plans. */ }
      const created = await api("/api/video/plans", { method: "POST", key: pending.current.key, body: pending.current.body, timeoutMs: 45000 });
      if (!created?.id) throw new Error("VIDEO_SUBMISSION_UNCONFIRMED");
      setRunId(created.id); setBudget(created.maxCredits); pending.current = null; setUncertain(false); clearRecovery();
      project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, shotRunId: created.id } } }));
      // Admission is already confirmed. Draft persistence reports its own error;
      // it must not make the accepted paid plan look like a failed submission.
      await project.save().catch(() => {});
    } catch (failure) {
      if (submissionRejected(failure)) { pending.current = null; setUncertain(false); clearRecovery(); }
      setError(failure.message);
    } finally { operation.current = false; setBusy(false); }
  }
  async function control(action) {
    if (operation.current || !run) return;
    operation.current = true; setBusy(true);
    try {
      await api(`/api/creation/runs/${run.id}/${action}`, { method: "POST", ...(action === "resume" ? { body: { expectedSequence: run.eventSequence, maxCredits: Number(budget), retryFailed: run.status === "failed" } } : {}) });
      setRevision(value => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { operation.current = false; setBusy(false); }
  }
  return <section className="vg-shot-plan">
    <h3>{text("逐镜生成视频", "Generate storyboard clips")}</h3>
    <p>{text("先审阅每镜描述与总预算，再按顺序生成。结果另存，原分镜保留；完成后逐镜比较和替换。", "Review every prompt and the total budget before sequential generation. Original scenes stay intact; compare results before replacing.")}</p>
    {checking ? <p role="status">{text("正在恢复计划…", "Recovering plan…")}</p> : runId ? <>
      {!run && <p role="status">{text("正在读取计划进度…", "Loading plan progress…")}</p>}
      {run && <><p>{text("计划状态", "Plan status")}: {videoPlanStatus(run.status, zh)} · {run.committedCredits} / {run.maxCredits} {text("积分", "credits")}</p>{run.steps.map(step => <article key={step.id}><strong>{step.position + 1}. {step.explanation}</strong><p>{step.prompt}</p><small>{videoPlanStatus(step.status, zh)} · {step.expectedCost} {text("积分", "credits")}</small>{step.result?.documentId && <Link href={`/video?document=${step.result.documentId}`}>{text("查看片段／替换此镜头", "View clip / replace this shot")}</Link>}</article>)}
        {run.errorCode && <p role="alert">{videoMessage(run.errorCode, zh)}</p>}
        {["awaiting_budget", "awaiting_input", "failed"].includes(run.status) && <><label>{text("确认总预算（含已完成镜头）", "Total budget, including completed shots")}<input type="number" min={run.committedCredits} max={200000} step={1} value={budget} onChange={event => setBudget(event.target.value)} /></label><p>{text("继续将按当前通道价格执行未完成镜头，已完成镜头不会重做。", "Continue unfinished shots at current prices. Completed shots will not run again.")}</p><button type="button" disabled={busy || !Number.isInteger(Number(budget)) || Number(budget) < run.committedCredits || Number(budget) > 200000} onClick={() => control("resume")}>{text("确认预算并继续", "Confirm budget and continue")}</button></>}
        {["queued", "running", "awaiting_budget", "awaiting_input"].includes(run.status) && <button type="button" disabled={busy} onClick={() => control("cancel")}>{text("停止后续镜头", "Stop remaining shots")}</button>}
        {["succeeded", "failed", "cancelled"].includes(run.status) && <button type="button" disabled={busy || uncertain} onClick={() => { setRunId(null); project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, shotRunId: undefined } } })); }}>{text("制定新计划", "Create another plan")}</button>}
      </>}
    </> : <>
      <VideoParameterFields caps={caps} video={settings} offer={offer} onChange={values => setSettings(current => ({ ...current, ...values }))} disabled={disabled || busy || uncertain} zh={zh} />
      {currentRows.map((row, index) => <fieldset disabled={disabled || busy || uncertain} key={row.id}><label><input type="checkbox" checked={row.selected} onChange={event => updateRow(row.id, { selected: event.target.checked })} />{index + 1}. {scenes.find(scene => scene.id === row.id)?.name}</label><textarea value={row.prompt} maxLength={4000} aria-label={text(`镜头 ${index + 1} 描述`, `Shot ${index + 1} prompt`)} onChange={event => updateRow(row.id, { prompt: event.target.value })} /><label><input type="checkbox" checked={row.reference} onChange={event => updateRow(row.id, { reference: event.target.checked })} />{text("引用此镜头当前素材", "Reference this scene’s media")}</label>{row.selected && !shots.find(shot => shot.sceneId === row.id)?.offer?.available && <small>{videoMessage(shots.find(shot => shot.sceneId === row.id)?.offer?.reason, zh)}</small>}</fieldset>)}
      <p>{shots.length} / 12 {text("镜头", "shots")} · {settings.duration}s {text("每镜", "each")} · {text("总预算", "Total budget")} {total} {text("积分", "credits")}</p>
      <button type="button" disabled={disabled || busy || checking || recoveryFailed || (!uncertain && !canStart)} onClick={start}>{text(uncertain ? "恢复原计划提交" : "确认计划与预算，开始生成", uncertain ? "Recover plan submission" : "Confirm plan and budget, then generate")}</button>
    </>}
    {uncertain && runId && <button type="button" disabled={busy || disabled} onClick={start}>{text("恢复原计划提交", "Recover plan submission")}</button>}
    {recoveryFailed && <button type="button" onClick={() => setRecoveryRevision(value => value + 1)}>{text("重试恢复计划", "Retry plan recovery")}</button>}
    {error === "PRICE_CHANGED" && onRefreshQuote && <button type="button" disabled={busy} onClick={() => { onRefreshQuote(); setError(""); }}>{text("刷新报价", "Refresh quote")}</button>}
    {(error || progressError) && <p role="alert">{videoMessage(error || progressError.message, zh)}</p>}
  </section>;
}
