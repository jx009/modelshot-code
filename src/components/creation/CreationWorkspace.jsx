"use client";

import { sheetGenerationCalls } from "@/lib/creation/sheet-generation-policy";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, FileImage, LoaderCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, Paperclip, TriangleAlert, SlidersHorizontal, RefreshCw, X } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import ReferenceAssets, { referenceAssetIds } from "./ReferenceAssets";
import ReferenceFiles from "./ReferenceFiles";
import WorkspaceSplit from "./WorkspaceSplit";
import ConversationViewport from "./ConversationViewport";
import { mergeConversationWindow } from "@/lib/creation/conversation-window";
import ProjectFiles from "./ProjectFiles";
import AutoGrowTextarea from "@/components/ui/AutoGrowTextarea";
import { useCreationRun } from "./useCreationRun";
import { creationError } from "./creation-errors";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { useCreationNavigationGuard } from "./useCreationNavigationGuard";
import { posterImageChoice } from "@/lib/creation/poster-image-choice";
import ArtifactEditor, { warmCreationEditor } from "./CreationArtifactEditor";
import CreationMessage from "./CreationMessage";
import CreationTaskStatus, { RunStatusStrip } from "./CreationTaskStatus";
import { publishedArtifactRevisions } from "@/lib/creation/published-artifact-revisions";
import { publishWorkspaceTitle } from "@/lib/creation/client/workspace-title";
import "./creation.css";
import "./workbench.css";

