"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, requestKey } from "@/lib/client-api";
import { useCreationRun } from "@/components/creation/useCreationRun";

const TERMINAL = ["succeeded", "failed", "cancelled"];
const STEP_LABEL = { generate: "frame", video: "clip", tts: "voice" };

// 每个镜头的生成状态：等待 / 正在生成首帧、视频或配音 / 完成 / 失败。
function sceneStates(run) {
  const states = {};
  if (!run) return states;
  for (const step of run.steps) {
    if (!step.sceneId) continue;
    const current = states[step.sceneId] || { state: "waiting", cost: 0 };
    current.cost += step.expectedCost || 0;
    if (["failed", "cancelled"].includes(step.status)) current.state = "failed";
    else if (current.state !== "failed" && ["queued", "running"].includes(step.status)) current.state = STEP_LABEL[step.tool] || "clip";
    else if (current.state === "waiting" && step.status === "succeeded") current.state = "partial";
    states[step.sceneId] = current;
  }
  for (const [sceneId, value] of Object.entries(states)) {
    const steps = run.steps.filter(step => step.sceneId === sceneId);
    if (steps.every(step => step.status === "succeeded")) value.state = "done";
  }
  return states;
}

export default function useStoryboardRun(project, { onFinished } = {}) {
  const [runId, setRunId] = useState(null), [revision, setRevision] = useState(0), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(null), finished = useRef(null);
  const storageKey = `storyboard-run:${project.id || "new"}`;
  useEffect(() => {
    if (!project.id) return;
    const abort = new AbortController();
    api(`/api/creation/runs?documentId=${encodeURIComponent(project.id)}`, { signal: abort.signal }).then(result => {
      const latest = result.items.find(item => item.kind === "storyboard");
      if (latest) setRunId(latest.id);
    }).catch(() => {});
    try { const stored = JSON.parse(sessionStorage.getItem(storageKey)); if (stored?.key) pending.current = stored; } catch { /* No pending submission. */ }
    return () => abort.abort();
  }, [project.id, storageKey]);
  const { run: fetched } = useCreationRun(runId, undefined, revision);
  const run = fetched?.id === runId ? fetched : null;
  const active = Boolean(run && !TERMINAL.includes(run.status));
  const states = useMemo(() => sceneStates(run), [run]);
  useEffect(() => {
    if (!run || !TERMINAL.includes(run.status) || finished.current === `${run.id}:${run.status}`) return;
    finished.current = `${run.id}:${run.status}`;
    onFinished?.(run);
  }, [run, onFinished]);

  const quote = useCallback(async (sceneIds, provider) => {
    const saved = await project.save();
    return { ...await api("/api/video/storyboards/quote", { method: "POST", body: { documentId: saved.id, sceneIds, ...(provider ? { provider } : {}) }, timeoutMs: 30000 }), documentId: saved.id };
  }, [project]);

  const start = useCallback(async ({ sceneIds, provider, quoted }) => {
    if (busy) return null;
    setBusy(true); setError("");
    try {
      const body = { documentId: quoted.documentId, documentVersion: quoted.documentVersion, sceneIds, ...(provider ? { provider } : {}), maxCredits: quoted.total, expectedTotal: quoted.total };
      // 同一请求重试沿用同一幂等键，网络中断后不会重复扣费。
      if (!pending.current || JSON.stringify(pending.current.body) !== JSON.stringify(body)) pending.current = { key: requestKey(), body };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending.current)); } catch { /* In-memory key still protects this tab. */ }
      const created = await api("/api/video/storyboards", { method: "POST", key: pending.current.key, body, timeoutMs: 45000 });
      pending.current = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* Best effort. */ }
      setRunId(created.id); setRevision(value => value + 1);
      return created;
    } catch (failure) { setError(failure.message); return null; }
    finally { setBusy(false); }
  }, [busy, storageKey]);

  const control = useCallback(async action => {
    if (!run || busy) return;
    setBusy(true); setError("");
    try {
      const remaining = run.steps.filter(step => step.status !== "succeeded").reduce((sum, step) => sum + (step.expectedCost || 0), 0);
      await api(`/api/creation/runs/${run.id}/${action}`, { method: "POST", ...(action === "resume" ? { body: { expectedSequence: run.eventSequence, maxCredits: run.committedCredits + remaining, retryFailed: run.steps.some(step => step.status === "failed") } } : {}) });
      setRevision(value => value + 1);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }, [run, busy]);

  return { run, active, states, busy, error, setError, quote, start, retry: () => control("resume"), cancel: () => control("cancel") };
}
