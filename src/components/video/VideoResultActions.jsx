"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/NavigationLink";
import { api, requestKey } from "@/lib/client-api";
import { appendVideoScenes, replaceVideoScene, videoMediaInput } from "@/lib/video/composition-actions";
import { videoMessage } from "@/lib/video/messages";
import "./video-controls.css";

export default function VideoResultActions({ result, zh, onReuse, onReference, onMedia, sceneOrigin, allowReference = false }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [projects, setProjects] = useState(null), [target, setTarget] = useState(""), [destination, setDestination] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const pending = useRef(null), running = useRef(false), text = (cn, en) => zh ? cn : en;
  const recoveryKey = `video-composition:${result.assetId}`;
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (!live) return;
      try {
        const stored = JSON.parse(sessionStorage.getItem(recoveryKey));
        if (stored?.saveKey && stored?.content?.video?.mode === "motion") {
          pending.current = stored; setTarget(stored.id || ""); setRetrying(true); setProjects({ items: [], nextCursor: null });
        }
      } catch { /* Invalid local recovery is ignored. */ }
    });
    return () => { live = false; };
  }, [recoveryKey]);
  async function act(operation) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError("");
    try { await operation(); } catch (failure) { if (failure.message === "DOCUMENT_VERSION_CONFLICT" || [400, 413, 415, 422].includes(failure.status)) { pending.current = null; try { sessionStorage.removeItem(recoveryKey); } catch { /* Best effort cleanup. */ } } setError(failure.message); } finally { running.current = false; setRetrying(Boolean(pending.current)); setBusy(false); }
  }
  async function media() {
    const info = await api(`/api/video/results/${result.assetId}/media`, { method: "POST", timeoutMs: 55000 });
    onMedia?.(info); return info;
  }
  async function reuse() {
    const job = await api(`/api/studio/jobs/${result.sourceJobId}?inputs=1`);
    if (job.input?.tool !== "video") throw new Error("VIDEO_SOURCE_NOT_FOUND");
    onReuse?.(job.input);
  }
  async function prepareComposition() {
    const result = await api("/api/studio/documents?paged=1&kind=motion");
    setProjects(result);
  }
  async function addToComposition() {
    if (!pending.current) {
      const info = await media(), operationId = requestKey();
      const stored = target ? await api(`/api/video/documents/${target}`) : null;
      if (stored && stored.content.video.mode !== "motion") throw new Error("INVALID_MOTION_DOCUMENT");
      const video = appendVideoScenes(stored?.content.video || { mode: "motion", media: [], ratio: info.height > info.width ? "9:16" : info.height === info.width ? "1:1" : "16:9" }, info, operationId);
      pending.current = { saveKey: operationId, ...(stored ? { id: stored.id, version: stored.version } : { createKey: operationId }), name: stored?.name || text("视频分镜", "Video composition"), content: { ...(stored?.content || { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [] }), video } };
    }
    await saveComposition();
  }
  async function replaceShot() {
    if (!pending.current) {
      const info = await media();
      const stored = await api(`/api/video/documents/${sceneOrigin.documentId}`);
      const video = replaceVideoScene(stored.content.video, info, sceneOrigin);
      pending.current = { saveKey: requestKey(), id: stored.id, version: stored.version, name: stored.name, content: { ...stored.content, video } };
      setTarget(stored.id); setProjects({ items: [{ id: stored.id, name: stored.name }], nextCursor: null });
    }
    await saveComposition();
  }
  async function saveComposition() {
    try { sessionStorage.setItem(recoveryKey, JSON.stringify(pending.current)); } catch { /* In-memory replay remains available. */ }
    const saved = await api("/api/studio/documents", { method: "POST", body: pending.current, timeoutMs: 30000 });
    if (!saved?.id) throw new Error("DOCUMENT_SAVE_UNCONFIRMED");
    if (saved.replayed && !saved.acknowledged) throw new Error("DOCUMENT_VERSION_CONFLICT");
    setDestination(saved.id); pending.current = null;
    try { sessionStorage.removeItem(recoveryKey); } catch { /* Best effort cleanup. */ }
  }
  return <div className="vg-result-actions">
    <div className="vg-result-buttons">
      {onReuse && result.sourceJobId && <button type="button" disabled={busy} onClick={() => act(reuse)}>{text("复用创作参数", "Reuse settings")}</button>}
      {onReference && <button type="button" disabled={busy || !allowReference} title={!allowReference ? text("当前模型不支持视频参考", "This model does not support video references") : undefined} onClick={() => act(async () => onReference(videoMediaInput(await media())))}>{text("作为视频参考", "Use as reference")}</button>}
      <button type="button" disabled={busy} onClick={() => act(prepareComposition)}>{text("加入分镜", "Add to composition")}</button>
      {sceneOrigin && <button type="button" disabled={busy || retrying} onClick={() => act(replaceShot)}>{text("用此结果替换原镜头", "Replace the original shot")}</button>}
      {!result.posterAssetId && <button type="button" disabled={busy} onClick={() => act(media)}>{text("读取封面与时长", "Read poster and duration")}</button>}
    </div>
    {sceneOrigin?.assetId && (sceneOrigin.sourceType === "image" ? <a href={`/api/assets/${sceneOrigin.assetId}`} target="_blank" rel="noreferrer">{text("查看原分镜图片", "View original scene image")}</a> : <details><summary>{text("对比原片段（原作品保留）", "Compare original clip (kept in media)")}</summary><video src={`/api/assets/${sceneOrigin.assetId}`} controls playsInline preload="none" /></details>)}
    {projects && !destination && <div className="vg-composition-target"><label>{text("目标工程", "Composition")}<select value={target} disabled={busy || retrying} onChange={event => setTarget(event.target.value)}><option value="">{text("新建视频分镜", "New composition")}</option>{target && !projects.items.some(row => row.id === target) && <option value={target}>{text("原目标工程", "Original composition")}</option>}{projects.items.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
      {projects.nextCursor && <button type="button" disabled={busy} onClick={() => act(async () => { const next = await api(`/api/studio/documents?paged=1&kind=motion&cursor=${encodeURIComponent(projects.nextCursor)}`); setProjects(current => ({ ...next, items: [...current.items, ...next.items] })); })}>{text("更多工程", "More projects")}</button>}
      <button type="button" disabled={busy} onClick={() => act(addToComposition)}>{text(retrying ? "重试保存" : "添加片段", retrying ? "Retry save" : "Add clip")}</button></div>}
    {destination && <Link href={`/video?document=${destination}`}>{text("打开分镜工程", "Open composition")}</Link>}
    {busy && <small role="status">{text("正在处理视频素材…", "Processing video media…")}</small>}
    {error && <p role="alert">{videoMessage(error, zh)}</p>}
  </div>;
}