const OutlineReview = lazy(() => import("./OutlineReview"));
const compactQuery = "(max-width:760px)";
const compactSnapshot = () => Boolean(window.matchMedia?.(compactQuery).matches);
const wideServerSnapshot = () => false;
function subscribeCompact(onChange) {
  const media = window.matchMedia?.(compactQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
const active = status => ["queued", "running", "cancelling"].includes(status);

export default function CreationWorkspace({ userId, projectId, initialSessionId, initialFileId, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const [project, setProject] = useState(null), [sessionId, setSessionId] = useState(null), [messages, setMessages] = useState({ items: [], nextCursor: null });
  const [caps, setCaps] = useState(null), [runId, setRunId] = useState(null), [fileId, setFileId] = useState(null), [loadedFormat, setLoadedFormat] = useState(null), [editorEpoch, setEditorEpoch] = useState(0);
  const [prompt, setPrompt] = useState(""), [reference, setReference] = useState(null), [pages, setPages] = useState(10), [ratio, setRatio] = useState("1080x1440");
  const [sectionCount, setSectionCount] = useState(6), [sheetCount, setSheetCount] = useState(1), [targetRows, setTargetRows] = useState(20);
  const [budget, setBudget] = useState(""), [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [loading, setLoading] = useState(true);
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, wideServerSnapshot);
  const [treePreference, setTreeOpen] = useState(null), [mobileTab, setMobileTab] = useState("chat"), [stepsOpen, setStepsOpen] = useState(false), [updatedFile, setUpdatedFile] = useState(null);
  const treeOpen = treePreference ?? !compact;
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [assetIds, setAssetIds] = useState([]);
  const [referenceIds, setReferenceIds] = useState([]);
  const [generateImage, setGenerateImage] = useState(true);
  const [outlineRunId, setOutlineRunId] = useState(null);
  const [resources, setResources] = useState(null), [editingFile, setEditingFile] = useState(null);
  const observeEditing = useCallback((id, editing) => setEditingFile(current => editing ? id : current === id ? null : current), []);
  const [publishedRevisions, setPublishedRevisions] = useState({});
  const publications = useRef({});
  const [revision, setRevision] = useState(0), [moreBusy, setMoreBusy] = useState(false);
  const editor = useRef(null), life = useRef(null), gate = useRef(false), pendingRequest = useRef(null), session = useRef(null), finalSeen = useRef(null), refreshSequence = useRef(0);
  const composerDraft = useRef(null), composerTimer = useRef(null);
  const conversation = useRef(null), latestRequested = useRef(false), messageEpoch = useRef(0), paging = useRef(false);
  const journalKey = `creation-submit:${userId}:${projectId}:${initialSessionId || "default"}`;
  const draftKey = `creation-composer:${userId}:${projectId}:${initialSessionId || "default"}`;
  const notify = useCallback(failure => setError(failure), []);
  const workspaceRoot = useRef(null), outlineEditor = useRef(null);
  const leaving = useCreationNavigationGuard({ root: workspaceRoot, gate, onError: notify, prepare: async () => {
    clearTimeout(composerTimer.current);
    const snapshot = composerDraft.current;
    if (snapshot) {
      try { sessionStorage.setItem(snapshot.key, snapshot.value); }
      catch { throw new Error("CREATION_COMPOSER_SAVE_FAILED"); }
    }
    if (outlineRunId && outlineEditor.current) await outlineEditor.current.flush();
    if (editor.current) await editor.current.flush();
  } });
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    async function load() {
      setLoading(true); setError(null);
      try {
        void api("/api/creation/capabilities", { signal: controller.signal }).then(capability => {
          if (!controller.signal.aborted) setCaps(capability);
        }).catch(failure => {
          if (!controller.signal.aborted) setError(failure);
        });
        const value = await api(`/api/creation/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const chosen = initialSessionId || value.sessions[0]?.id;
        if (!chosen || !value.sessions.some(item => item.id === chosen)) throw new Error("CREATION_SESSION_NOT_FOUND");
        warmCreationEditor(value.kind);
        session.current = chosen; setSessionId(chosen); setProject(value);
        const firstFileId = initialFileId || value.artifacts[0]?.id || null;
        setFileId(current => current || firstFileId);
        const [history, runs] = await Promise.all([api(`/api/creation/sessions/${chosen}/messages`, { signal: controller.signal }), api(`/api/creation/runs?sessionId=${chosen}`, { signal: controller.signal })]);
        if (controller.signal.aborted) return;
        setMessages(history);
        const rootRuns = runs.items.filter(item => !item.parentRunId);
        const latestRun = rootRuns.find(item => active(item.status) || item.status.startsWith("awaiting_")) || rootRuns[0] || runs.items[0];
        finalSeen.current = latestRun && !active(latestRun.status) ? `${latestRun.id}:${latestRun.eventSequence}` : null;
        setRunId(latestRun?.id || null);
        if (latestRun?.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED" && !initialFileId) setOutlineRunId(latestRun.kind === "agent" ? latestRun.steps?.find(step => step.status !== "succeeded" && step.result?.childRunId)?.result.childRunId : latestRun.id);
        setRatio(value.kind === "slides" ? "1920x1080" : "1080x1440"); setPages(value.kind === "web" ? 1 : 10);
        try {
          const saved = JSON.parse(sessionStorage.getItem(journalKey) || "null"), draft = JSON.parse(sessionStorage.getItem(draftKey) || "null");
          if (saved?.key && saved?.body && saved.sessionId === chosen) {
            pendingRequest.current = saved; setPending(saved); setPrompt(saved.body.prompt); setAssetIds(referenceAssetIds(saved.body.assetIds)); setReferenceIds(referenceAssetIds(saved.body.referenceIds)); setGenerateImage(Boolean(saved.body.image));
            if (saved.body.width && saved.body.height) setRatio(`${saved.body.width}x${saved.body.height}`); setPages(saved.body.pageCount || 1); setBudget(String(saved.body.maxCredits));
            const target = saved.body.target;
            if (target) {
              const selected = saved.body.kind === "web" ? { kind: "web", fileIds: target.fileIds, paths: target.paths }
                : saved.body.kind === "document" ? target.format === "univer-document-1" ? { kind: "document", format: target.format, unitId: target.unitId, segmentId: target.segmentId, spans: target.spans, baseRevision: target.baseRevision } : { kind: "document", sectionId: target.sectionId, blockIds: target.blockIds }
                  : saved.body.kind === "sheet" ? target.format === "univer-sheet-1" ? { kind: "sheet", format: target.format, unitId: target.unitId, sheetId: target.sheetId, cells: target.cells, baseRevision: target.baseRevision } : { kind: "sheet", sheetId: target.sheetId, addresses: target.addresses }
                    : { pageId: target.pageId, nodeId: target.nodeIds?.[0] };
              setReference({ artifactId: target.artifactId, ...selected, label: zh ? "上次选中的内容" : "Previously selected content" });
              setFileId(target.artifactId);
            }
          }
          else if (draft && typeof draft.prompt === "string") { setPrompt(draft.prompt.slice(0, 12000)); setReference(draft.reference || null); setAssetIds(referenceAssetIds(draft.assetIds)); setReferenceIds(referenceAssetIds(draft.referenceIds));
            setGenerateImage(draft.generateImage ?? true);
            if (["1080x1440", "1080x1080", "1920x1080", "1080x1920"].includes(draft.ratio)) setRatio(draft.ratio);
            if (Number.isInteger(draft.pages) && draft.pages >= 1 && draft.pages <= 100) setPages(draft.pages);
            if (Number.isInteger(draft.sectionCount) && draft.sectionCount >= 1 && draft.sectionCount <= 50) setSectionCount(draft.sectionCount);
            setAgentMode(draft.agentMode === true);
            if (Number.isInteger(draft.sheetCount) && draft.sheetCount >= 1 && draft.sheetCount <= 5) setSheetCount(draft.sheetCount);
            if (Number.isInteger(draft.targetRows) && draft.targetRows >= 1 && draft.targetRows <= 500) setTargetRows(draft.targetRows);
          }
        } catch { /* Cloud state remains available if local storage is disabled. */ }
      } catch (failure) { if (!controller.signal.aborted) setError(failure); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [projectId, initialSessionId, initialFileId, journalKey, draftKey, revision, zh]);
  const listedKind = project?.artifacts?.find(item => item.id === fileId)?.kind;
  const fileKind = listedKind || (loadedFormat?.id === fileId ? loadedFormat.kind : null);
  useEffect(() => {
    if (!fileId || !project || listedKind) return;
    const controller = new AbortController();
    void api(`/api/creation/artifacts/${encodeURIComponent(fileId)}/format`, { signal: controller.signal })
      .then(format => { if (!controller.signal.aborted && format.id === fileId) setLoadedFormat({ id: fileId, kind: format.kind }); })
      .catch(failure => { if (!controller.signal.aborted) notify(failure); });
    return () => controller.abort();
  }, [fileId, project, listedKind, notify]);
  useEffect(() => {
    if (loading || !sessionId) return;
    const snapshot = { key: draftKey, value: JSON.stringify({ prompt, reference, assetIds, referenceIds, ratio, pages, sectionCount, sheetCount, targetRows, generateImage, agentMode }) };
    composerDraft.current = snapshot;
    composerTimer.current = setTimeout(() => { try { sessionStorage.setItem(snapshot.key, snapshot.value); } catch { /* Sending still requires a durable pending journal. */ } }, 300);
    return () => clearTimeout(composerTimer.current);
  }, [prompt, reference, assetIds, referenceIds, ratio, pages, sectionCount, sheetCount, targetRows, generateImage, agentMode, draftKey, loading, sessionId]);
  useEffect(() => {
    const save = () => {
      clearTimeout(composerTimer.current);
      const snapshot = composerDraft.current;
      if (snapshot) { try { sessionStorage.setItem(snapshot.key, snapshot.value); } catch { /* Pending submissions have their own required journal. */ } }
    };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { save(); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const refreshContent = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const signal = life.current?.signal, currentSession = session.current;
    if (!signal || signal.aborted || !currentSession) return;
    const [value, history] = await Promise.all([api(`/api/creation/projects/${projectId}`, { signal }), api(`/api/creation/sessions/${currentSession}/messages`, { signal })]);
    if (signal.aborted || sequence !== refreshSequence.current) return;
    const newer = Object.fromEntries(value.artifacts.filter(item => Number.isInteger(item.currentRevision) && item.currentRevision > (publications.current[item.id] || 0)).map(item => [item.id, item.currentRevision]));
    if (Object.keys(newer).length) { publications.current = { ...publications.current, ...newer }; setPublishedRevisions(publications.current); }
    const latest = latestRequested.current; latestRequested.current = false;
    if (latest) conversation.current?.followLatest();
    setProject(value); setMessages(current => mergeConversationWindow(current, history, latest ? "latest" : "refresh"));
  }, [projectId]);
  function latestMessages() {
    latestRequested.current = true; messageEpoch.current++;
    void refreshContent().catch(notify);
  }
  const onRunChange = useCallback(run => {
    const revisions = publishedArtifactRevisions(run.steps);
    const changed = Object.entries(revisions).filter(([id, version]) => version > (publications.current[id] || 0));
    if (changed.length) {
      publications.current = { ...publications.current, ...Object.fromEntries(changed) };
      setPublishedRevisions(publications.current);
      const id = changed.at(-1)[0];
      setFileId(current => current || id);
      setUpdatedFile(id);
      invalidateProjectLists(userId);
    }
    if (active(run.status)) {
      if (changed.length) void refreshContent().catch(notify);
      return;
    }
    const key = `${run.id}:${run.eventSequence}`;
    if (finalSeen.current === key) return;
    finalSeen.current = key;
    if (run.errorCode === "CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED") setBudget(String(run.committedCredits + run.steps.filter(step => step.status !== "succeeded").reduce((sum, step) => sum + step.expectedCost, 0)));
    invalidateProjectLists(userId);
    if (run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED") setOutlineRunId(run.kind === "agent" ? run.steps.find(step => step.status !== "succeeded" && step.result?.childRunId)?.result.childRunId : run.id);
    void refreshContent().catch(notify);
  }, [refreshContent, notify, userId]);
  const observed = useCreationRun(runId, onRunChange, revision), run = observed.run?.id === runId ? observed.run : null;
  const occupied = run && (active(run.status) || run.status.startsWith("awaiting_"));
  const kind = reference ? fileKind || project?.kind : project?.kind, useAgent = agentMode, enabled = Boolean(caps?.[useAgent ? "agent" : kind]);
  const estimatedCalls = reference ? 1 : kind === "slides" ? pages + 1 : kind === "document" ? sectionCount + 1 : kind === "sheet" ? sheetGenerationCalls(sheetCount, targetRows) : 1;
  const imageChoice = pending ? pending.body.image : !useAgent && kind === "poster" && !reference ? posterImageChoice(caps, ratio) : null;
  const withImage = Boolean(imageChoice && generateImage && assetIds.length < 8);
  const estimated = pending ? pending.body.maxCredits : (caps?.languageUnitCost ?? 0) * (useAgent ? 1 : estimatedCalls) + (withImage ? imageChoice.expectedCost : 0);
  const title = project?.name || text("AI 创作", "AI Creation");
  useEffect(() => publishWorkspaceTitle(projectId, title), [projectId, title]);

  async function selectFile(id, reload = false, selectedKind = null) {
    if (gate.current) return;
    gate.current = true;
    try {
      if (outlineRunId && outlineEditor.current) await outlineEditor.current.flush();
      if (fileId && editor.current) await editor.current.flush();
      if (life.current?.signal.aborted) return;
      setFileId(id); setLoadedFormat({ id, kind: selectedKind || project?.artifacts?.find(item => item.id === id)?.kind || null }); setOutlineRunId(null); setReference(null); setMobileTab("artwork");
      if (reload && !["slides", "poster"].includes(selectedKind || fileKind)) { setEditorEpoch(value => value + 1); setUpdatedFile(null); }
      if (reload && ["slides", "poster"].includes(selectedKind || fileKind)) void refreshContent().catch(notify);
    } catch (failure) { notify(failure); }
    finally { gate.current = false; }
  }
  async function openOutline(id) {
    if (gate.current) return;
    gate.current = true;
    try {
      if (outlineRunId && outlineEditor.current) await outlineEditor.current.flush();
      if (editor.current) await editor.current.flush();
      if (!life.current.signal.aborted) { setOutlineRunId(id); setMobileTab("artwork"); }
    } catch (failure) { notify(failure); }
    finally { gate.current = false; }
  }
  async function closeOutline() {
    if (gate.current) return;
    gate.current = true;
    try { if (outlineEditor.current) await outlineEditor.current.flush(); if (!life.current.signal.aborted) setOutlineRunId(null); }
    catch (failure) { notify(failure); }
    finally { gate.current = false; }
  }
  function outlineConfirmed(result) {
    setOutlineRunId(null); finalSeen.current = null; setRunId(result.parentRunId || result.id); setRevision(value => value + 1);
  }
  async function send(event) {
    event.preventDefault();
    if ((editingFile && editingFile === fileId) || gate.current || !sessionId || (!pendingRequest.current && (!prompt.trim() || !enabled || occupied))) return;
    gate.current = true; setBusy(true); setError(null);
    const signal = life.current.signal;
    try {
      let submission = pendingRequest.current;
      if (!submission) {
        const [width, height] = ratio.split("x").map(Number);
        let target;
        if (reference) {
          if (reference.artifactId !== fileId || !editor.current) throw new Error("LANGUAGE_SELECTION_CHANGED");
          const saved = await editor.current.flush();
          if (kind === "document" && reference.format === "univer-document-1") {
            const { nativeDocumentTargetFromReference } = await import("@/lib/creation/native-document-edit");
            target = nativeDocumentTargetFromReference(reference, saved, fileId);
          } else if (kind === "sheet" && reference.format === "univer-sheet-1") {
            const { nativeSheetTargetFromReference } = await import("@/lib/creation/native-sheet-edit");
            target = nativeSheetTargetFromReference(reference, saved, fileId);
          } else if (kind === "web") {
            const { validateWebSelection } = await import("@/lib/creation/web-selection");
            validateWebSelection(reference, saved.content);
            target = { artifactId: fileId, baseRevision: saved.revision, fileIds: reference.fileIds, paths: reference.paths };
          } else if (kind === "document") {
            const { validateDocumentSelection } = await import("@/lib/creation/contracts/document-language");
            validateDocumentSelection(reference, saved.content);
            target = { artifactId: fileId, baseRevision: saved.revision, sectionId: reference.sectionId, blockIds: reference.blockIds };
          } else if (kind === "sheet") {
            const { validateSheetSelection } = await import("@/lib/creation/sheet-selection");
            validateSheetSelection(reference, saved.content);
            target = { artifactId: fileId, baseRevision: saved.revision, sheetId: reference.sheetId, addresses: reference.addresses };
          } else {
            const sourcePage = saved.content?.pages?.find(page => page.id === reference.pageId);
            if (!sourcePage || reference.nodeId && sourcePage.nodes && !sourcePage.nodes.some(node => node.id === reference.nodeId && !node.locked)) throw new Error("LANGUAGE_SELECTION_CHANGED");
            target = { artifactId: fileId, baseRevision: saved.revision, pageId: reference.pageId, nodeIds: reference.nodeIds || (reference.nodeId ? [reference.nodeId] : []) };
          }
        }
        if (signal.aborted) return;
        const parameters = kind === "web" ? { pageCount: Math.min(20, pages) }
          : kind === "poster" || kind === "slides" ? { width, height, pageCount: kind === "slides" ? pages : 1 }
            : kind === "document" ? { sectionCount, audience: "" }
              : { sheetCount, targetRows };
        const typedRequest = { kind, prompt: prompt.trim(), locale: zh ? "zh" : "en", ...parameters, assetIds: [], referenceIds: [], maxCredits: 0, ...(target ? { target } : {}) };
        const body = { kind: useAgent ? "agent" : kind, prompt: prompt.trim(), locale: zh ? "zh" : "en", ...(useAgent ? (target ? { editRequest: typedRequest } : {}) : parameters),
          assetIds, referenceIds, maxCredits: Number(budget || estimated), ...(!useAgent && target ? { target } : {}) };
        if (withImage && !target) body.image = imageChoice;
        submission = { key: requestKey(), sessionId, body };
        sessionStorage.setItem(journalKey, JSON.stringify(submission));
        pendingRequest.current = submission; setPending(submission);
      }
      const created = await api(`/api/creation/sessions/${submission.sessionId}/messages`, { method: "POST", body: submission.body, key: submission.key, signal, timeoutMs: 30000 });
      if (signal.aborted) return;
      sessionStorage.removeItem(journalKey); pendingRequest.current = null; setPending(null); setPrompt(""); setReference(null); setAssetIds([]); setReferenceIds([]); setBudget("");
      clearTimeout(composerTimer.current); composerDraft.current = null;
      sessionStorage.removeItem(draftKey); finalSeen.current = null; setRunId(created.id);
      latestRequested.current = true; messageEpoch.current++;
      await refreshContent();
    } catch (failure) {
      if (signal.aborted) return;
      if (failure.status && failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status)) {
        sessionStorage.removeItem(journalKey); pendingRequest.current = null; setPending(null);
      }
      notify(failure);
    } finally { gate.current = false; if (!signal.aborted) setBusy(false); }
  }
  async function act(action) {
    if (!run || gate.current) return;
    gate.current = true; setBusy(true);
    try {
      const body = action === "resume" ? { expectedSequence: run.eventSequence, maxCredits: Number(budget || run.maxCredits), retryFailed: run.status === "failed" } : {};
      await api(`/api/creation/runs/${run.id}/${action}`, { method: "POST", body, signal: life.current.signal, timeoutMs: 30000 });
      if (!life.current.signal.aborted) setRevision(value => value + 1);
    } catch (failure) { if (!life.current.signal.aborted) notify(failure); }
    finally { gate.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  async function more() {
    if (!messages.nextCursor || paging.current) return;
    paging.current = true;
    const epoch = messageEpoch.current;
    setMoreBusy(true);
    try {
      const result = await api(`/api/creation/sessions/${sessionId}/messages?before=${messages.nextCursor}`, { signal: life.current.signal });
      if (!life.current.signal.aborted && epoch === messageEpoch.current) {
        conversation.current?.preserveHistory();
        setMessages(current => mergeConversationWindow(current, result, "older"));
      }
    } catch (failure) { if (!life.current.signal.aborted && epoch === messageEpoch.current) notify(failure); }
    finally { paging.current = false; if (!life.current.signal.aborted) setMoreBusy(false); }
  }
  const completedMessageId = run?.status === "succeeded" ? messages.items.findLast(item => item.references?.some(ref => ref.type === "artifact"))?.id : null;
  return <><section ref={workspaceRoot} className="cw-workspace" data-mobile-tab={mobileTab} data-chat-collapsed={chatCollapsed} inert={leaving}>

    <nav className="cw-mobile-tabs" aria-label={text("工作区视图", "Workspace view")}><button aria-pressed={mobileTab === "chat"} onClick={() => setMobileTab("chat")}><MessageSquare size={15} />{text("对话", "Chat")}</button><button aria-pressed={mobileTab === "artwork"} onClick={() => setMobileTab("artwork")}><FileImage size={15} />{text("作品", "Artwork")}</button></nav>
    <WorkspaceSplit userId={userId} zh={zh}>
      <aside className="cw-chat"><header><div className="cw-chat-heading"><strong title={title}>{title}</strong></div><button aria-label={text("刷新项目", "Refresh project")} onClick={() => void refreshContent().catch(notify)}><RefreshCw size={15} /></button><button className="cw-chat-toggle" aria-expanded={!chatCollapsed} aria-label={text("收起创作对话", "Collapse creation chat")} onClick={() => setChatCollapsed(true)}><PanelLeftClose size={16} /></button></header>
        <ConversationViewport key={sessionId || projectId} scrollRef={conversation} changeKey={`${messages.items[0]?.id}:${messages.items.at(-1)?.id}:${messages.items.length}:${run?.id}:${run?.eventSequence}:${stepsOpen}`} visibilityKey={`${mobileTab}:${chatCollapsed}`} hasNewer={messages.hasNewer} onLatest={latestMessages} zh={zh}>
          {loading && <p role="status">{text("正在读取项目…", "Loading project…")}</p>}
          {messages.nextCursor && <button disabled={moreBusy} onClick={more}>{text("更早的对话", "Earlier messages")}</button>}
          {messages.items.length >= 100 && <button onClick={latestMessages}>{text("回到最新对话", "Return to latest messages")}</button>}
          {!loading && !messages.items.length && <div className="cw-chat-welcome"><span>AI</span><h2>{text("从一个想法开始", "Start with an idea")}</h2><p>{text("告诉我创作主题、用途和需要保留的准确文案。", "Describe the topic, purpose and exact copy to include.")}</p></div>}
          {messages.items.map(message => <CreationMessage key={message.id} message={message} completed={message.id === completedMessageId} artifacts={project?.artifacts} projectKind={project?.kind} zh={zh} onWarm={warmCreationEditor} onOpen={(id, kind) => selectFile(id, id === fileId, kind)} onOutline={openOutline} />)}
          {run?.parentRunId && <button onClick={() => { setRunId(run.parentRunId); setRevision(value => value + 1); }}>{text("返回完整创作计划", "Back to workflow")}</button>}
          {run && (run.status !== "succeeded" || stepsOpen) && <div id="creation-task-details"><CreationTaskStatus run={run} expanded={stepsOpen} onToggle={() => setStepsOpen(value => !value)} zh={zh} busy={busy} budget={budget} onBudget={setBudget} onCancel={() => act("cancel")} onResume={() => act("resume")} onChild={id => { setRunId(id); setRevision(value => value + 1); }} onReview={() => openOutline(run.kind === "agent" ? run.steps.find(step => step.status !== "succeeded" && step.result?.childRunId)?.result.childRunId : run.id)} /></div>}
          {run?.status === "succeeded" && <div className="cw-completed-details"><button onClick={() => setStepsOpen(value => !value)}>{text(stepsOpen ? "收起执行记录" : "全部完成 · 查看执行记录", stepsOpen ? "Hide task history" : "Completed · View task history")}</button></div>}
        </ConversationViewport>
        {(error || observed.error) && <div className="cw-error" role="alert">{creationError(error || observed.error, zh)}{!project && <button onClick={() => setRevision(value => value + 1)}>{text("重试", "Retry")}</button>}</div>}
        <RunStatusStrip run={run?.status === "succeeded" ? null : run} error={observed.error} zh={zh} onRefresh={() => setRevision(value => value + 1)} onDetails={() => { setStepsOpen(true); workspaceRoot.current?.querySelector("#creation-task-details")?.scrollIntoView({ block: "nearest" }); }} />
        {editingFile && editingFile === fileId && <div className="cw-editing-notice" role="status"><TriangleAlert size={15} />{text("正在编辑文件，请退出编辑后再提交创作需求", "Finish editing before sending a creation request")}</div>}
        <form className="cw-composer" onSubmit={send}>
          {assetIds.length > 0 && <ReferenceAssets value={assetIds} onChange={setAssetIds} disabled={busy || Boolean(pending) || loading} hidePicker zh={zh} />}
          {reference && <div className="cw-reference-chip"><FileImage size={13} /><span>{reference.label}</span><button type="button" disabled={busy || Boolean(pending)} aria-label={text("取消引用", "Remove reference")} onClick={() => setReference(null)}><X size={13} /></button></div>}
          <AutoGrowTextarea aria-label={text("创作需求", "Creation request")} value={prompt} maxLength={12000} disabled={busy || Boolean(pending)} onChange={event => setPrompt(event.target.value)} placeholder={text(reference ? "描述要修改的内容…" : "说出你的想法，演示文稿、分析报告、海报长图即刻生成，Enter 发送", reference ? "Describe the changes…" : "Describe what you want to create…")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) event.currentTarget.form.requestSubmit(); } }} />
          <div className="cw-composer-actions">
            <button type="button" aria-label={text("添加参考文档", "Add reference documents")} title={text("添加参考文档", "Add reference documents")} aria-expanded={attachmentsOpen} onClick={() => setAttachmentsOpen(value => !value)}><Paperclip size={16} />{referenceIds.length > 0 && <small>{referenceIds.length}</small>}</button>
            <ReferenceAssets value={assetIds} onChange={setAssetIds} disabled={busy || Boolean(pending) || loading} compact zh={zh} />
            {caps?.agent && <button type="button" aria-pressed={agentMode} disabled={busy || Boolean(pending) || Boolean(occupied)} onClick={() => setAgentMode(value => !value)}>{text("多步创作", "Multi-step")}</button>}
            <button type="button" className="cw-composer-disclosure" aria-label={text("创作设置", "Creation settings")} title={text("创作设置", "Creation settings")} aria-expanded={composerOptionsOpen} onClick={() => setComposerOptionsOpen(value => !value)}><SlidersHorizontal size={15} /></button>
            <span className="cw-composer-cost">{caps?.languageUnitCost == null ? "—" : `${estimated} ${text("积分", "credits")}`}</span>
            <button className="cw-send" aria-label={text(pending ? "恢复上次提交" : "开始创作", pending ? "Recover submission" : "Start creation")} disabled={Boolean(editingFile && editingFile === fileId) || busy || loading || !pending && (!enabled || !prompt.trim() || Boolean(occupied))}>{busy ? <LoaderCircle size={18} className="animate-spin" /> : pending ? <RefreshCw size={18} /> : <ArrowUp size={18} />}</button>
          </div>
          {attachmentsOpen && <div className="cw-composer-advanced">
            <ReferenceFiles sessionId={sessionId} value={referenceIds} onChange={setReferenceIds} disabled={busy || Boolean(pending) || loading} zh={zh} onError={notify} />
          </div>}
          {composerOptionsOpen && <div className="cw-composer-advanced">
            {imageChoice && <label className="cw-poster-image-choice" title={text("先生成视觉素材，再排版可编辑文字；最多使用前两张参考图。选择八张素材时使用已有素材排版。", "Generate artwork, then lay out editable text. Uses the first two reference images. Eight selected assets use existing artwork only.")}><input type="checkbox" checked={withImage} disabled={busy || Boolean(pending) || assetIds.length >= 8} onChange={event => setGenerateImage(event.target.checked)} />{text("AI 配图", "AI artwork")} · {imageChoice.expectedCost} {text("积分", "credits")}</label>}
            <div className="cw-composer-options">{!reference && !useAgent && <>{["poster", "slides"].includes(kind) && <select aria-label={text("画板尺寸", "Page dimensions")} disabled={busy || Boolean(pending)} value={ratio} onChange={event => setRatio(event.target.value)}><option value="1080x1440">3:4</option><option value="1080x1080">1:1</option><option value="1920x1080">16:9</option><option value="1080x1920">9:16</option></select>}{["slides", "web"].includes(kind) && <label><input aria-label={text("页数", "Page count")} type="number" min={1} max={kind === "web" ? 20 : 100} value={pages} disabled={busy || Boolean(pending)} onChange={event => setPages(Math.min(kind === "web" ? 20 : 100, Math.max(1, Number(event.target.value) || 1)))} />{text("页", "pages")}</label>}{kind === "document" && <label>{text("章节数", "Sections")}<input aria-label={text("章节数", "Section count")} type="number" min={1} max={50} value={sectionCount} disabled={busy || Boolean(pending)} onChange={event => setSectionCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} /></label>}{kind === "sheet" && <><label>{text("工作表", "Sheets")}<input aria-label={text("工作表数量", "Sheet count")} type="number" min={1} max={5} value={sheetCount} disabled={busy || Boolean(pending)} onChange={event => setSheetCount(Math.min(5, Math.max(1, Number(event.target.value) || 1)))} /></label><label>{text("目标行数", "Target rows")}<input aria-label={text("目标行数", "Target rows")} type="number" min={1} max={500} value={targetRows} disabled={busy || Boolean(pending)} onChange={event => setTargetRows(Math.min(500, Math.max(1, Number(event.target.value) || 1)))} /></label></>}</>}</div>
          </div>}
          <small>{pending ? text("上次提交尚未确认，点击恢复即可核对同一任务。", "The last submission is unconfirmed. Recover it to check the same task.") : reference ? text("提交前会先保存当前修改。", "Current edits are saved before sending.") : !enabled && !loading ? text("此类型暂未开放新创作，已有作品仍可打开。", "New creation is unavailable. Existing artwork remains accessible.") : text("Enter 发送 · Shift+Enter 换行", "Enter to send · Shift+Enter for a new line")}</small>
        </form>
      </aside>
      <div className="cw-work-area"><div className="cw-file-tools">{chatCollapsed && <button aria-label={text("展开创作对话", "Expand creation chat")} onClick={() => setChatCollapsed(false)}><MessageSquare size={15} /></button>}<button aria-expanded={treeOpen} aria-label={text(treeOpen ? "收起文件列表" : "展开文件列表", treeOpen ? "Collapse files" : "Expand files")} onClick={() => setTreeOpen(!treeOpen)}>{treeOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button></div><div className="cw-file-body">
        {treeOpen && project && <ProjectFiles key={projectId} resources={resources} project={project} onWarm={warmCreationEditor} fileId={fileId} onSelect={selectFile} onImported={refreshContent} zh={zh} />}
        <main className="cw-artwork-area">{updatedFile && (updatedFile !== fileId || !["slides", "poster"].includes(fileKind)) && <div className="cw-error" role="status"><span>{text("生成结果已保存", "The result has been saved")}</span><button onClick={() => selectFile(updatedFile, updatedFile === fileId)}>{text("打开最新作品", "Open latest artwork")}</button><button aria-label={text("关闭提示", "Dismiss")} onClick={() => setUpdatedFile(null)}><X size={13} /></button></div>}
          {outlineRunId && <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开大纲…", "Opening outline…")}</div>}><OutlineReview editorRef={outlineEditor} key={outlineRunId} userId={userId} runId={outlineRunId} zh={zh} onConfirmed={outlineConfirmed} onClose={closeOutline} /></Suspense>}
          <div className="cw-artwork-content" style={{ display: outlineRunId ? "none" : "flex" }}>{fileId ? fileKind ? <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开作品…", "Opening artwork…")}</div>}><ArtifactEditor kind={fileKind} key={`${fileId}:${editorEpoch}`} artifactId={fileId} userId={userId} zh={zh} editorRef={editor} remoteRevision={publishedRevisions[fileId]} onResources={setResources} onEditingChange={observeEditing} onError={notify} onReference={value => { if (!busy && !pending) { setReference({ ...value, artifactId: fileId }); setChatCollapsed(false); setMobileTab("chat"); } }} onArtifactCreated={() => void refreshContent().catch(notify)} onOpenArtifact={selectFile} /></Suspense> : <div className="cw-loading" role="status">{text("正在读取作品格式…", "Reading artwork format…")}</div> : <div className="cw-empty-artwork"><FileImage size={40} strokeWidth={1} /><h2>{text("你的作品会在这里呈现", "Your artwork will appear here")}</h2><p>{text("在左侧描述需求，生成后即可预览和编辑。", "Describe your idea in the conversation, then preview and edit the result here.")}</p></div>}</div>
        </main>
      </div></div>
    </WorkspaceSplit>
  </section>{leaving && <div className="cw-leaving" role="status"><LoaderCircle size={18} className="animate-spin" />{text("正在保存当前作品与草稿，完成后离开…", "Saving artwork and drafts before leaving…")}</div>}</>;
}
