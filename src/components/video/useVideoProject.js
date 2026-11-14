"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import { submissionRejected } from "@/lib/studio/submission-recovery";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { promptTitle } from "@/lib/studio/project-title";
import { uploadImage } from "@/lib/upload-image";
import { registerNavigationGuard } from "@/lib/navigation-guard";
import { appendVideoReference, referenceRole } from "@/lib/video/references";

export const FRAME_SIZES = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024", "4:5": "1024x1536" };
const blank = (mode, provider, initialVideo, initialPrompt) => ({ name: mode === "motion" ? "分镜成片" : "单镜头视频", content: { schemaVersion: 1, layers: [], messages: [], jobs: [], appliedJobs: [], video: { ...(provider ? { provider } : {}), media: [], composition: null, ratio: "16:9", duration: 5, ...initialVideo, mode, prompt: initialPrompt || initialVideo?.prompt || "" } } });
export default function useVideoProject({ documentId, mode, userId, guardNavigation = false, initialProvider, initialVideo, initialPrompt }) {
  const [draft, setDraft] = useState(() => blank(mode, initialProvider, initialVideo, initialPrompt)), live = useRef(draft);
  const [id, setId] = useState(documentId), idRef = useRef(documentId), version = useRef(null);
  const [loading, setLoading] = useState(Boolean(documentId)), [error, setError] = useState(""), [jobs, setJobs] = useState([]);
  const [loadFailed, setLoadFailed] = useState(false), [jobsLoading, setJobsLoading] = useState(Boolean(documentId)), [pollEpoch, setPollEpoch] = useState(0);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false), [working, setWorking] = useState(false), [uploadProgress, setUploadProgress] = useState("");
  const serial = useRef(Promise.resolve()), pendingSave = useRef(null), revision = useRef(0), savedRevision = useRef(0), mounted = useRef(true), submitting = useRef(false), createKey = useRef(null), submission = useRef(null);
  const storageKey = `video-draft:${userId}:${documentId || mode}`;
  const [recovery, setRecovery] = useState(null);
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const flushOnUnmount = useRef(null);
  const saveError = useRef("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = useCallback(transform => {
    const next = typeof transform === "function" ? transform(live.current) : transform;
    live.current = next; revision.current++; setDraft(next); setDirty(true);
    try { localStorage.setItem(storageKey, JSON.stringify({ draft: next, id: idRef.current, version: version.current, pendingSave: pendingSave.current, createKey: createKey.current })); } catch { /* Server save remains available. */ }
  }, [storageKey]);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (abort.signal.aborted) return;
      let stored, pending;
      try { stored = JSON.parse(localStorage.getItem(storageKey)); if (stored?.draft?.content?.video) setRecovery(stored); } catch { /* Invalid recovery data. */ }
      try { pending = JSON.parse(sessionStorage.getItem(`${storageKey}:submission`)); } catch { /* Invalid recovery data. */ }
      if (pending?.body && pending?.key) { submission.current = pending; setPendingSubmission(true); }
      const targetId = documentId || pending?.body?.documentId;
      if (!targetId) return;
      setLoading(true); setJobsLoading(true); idRef.current = targetId; setId(targetId);
      try {
        const row = await api(`/api/video/documents/${targetId}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        version.current = row.version; live.current = { name: row.name, content: row.content }; setDraft(live.current);
      } catch (failure) { if (!abort.signal.aborted) { setLoadFailed(true); setError(failure.message); } }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [documentId, storageKey]);

  const save = useCallback(() => {
    const operation = async () => {
      if (loading || loadFailed) throw new Error("DOCUMENT_NOT_LOADED");
      if (savedRevision.current === revision.current && idRef.current && !pendingSave.current) return { id: idRef.current, version: version.current };
      setSaving(true);
      try {
        while (!idRef.current || savedRevision.current !== revision.current || pendingSave.current) {
          if (!pendingSave.current) {
            createKey.current ||= requestKey();
            pendingSave.current = { sequence: revision.current, body: { ...live.current, saveKey: requestKey(), ...(idRef.current ? { id: idRef.current, version: version.current } : { createKey: createKey.current }) } };
          }
          const request = pendingSave.current;
          try { localStorage.setItem(storageKey, JSON.stringify({ draft: live.current, id: idRef.current, version: version.current, pendingSave: request, createKey: createKey.current })); } catch { /* In-memory recovery remains available. */ }
          const row = await api("/api/studio/documents", { method: "POST", body: request.body, timeoutMs: 30000 });
          if (!row?.id || !row?.version) throw new Error("DOCUMENT_SAVE_UNCONFIRMED");
          if (row.replayed && !row.acknowledged) throw new Error("DOCUMENT_VERSION_CONFLICT");
          idRef.current = row.id; version.current = row.version; savedRevision.current = request.sequence; pendingSave.current = null;
          if (savedRevision.current !== revision.current) {
            try { localStorage.setItem(storageKey, JSON.stringify({ draft: live.current, id: row.id, version: row.version })); } catch { /* Server save remains available. */ }
          }
          if (mounted.current) setId(row.id);
          invalidateProjectLists(userId);
        }
        if (mounted.current) {
          setDirty(false);
          const resolvedError = saveError.current;
          if (resolvedError) setError(current => current === resolvedError ? "" : current);
        }
        saveError.current = "";
        try { localStorage.removeItem(storageKey); } catch { /* Recovery cleanup is best effort. */ }
        return { id: idRef.current, version: version.current };
      } catch (failure) {
        // Definitively rejected payloads must not be replayed forever after the
        // user corrects a field. Retain uncertain requests for safe retries.
        if ([400, 413, 415, 422].includes(failure.status) || failure.status === 409 && ["DOCUMENT_VERSION_CONFLICT", "VIDEO_ORIGIN_CHANGED", "SAVE_KEY_REUSED"].includes(failure.code || failure.message)) {
          pendingSave.current = null;
          // Keep the user's draft, but do not restore a definitively rejected
          // request after reopening. A fresh server version is loaded first;
          // applying the local draft still requires the user's Restore action.
          try { localStorage.setItem(storageKey, JSON.stringify({ draft: live.current, id: idRef.current, version: version.current, pendingSave: null, createKey: createKey.current })); } catch { /* The current tab retains the draft. */ }
        }
        saveError.current = failure.message;
        if (mounted.current) setError(failure.message); throw failure;
      }
      finally { if (mounted.current) setSaving(false); }
    };
    const result = serial.current.then(operation); serial.current = result.catch(() => {}); return result;
  }, [storageKey, userId, loading, loadFailed]);
  useEffect(() => {
    flushOnUnmount.current = () => { if (userId && !loading && !loadFailed && revision.current !== savedRevision.current) void save().catch(() => {}); };
  }, [userId, loading, loadFailed, save]);
  useEffect(() => () => { if (guardNavigation) flushOnUnmount.current?.(); }, [guardNavigation]);
  useEffect(() => {
    if (!guardNavigation) return;
    return registerNavigationGuard({
      prepare: async () => { if (revision.current !== savedRevision.current || pendingSave.current) await save(); },
      onError: failure => setError(failure.message),
    });
  }, [guardNavigation, save]);
  useEffect(() => {
    if (!userId || !dirty || loading || working || error) return;
    const timer = setTimeout(() => { void save().catch(() => {}); }, 800);
    return () => clearTimeout(timer);
  }, [userId, dirty, draft, loading, working, error, save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!id || loading || loadFailed) return;
    const abort = new AbortController(); let timer, busy = false, hasActive = false;
    const poll = async () => {
      if (busy || abort.signal.aborted) return;
      busy = true; clearTimeout(timer);
      try {
        const rows = (await api(`/api/studio/jobs?documentId=${id}&recover=1`, { signal: abort.signal })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (abort.signal.aborted) return;
        hasActive = rows.some(job => !terminalStatus(job.status));
        setJobs(current => JSON.stringify(current) === JSON.stringify(rows) ? current : rows); setJobsLoading(false);
        const ready = rows.filter(job => job.status === "succeeded" && !live.current.content.appliedJobs.includes(job.id));
        if (ready.length && !submitting.current) {
          setApplying(true);
          await serial.current;
          if (abort.signal.aborted) return;
          const stored = await api(`/api/video/documents/${id}`, { signal: abort.signal });
          if (stored.version !== version.current) {
            if (savedRevision.current !== revision.current) throw new Error("DOCUMENT_VERSION_CONFLICT");
            version.current = stored.version; live.current = { name: stored.name, content: stored.content }; setDraft(live.current);
          }
          change(current => {
            const content = { ...current.content, video: { ...current.content.video }, layers: [...current.content.layers], messages: [...current.content.messages], appliedJobs: [...current.content.appliedJobs] };
            for (const job of [...ready].reverse()) {
              if (content.appliedJobs.includes(job.id)) continue;
              // 首帧候选图只在候选条中展示，不进入视频作品列表。
              if (job.tool === "generate") { content.appliedJobs.push(job.id); continue; }
              if (job.resultData?.motion) { content.video.composition = job.resultData.motion; content.video.ratio = job.resultData.motion.ratio; content.video.confirmed = true; }
              for (const asset of job.resultData?.assets || []) if (!content.layers.some(layer => layer.assetId === asset.id)) content.layers.push({ id: `video-${job.id}`, assetId: asset.id, type: "video", name: `${current.name}.mp4`, x: 0, y: 0, width: asset.width || 1280, height: asset.height || 720, rotation: 0, visible: true, opacity: 1, sourceJobId: job.id, ...(asset.posterAssetId ? { posterAssetId: asset.posterAssetId } : {}), ...(asset.duration ? { duration: asset.duration } : {}) });
              content.messages.push({ id: `result-${job.id}`, role: "assistant", text: job.resultData?.motion ? "分镜已就绪：可以在分镜表里直接修改画面、旁白和时长，确认后点击「生成视频」。也可以继续告诉我想怎么改。" : job.tool === "motion-render" ? "成片已导出，可以播放和下载。" : "视频已完成，可以播放和下载。" });
              content.appliedJobs.push(job.id);
            }
            return { ...current, content };
          });
          await save();
        }
      } catch (failure) { if (!abort.signal.aborted) setError(failure.message); }
      finally { busy = false; if (!abort.signal.aborted) { setApplying(false); timer = setTimeout(poll, document.hidden ? 30000 : hasActive ? 3000 : 15000); } }
    };
    const wake = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", wake); window.addEventListener("focus", wake);
    void poll(); return () => { abort.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); };
  }, [id, loading, loadFailed, pollEpoch, change, save]);

  async function submit(tool, prompt, offer, restore = false) {
    if (submitting.current || loading || loadFailed || applying || !restore && (jobsLoading || jobs.some(job => !terminalStatus(job.status)) || !offer?.available)) return;
    submitting.current = true; setWorking(true); setError("");
    try {
      const fingerprint = JSON.stringify({ tool, prompt, video: live.current.content.video });
      if (!submission.current) { try { submission.current = JSON.parse(sessionStorage.getItem(`${storageKey}:submission`)); } catch { /* No persisted submission. */ } }
      if (restore && !submission.current?.body) return null;
      if (!restore && submission.current?.body && submission.current.fingerprint !== fingerprint) throw new Error("VIDEO_SUBMISSION_UNCONFIRMED");
      if (!submission.current || !restore && submission.current.fingerprint !== fingerprint) {
        submission.current = { key: requestKey(), fingerprint, body: null };
        if (prompt && tool !== "generate") change(current => ({ ...current, name: current.content.messages.length ? current.name : promptTitle(prompt), content: { ...current.content, messages: [...current.content.messages, { id: requestKey(), role: "user", text: prompt }] } }));
      }
      const pending = submission.current;
      if (!pending.body) {
        const saved = await save(), video = live.current.content.video;
        const source = video.media.find(item => item.type === "image");
        pending.body = { origin: "chat", tool, ...(tool === "video" && offer.provider ? { provider: offer.provider } : {}), expectedCost: offer.cost, documentId: saved.id, documentVersion: saved.version, ...(tool === "video" && source ? { assetId: source.id } : {}),
          params: tool === "generate" ? { prompt, size: FRAME_SIZES[video.ratio] || "1024x1024" } : { prompt, ratio: video.ratio, duration: video.duration, media: video.media, ...(tool === "video" && video.videoVariant ? { videoVariant: video.videoVariant } : {}), ...(tool === "video" && video.videoFields ? { videoFields: video.videoFields } : {}), ...(["motion-plan", "motion-render"].includes(tool) && video.composition ? { motion: video.composition } : {}) } };
      }
      if (restore && !idRef.current && pending.body.documentId) {
        idRef.current = pending.body.documentId; version.current = pending.body.documentVersion; setId(pending.body.documentId);
      }
      try { sessionStorage.setItem(`${storageKey}:submission`, JSON.stringify(pending)); } catch { /* In-memory idempotency still protects this tab. */ }
      setPendingSubmission(true);
      const job = await api("/api/studio/jobs", { method: "POST", key: pending.key, body: pending.body, timeoutMs: 45000 });
      if (!job?.id || !job?.documentId) throw new Error("VIDEO_SUBMISSION_UNCONFIRMED");
      setJobs(current => [job, ...current.filter(row => row.id !== job.id)]); submission.current = null; setPendingSubmission(false);
      try { sessionStorage.removeItem(`${storageKey}:submission`); } catch { /* Best effort cleanup. */ }
      change(current => ({ ...current, content: { ...current.content, jobs: [...new Set([...current.content.jobs, job.id])].slice(-100) } }));
      // Admission has succeeded. A subsequent save failure must not tell the user
      // that generation failed or encourage another paid submission.
      await save().catch(() => {}); setPollEpoch(value => value + 1); return job;
    } catch (failure) {
      if (submissionRejected(failure)) { submission.current = null; setPendingSubmission(false); try { sessionStorage.removeItem(`${storageKey}:submission`); } catch { /* Best effort cleanup. */ } }
      setError(failure.message); return null;
    } finally { submitting.current = false; setWorking(false); }
  }
  async function upload(files, offer, replaceId) {
    if (submitting.current || loading || loadFailed || applying) return; submitting.current = true; setWorking(true); setError("");
    try {
      const incoming = Array.from(files);
      if (replaceId && incoming.length !== 1) throw new Error("VIDEO_REPLACE_ONE_FILE");
      for (const file of incoming) {
        const video = live.current.content.video;
        const replacement = replaceId ? video.media.find(item => item.id === replaceId) : null;
        if (replaceId && !replacement) throw new Error("VIDEO_MEDIA_CHANGED");
        if (replaceId && (video.composition?.scenes.some(scene => scene.assetId === replaceId) || video.composition?.audio?.assetId === replaceId)) throw new Error("VIDEO_MEDIA_IN_USE");
        const remaining = video.media.filter(item => item.id !== replaceId);
        const limits = offer?.mediaLimits || { image: 1, video: 0, audio: 0 };
        const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name) ? "audio" : "video";
        if (replacement && replacement.type !== type) throw new Error("VIDEO_REPLACE_TYPE_MISMATCH");
        if (remaining.length >= (video.mode === "video" ? 50 : 40) || video.mode === "video" && remaining.filter(item => item.type === type).length >= (limits[type] || 0)) throw new Error("VIDEO_MEDIA_LIMIT");
        setUploadProgress(`正在上传 ${file.name}`);
        let media;
        if (file.type.startsWith("image/")) { const asset = await uploadImage(file); media = { id: asset.assetId, name: file.name.slice(0, 160), type: "image", duration: 0 }; }
        else {
          if (file.size > 64 * 1024 * 1024) throw new Error("VIDEO_MEDIA_TOO_LARGE");
          const response = await fetch(`/api/video/media?kind=${video.mode}&extension=${encodeURIComponent(file.name.split(".").at(-1).toLowerCase())}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
          const result = await response.json(); if (!response.ok) throw new Error(result.code || "VIDEO_MEDIA_INVALID");
          media = { id: result.id, type: result.type, duration: result.duration, proof: result.proof, name: file.name.slice(0, 160) };
        }
        if (video.mode === "video") media.role = replacement ? referenceRole(replacement, video.media.indexOf(replacement), video.media, offer?.referenceLayout || "reference") : referenceRole(media, video.media.length, [...video.media, media], offer?.referenceLayout || "reference");
        change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, media: replaceId ? current.content.video.media.map(item => item.id === replaceId ? media : item) : video.mode === "video" ? appendVideoReference(current.content.video.media, media, offer?.referenceLayout || "reference") : [...current.content.video.media, media] } } }));
        await save();
      }
    } catch (failure) { setError(failure.message); }
    finally { submitting.current = false; setWorking(false); setUploadProgress(""); }
  }
  // 服务端写回分镜结果后同步最新工程；本地有未保存修改时不覆盖。
  async function refresh() {
    await serial.current;
    if (!idRef.current || savedRevision.current !== revision.current || pendingSave.current) return false;
    const stored = await api(`/api/video/documents/${idRef.current}`);
    if (savedRevision.current !== revision.current || stored.version === version.current) return false;
    version.current = stored.version; live.current = { name: stored.name, content: stored.content }; setDraft(live.current);
    return true;
  }
  return { id, draft, change, save, refresh, jobs, loading, loadFailed, jobsLoading, applying, error, setError, saving, dirty, working, uploadProgress, upload, submit, recovery, pendingSubmission,
    recoverSubmission: () => submit(null, "", null, true),
    recover() { if (recovery) { if (!documentId && recovery.id) { idRef.current = recovery.id; version.current = recovery.version; setId(recovery.id); } pendingSave.current = recovery.pendingSave || null; createKey.current = recovery.createKey || pendingSave.current?.body?.createKey || createKey.current; if (pendingSave.current) pendingSave.current = { ...pendingSave.current, sequence: revision.current }; setError(""); change(recovery.draft); setRecovery(null); } },
    discardRecovery() { setRecovery(null); localStorage.removeItem(storageKey); },
    active: jobs.some(job => !terminalStatus(job.status)),
    async cancel(job) { try { await api(`/api/studio/jobs/${job.id}`, { method: "DELETE" }); setJobs(current => current.map(row => row.id === job.id ? { ...row, cancelRequested: true } : row)); } catch (failure) { setError(failure.message); } },
  };
}
