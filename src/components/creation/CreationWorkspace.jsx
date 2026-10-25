"use client";

import { sheetGenerationCalls } from "@/lib/creation/sheet-generation-policy";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, Check, ChevronDown, ChevronRight, FileImage, LoaderCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Square, X } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import ReferenceAssets, { referenceAssetIds, MessageReferenceAssets } from "./ReferenceAssets";
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

const OutlineReview = lazy(() => import("./OutlineReview"));
const ArtifactEditor = lazy(() => import("./CreationArtifactEditor"));
const compactQuery = "(max-width:760px)";
const compactSnapshot = () => Boolean(window.matchMedia?.(compactQuery).matches);
const wideServerSnapshot = () => false;
function subscribeCompact(onChange) {
  const media = window.matchMedia?.(compactQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
const active = status => ["queued", "running", "cancelling"].includes(status);
const statusLabels = { queued: ["等待开始", "Queued"], running: ["正在创作", "Creating"], succeeded: ["已完成", "Completed"], failed: ["执行未完成", "Failed"], cancelling: ["正在停止后续步骤", "Stopping subsequent steps"], cancelled: ["已取消", "Cancelled"], awaiting_budget: ["等待调整预算", "Budget required"], awaiting_input: ["需要处理后继续", "Needs attention"] };

export default function CreationWorkspace({ userId, projectId, initialSessionId, initialFileId, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const [project, setProject] = useState(null), [sessionId, setSessionId] = useState(null), [messages, setMessages] = useState({ items: [], nextCursor: null });
  const [caps, setCaps] = useState(null), [runId, setRunId] = useState(null), [fileId, setFileId] = useState(null), [loadedFormat, setLoadedFormat] = useState(null), [editorEpoch, setEditorEpoch] = useState(0);
  const [prompt, setPrompt] = useState(""), [reference, setReference] = useState(null), [pages, setPages] = useState(10), [ratio, setRatio] = useState("1080x1440");
  const [sectionCount, setSectionCount] = useState(6), [sheetCount, setSheetCount] = useState(1), [targetRows, setTargetRows] = useState(20);
  const [budget, setBudget] = useState(""), [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(null), [loading, setLoading] = useState(true);
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, wideServerSnapshot);
  const [treePreference, setTreeOpen] = useState(null), [mobileTab, setMobileTab] = useState("chat"), [stepsOpen, setStepsOpen] = useState(true), [updatedFile, setUpdatedFile] = useState(null);
  const treeOpen = treePreference ?? (!compact && (project?.artifacts?.length > 1 || Boolean(project?.artifactsNextCursor)));
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const [assetIds, setAssetIds] = useState([]);
  const [referenceIds, setReferenceIds] = useState([]);
  const [generateImage, setGenerateImage] = useState(true);
  const [outlineRunId, setOutlineRunId] = useState(null);
  const [filesEpoch, setFilesEpoch] = useState(0);
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
        const [value, capability] = await Promise.all([api(`/api/creation/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal }), api("/api/creation/capabilities", { signal: controller.signal }).catch(failure => {
          if (!controller.signal.aborted) setError(failure);
          return null;
        })]);
        const chosen = initialSessionId || value.sessions[0]?.id;
        if (!chosen || !value.sessions.some(item => item.id === chosen)) throw new Error("CREATION_SESSION_NOT_FOUND");
        const [history, runs] = await Promise.all([api(`/api/creation/sessions/${chosen}/messages`, { signal: controller.signal }), api(`/api/creation/runs?sessionId=${chosen}`, { signal: controller.signal })]);
        if (controller.signal.aborted) return;
        session.current = chosen; setSessionId(chosen); setProject(value); setFilesEpoch(epoch => epoch + 1); setCaps(capability); setMessages(history);
        const firstFileId = initialFileId || value.artifacts[0]?.id || null;
        setFileId(current => current || firstFileId);
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
    const latest = latestRequested.current; latestRequested.current = false;
    if (latest) conversation.current?.followLatest();
    setProject(value); setMessages(current => mergeConversationWindow(current, history, latest ? "latest" : "refresh")); setFilesEpoch(value => value + 1);
  }, [projectId]);
  function latestMessages() {
    latestRequested.current = true; messageEpoch.current++;
    void refreshContent().catch(notify);
  }
  const onRunChange = useCallback(run => {
    if (active(run.status)) return;
    const key = `${run.id}:${run.eventSequence}`;
    if (finalSeen.current === key) return;
    finalSeen.current = key;
    if (run.errorCode === "CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED") setBudget(String(run.committedCredits + run.steps.filter(step => step.status !== "succeeded").reduce((sum, step) => sum + step.expectedCost, 0)));
    invalidateProjectLists(userId);
    if (run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED") setOutlineRunId(run.kind === "agent" ? run.steps.find(step => step.status !== "succeeded" && step.result?.childRunId)?.result.childRunId : run.id);
    const result = run.steps.toReversed().find(step => step.result?.artifactId)?.result;
    if (result) { setFileId(current => current || result.artifactId); setUpdatedFile(result.artifactId); }
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
  const kindLabel = ({ poster: ["海报设计", "Poster design"], slides: ["演示文稿", "Presentation"], document: ["文档创作", "Document"], sheet: ["表格创作", "Spreadsheet"], web: ["网页创作", "Website"] })[kind] || ["AI 创作", "AI Creation"];

  async function selectFile(id, reload = false, selectedKind = null) {
    if (gate.current) return;
    gate.current = true;
    try {
      if (outlineRunId && outlineEditor.current) await outlineEditor.current.flush();
      if (fileId && editor.current) await editor.current.flush();
      if (life.current?.signal.aborted) return;
      setFileId(id); setLoadedFormat({ id, kind: selectedKind || project?.artifacts?.find(item => item.id === id)?.kind || null }); setOutlineRunId(null); setReference(null); setMobileTab("artwork");
      if (reload) { setEditorEpoch(value => value + 1); setUpdatedFile(null); }
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
    if (gate.current || !sessionId || (!pendingRequest.current && (!prompt.trim() || !enabled || occupied))) return;
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
  return <><section ref={workspaceRoot} className="cw-workspace" data-mobile-tab={mobileTab} data-chat-collapsed={chatCollapsed} inert={leaving}>
    <header className="cw-workspace-title"><div><span>AI</span><strong>{title}</strong></div><span>{text(...kindLabel)}</span><button className="cw-chat-toggle" aria-expanded={!chatCollapsed} aria-label={text(chatCollapsed ? "展开创作对话" : "收起创作对话", chatCollapsed ? "Expand creation chat" : "Collapse creation chat")} title={text(chatCollapsed ? "展开创作对话" : "收起创作对话", chatCollapsed ? "Expand creation chat" : "Collapse creation chat")} onClick={() => setChatCollapsed(value => !value)}>{chatCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button aria-label={text("刷新项目", "Refresh project")} onClick={() => void refreshContent().catch(notify)}><RefreshCw size={15} /></button></header>
    <nav className="cw-mobile-tabs" aria-label={text("工作区视图", "Workspace view")}><button aria-pressed={mobileTab === "chat"} onClick={() => setMobileTab("chat")}><MessageSquare size={15} />{text("对话", "Chat")}</button><button aria-pressed={mobileTab === "artwork"} onClick={() => setMobileTab("artwork")}><FileImage size={15} />{text("作品", "Artwork")}</button></nav>
    <WorkspaceSplit userId={userId} zh={zh}>
      <aside className="cw-chat"><header><MessageSquare size={16} /><strong>{text("创作对话", "Creation chat")}</strong></header>
        <ConversationViewport key={sessionId || projectId} scrollRef={conversation} changeKey={`${messages.items[0]?.id}:${messages.items.at(-1)?.id}:${messages.items.length}:${run?.id}:${run?.eventSequence}:${stepsOpen}`} visibilityKey={`${mobileTab}:${chatCollapsed}`} hasNewer={messages.hasNewer} onLatest={latestMessages} zh={zh}>
          {loading && <p role="status">{text("正在读取项目…", "Loading project…")}</p>}
          {messages.nextCursor && <button disabled={moreBusy} onClick={more}>{text("更早的对话", "Earlier messages")}</button>}
          {messages.items.length >= 100 && <button onClick={latestMessages}>{text("回到最新对话", "Return to latest messages")}</button>}
          {!loading && !messages.items.length && <div className="cw-chat-welcome"><span>AI</span><h2>{text("从一个想法开始", "Start with an idea")}</h2><p>{text("告诉我创作主题、用途和需要保留的准确文案。", "Describe the topic, purpose and exact copy to include.")}</p></div>}
          {messages.items.map(message => <article key={message.id} data-message-id={message.id} className={`cw-message is-${message.role}`}><small>{message.role === "user" ? text("你", "You") : text("创作助手", "Creation assistant")}</small><p>{message.text}</p><MessageReferenceAssets references={message.references} zh={zh} />{(Array.isArray(message.references) ? message.references : []).filter(item => item.type === "export").map(item => <a key={item.exportId} href={`/api/creation/exports/${encodeURIComponent(item.exportId)}/download`}>{text("下载", "Download")} {item.format.toUpperCase()}</a>)}{(Array.isArray(message.references) ? message.references : []).filter(item => item.type === "outline").map(item => <button key={item.runId} onClick={() => openOutline(item.runId)}>{text("查看大纲", "Review outline")}</button>)}{(Array.isArray(message.references) ? message.references : []).filter(item => item.type === "artifact").map(item => <button key={item.artifactId} onClick={() => selectFile(item.artifactId, item.artifactId === fileId)}><FileImage size={15} />{text("打开作品", "Open artwork")} · V{item.revision}</button>)}</article>)}
          {run?.parentRunId && <button onClick={() => { setRunId(run.parentRunId); setRevision(value => value + 1); }}>{text("返回完整创作计划", "Back to workflow")}</button>}
          {run && <section className="cw-task"><button className="cw-task-heading" aria-expanded={stepsOpen} onClick={() => setStepsOpen(value => !value)}>{active(run.status) ? <LoaderCircle size={15} className="animate-spin" /> : run.status === "succeeded" ? <Check size={15} /> : <Square size={14} />}<strong>{statusLabels[run.status]?.[zh ? 0 : 1]}</strong>{stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{stepsOpen && <ol>{run.steps.map(step => <li key={step.id} data-state={step.status}><span>{step.status === "succeeded" ? <Check size={13} /> : step.position + 1}</span><div>{step.explanation}{step.result?.childRunId && <button onClick={() => { setRunId(step.result.childRunId); setRevision(value => value + 1); }}>{text("查看子任务", "View task")}</button>}<small>{step.status === "blocked" ? text("等待前序步骤", "Waiting for prior steps") : statusLabels[step.status]?.[zh ? 0 : 1] || text("等待处理", "Pending")}</small></div></li>)}</ol>}{run.errorCode && <p>{creationError({ code: run.errorCode }, zh)}</p>}{active(run.status) ? <button disabled={busy || run.status === "cancelling"} onClick={() => act("cancel")}><Square size={13} />{text("停止后续步骤", "Stop subsequent steps")}</button> : ["failed", "awaiting_budget", "awaiting_input"].includes(run.status) && <div className="cw-run-actions"><label>{text("任务总预算", "Total task budget")}<input type="number" min={run.committedCredits} max={200000} value={budget || run.maxCredits} onChange={event => setBudget(event.target.value)} /></label><button disabled={busy} onClick={() => run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED" ? openOutline(run.kind === "agent" ? run.steps.find(step => step.status !== "succeeded" && step.result?.childRunId)?.result.childRunId : run.id) : act("resume")}>{text(run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED" ? "检查并确认大纲" : run.errorCode === "CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED" ? "确认计划并执行" : run.status === "failed" ? "重试失败步骤" : "继续任务", run.errorCode === "CREATION_OUTLINE_CONFIRMATION_REQUIRED" ? "Review outline" : run.errorCode === "CREATION_AGENT_PLAN_CONFIRMATION_REQUIRED" ? "Confirm plan and execute" : run.status === "failed" ? "Retry failed step" : "Continue task")}</button><button disabled={busy} onClick={() => act("cancel")}>{text("取消任务", "Cancel task")}</button></div>}</section>}
        </ConversationViewport>
        {(error || observed.error) && <div className="cw-error" role="alert">{creationError(error || observed.error, zh)}{!project && <button onClick={() => setRevision(value => value + 1)}>{text("重试", "Retry")}</button>}</div>}
        <form className="cw-composer" onSubmit={send}>
          {reference && <div className="cw-reference-chip"><FileImage size={13} /><span>{reference.label}</span><button type="button" disabled={busy || Boolean(pending)} aria-label={text("取消引用", "Remove reference")} onClick={() => setReference(null)}><X size={13} /></button></div>}
          <AutoGrowTextarea aria-label={text("创作需求", "Creation request")} value={prompt} maxLength={12000} disabled={busy || Boolean(pending)} onChange={event => setPrompt(event.target.value)} placeholder={text(reference ? "描述要修改的内容…" : "描述你想创作的内容…", reference ? "Describe the changes…" : "Describe what you want to create…")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) event.currentTarget.form.requestSubmit(); } }} />
          <div className="cw-composer-actions">
            {caps?.agent && <button type="button" aria-pressed={agentMode} disabled={busy || Boolean(pending) || Boolean(occupied)} onClick={() => setAgentMode(value => !value)}>{text("多步创作", "Multi-step")}</button>}
            <button type="button" className="cw-composer-disclosure" aria-expanded={composerOptionsOpen} onClick={() => setComposerOptionsOpen(value => !value)}><ChevronDown size={14} />{text("素材与参数", "Materials and options")}{(assetIds.length || referenceIds.length) > 0 && <span>{assetIds.length + referenceIds.length}</span>}</button>
            <span className="cw-composer-cost">{caps?.languageUnitCost == null ? "—" : `${estimated} ${text("积分", "credits")}`}</span>
            <button className="cw-send" aria-label={text(pending ? "恢复上次提交" : "开始创作", pending ? "Recover submission" : "Start creation")} disabled={busy || loading || !pending && (!enabled || !prompt.trim() || Boolean(occupied))}>{busy ? <LoaderCircle size={18} className="animate-spin" /> : pending ? <RefreshCw size={18} /> : <ArrowUp size={18} />}</button>
          </div>
          {composerOptionsOpen && <div className="cw-composer-advanced">
            <ReferenceAssets value={assetIds} onChange={setAssetIds} disabled={busy || Boolean(pending) || loading} zh={zh} />
            <ReferenceFiles sessionId={sessionId} value={referenceIds} onChange={setReferenceIds} disabled={busy || Boolean(pending) || loading} zh={zh} onError={notify} />
            {imageChoice && <label className="cw-poster-image-choice" title={text("先生成视觉素材，再排版可编辑文字；最多使用前两张参考图。选择八张素材时使用已有素材排版。", "Generate artwork, then lay out editable text. Uses the first two reference images. Eight selected assets use existing artwork only.")}><input type="checkbox" checked={withImage} disabled={busy || Boolean(pending) || assetIds.length >= 8} onChange={event => setGenerateImage(event.target.checked)} />{text("AI 配图", "AI artwork")} · {imageChoice.expectedCost} {text("积分", "credits")}</label>}
            <div className="cw-composer-options">{!reference && !useAgent && <>{["poster", "slides"].includes(kind) && <select aria-label={text("画板尺寸", "Page dimensions")} disabled={busy || Boolean(pending)} value={ratio} onChange={event => setRatio(event.target.value)}><option value="1080x1440">3:4</option><option value="1080x1080">1:1</option><option value="1920x1080">16:9</option><option value="1080x1920">9:16</option></select>}{["slides", "web"].includes(kind) && <label><input aria-label={text("页数", "Page count")} type="number" min={1} max={kind === "web" ? 20 : 100} value={pages} disabled={busy || Boolean(pending)} onChange={event => setPages(Math.min(kind === "web" ? 20 : 100, Math.max(1, Number(event.target.value) || 1)))} />{text("页", "pages")}</label>}{kind === "document" && <label>{text("章节数", "Sections")}<input aria-label={text("章节数", "Section count")} type="number" min={1} max={50} value={sectionCount} disabled={busy || Boolean(pending)} onChange={event => setSectionCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} /></label>}{kind === "sheet" && <><label>{text("工作表", "Sheets")}<input aria-label={text("工作表数量", "Sheet count")} type="number" min={1} max={5} value={sheetCount} disabled={busy || Boolean(pending)} onChange={event => setSheetCount(Math.min(5, Math.max(1, Number(event.target.value) || 1)))} /></label><label>{text("目标行数", "Target rows")}<input aria-label={text("目标行数", "Target rows")} type="number" min={1} max={500} value={targetRows} disabled={busy || Boolean(pending)} onChange={event => setTargetRows(Math.min(500, Math.max(1, Number(event.target.value) || 1)))} /></label></>}</>}</div>
          </div>}
          <small>{pending ? text("上次提交尚未确认，点击恢复即可核对同一任务。", "The last submission is unconfirmed. Recover it to check the same task.") : reference ? text("提交前会先保存当前修改。", "Current edits are saved before sending.") : !enabled && !loading ? text("此类型暂未开放新创作，已有作品仍可打开。", "New creation is unavailable. Existing artwork remains accessible.") : text("Enter 发送 · Shift+Enter 换行", "Enter to send · Shift+Enter for a new line")}</small>
        </form>
      </aside>
      <div className="cw-work-area"><div className="cw-file-tools"><button aria-expanded={treeOpen} aria-label={text(treeOpen ? "收起文件列表" : "展开文件列表", treeOpen ? "Collapse files" : "Expand files")} onClick={() => setTreeOpen(!treeOpen)}>{treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button><span>{text("项目文件", "Project files")}</span></div><div className="cw-file-body">
        {treeOpen && project && <ProjectFiles key={`${projectId}:${filesEpoch}`} project={project} fileId={fileId} onSelect={selectFile} onImported={refreshContent} zh={zh} />}
        <main className="cw-artwork-area">{updatedFile && <div className="cw-error" role="status"><span>{text("生成结果已保存", "The result has been saved")}</span><button onClick={() => selectFile(updatedFile, updatedFile === fileId)}>{text("打开最新作品", "Open latest artwork")}</button><button aria-label={text("关闭提示", "Dismiss")} onClick={() => setUpdatedFile(null)}><X size={13} /></button></div>}
          {outlineRunId && <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开大纲…", "Opening outline…")}</div>}><OutlineReview editorRef={outlineEditor} key={outlineRunId} userId={userId} runId={outlineRunId} zh={zh} onConfirmed={outlineConfirmed} onClose={closeOutline} /></Suspense>}
          <div className="cw-artwork-content" style={{ display: outlineRunId ? "none" : "flex" }}>{fileId ? fileKind ? <Suspense fallback={<div className="cw-loading" role="status">{text("正在打开作品…", "Opening artwork…")}</div>}><ArtifactEditor kind={fileKind} key={`${fileId}:${editorEpoch}`} artifactId={fileId} userId={userId} zh={zh} editorRef={editor} onError={notify} onReference={value => { if (!busy && !pending) { setReference({ ...value, artifactId: fileId }); setChatCollapsed(false); setMobileTab("chat"); } }} onArtifactCreated={() => void refreshContent().catch(notify)} onOpenArtifact={selectFile} /></Suspense> : <div className="cw-loading" role="status">{text("正在读取作品格式…", "Reading artwork format…")}</div> : <div className="cw-empty-artwork"><FileImage size={40} strokeWidth={1} /><h2>{text("你的作品会在这里呈现", "Your artwork will appear here")}</h2><p>{text("在左侧描述需求，生成后即可预览和编辑。", "Describe your idea in the conversation, then preview and edit the result here.")}</p></div>}</div>
        </main>
      </div></div>
    </WorkspaceSplit>
  </section>{leaving && <div className="cw-leaving" role="status"><LoaderCircle size={18} className="animate-spin" />{text("正在保存当前作品与草稿，完成后离开…", "Saving artwork and drafts before leaving…")}</div>}</>;
}
