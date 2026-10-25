"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, RefreshCw, SlidersHorizontal, ChevronDown } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import { invalidateProjectLists } from "@/lib/studio/project-list";
import { creationError } from "@/components/creation/creation-errors";
import ReferenceAssets, { referenceAssetIds } from "@/components/creation/ReferenceAssets";
import { posterImageChoice } from "@/lib/creation/poster-image-choice";
import "./creation-launcher.css";

// Ship this small form with the homepage so switching types needs no download.
// AssetLibrary stays lazy; editors, canvases and schemas are not imported here.
export default function CreationLauncher({ kind, userId, zh, initialDraft, onDraft, attachmentIds = [], visible = true, initialCaps = null }) {
  const router = useNavigationRouter(), life = useRef(null), gate = useRef(false), pending = useRef(null), draftCallback = useRef(onDraft), isVisible = useRef(visible);
  const [prompt, setPrompt] = useState(initialDraft?.prompt || ""), [size, setSize] = useState(initialDraft?.size || (kind === "slides" ? "1920x1080" : "1080x1440"));
  const [pages, setPages] = useState(initialDraft?.pages || (kind === "web" ? 1 : 10)), [sectionCount, setSectionCount] = useState(initialDraft?.sectionCount || 6);
  const [sheetCount, setSheetCount] = useState(initialDraft?.sheetCount || 1), [targetRows, setTargetRows] = useState(initialDraft?.targetRows || 20);
  const [caps, setCaps] = useState(initialCaps), [busy, setBusy] = useState(false), [error, setError] = useState(null), [uncertain, setUncertain] = useState(false), [attempt, setAttempt] = useState(0);
  const [assetIds, setAssetIds] = useState(() => referenceAssetIds(initialDraft?.assetIds ?? attachmentIds));
  const [projectReady, setProjectReady] = useState(false);
  const [generateImage, setGenerateImage] = useState(initialDraft?.generateImage ?? true);
  const [pendingQuote, setPendingQuote] = useState(null);
  const key = `creation-launch:${userId}:${kind}`, text = (cn, en) => zh ? cn : en;
  useEffect(() => { draftCallback.current = onDraft; }, [onDraft]);
  useEffect(() => { isVisible.current = visible; }, [visible]);
  useEffect(() => { draftCallback.current?.({ prompt, size, pages, sectionCount, sheetCount, targetRows, assetIds, generateImage }); }, [prompt, size, pages, sectionCount, sheetCount, targetRows, assetIds, generateImage]);
  useEffect(() => {
    const abort = new AbortController(); life.current = abort;
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!userId || !visible) return;
    const abort = new AbortController();
    async function load() {
      try {
        if (!initialCaps || attempt > 0) {
          const value = await api("/api/creation/capabilities", { signal: abort.signal });
          if (!abort.signal.aborted) setCaps(value);
        }
        const raw = sessionStorage.getItem(key);
        if (raw && !abort.signal.aborted) {
          const saved = JSON.parse(raw);
          if (saved.userId === userId && saved.body?.kind === kind && saved.createKey && saved.runKey) {
            pending.current = saved; setPendingQuote({ maxCredits: saved.body.maxCredits, image: saved.body.image || null }); setUncertain(true); setProjectReady(Boolean(saved.project)); setPrompt(saved.body.prompt); setAssetIds(referenceAssetIds(saved.body.assetIds)); setGenerateImage(Boolean(saved.body.image));
            if (saved.body.width && saved.body.height) setSize(`${saved.body.width}x${saved.body.height}`);
            if (Number.isInteger(saved.body.pageCount)) setPages(saved.body.pageCount);
            if (Number.isInteger(saved.body.sectionCount)) setSectionCount(saved.body.sectionCount);
            if (Number.isInteger(saved.body.sheetCount)) setSheetCount(saved.body.sheetCount);
            if (Number.isInteger(saved.body.targetRows)) setTargetRows(saved.body.targetRows);
          }
        }
      } catch (failure) { if (!abort.signal.aborted) setError(failure); }
    }
    void load();
    return () => abort.abort();
  }, [userId, key, kind, visible, attempt, initialCaps]);
  const imageChoice = uncertain ? pendingQuote?.image : kind === "poster" ? posterImageChoice(caps, size) : null;
  const withImage = Boolean(imageChoice && generateImage && assetIds.length < 8);
  const cost = uncertain ? pendingQuote?.maxCredits : caps?.languageUnitCost == null ? null : caps.languageUnitCost * (kind === "slides" ? pages + 1 : kind === "document" ? sectionCount + 1 : 1) + (withImage ? imageChoice.expectedCost : 0);
  async function start(event) {
    event.preventDefault();
    if (gate.current || !userId || !pending.current && (!caps?.[kind] || cost == null || !prompt.trim())) return;
    gate.current = true; setBusy(true); setError(null);
    const signal = life.current.signal;
    try {
      let request = pending.current;
      if (!request) {
        const body = { kind, prompt: prompt.trim(), locale: zh ? "zh" : "en", maxCredits: cost, assetIds };
        if (withImage) body.image = imageChoice;
        if (kind === "poster" || kind === "slides") {
          const [width, height] = size.split("x").map(Number);
          Object.assign(body, { width, height, pageCount: kind === "slides" ? pages : 1 });
        } else if (kind === "web") body.pageCount = pages;
        else if (kind === "document") Object.assign(body, { sectionCount, audience: "" });
        else if (kind === "sheet") Object.assign(body, { sheetCount, targetRows });
        request = { userId, createKey: requestKey(), runKey: requestKey(), body };
        sessionStorage.setItem(key, JSON.stringify(request)); pending.current = request; setPendingQuote({ maxCredits: body.maxCredits, image: body.image || null }); setUncertain(true);
      }
      if (!request.project) {
        const project = await api("/api/creation/projects", { method: "POST", body: { createKey: request.createKey, name: request.body.prompt.slice(0, 100), kind }, signal, timeoutMs: 30000 });
        if (signal.aborted) return;
        request = { ...request, project: { id: project.id, sessionId: project.sessions[0]?.id } };
        if (!request.project.sessionId) throw new Error("CREATION_SESSION_NOT_FOUND");
        pending.current = request; setProjectReady(true);
        sessionStorage.setItem(key, JSON.stringify(request)); invalidateProjectLists(userId);
      }
      await api(`/api/creation/sessions/${request.project.sessionId}/messages`, { method: "POST", key: request.runKey, body: request.body, signal, timeoutMs: 30000 });
      if (signal.aborted) return;
      invalidateProjectLists(userId);
      // Retained home pages may be hidden while this request completes. Keep
      // its replay journal instead of navigating away from the user's new page.
      if (!isVisible.current) return;
      sessionStorage.removeItem(key); pending.current = null; setUncertain(false);
      router.push(`/creation?project=${request.project.id}&session=${request.project.sessionId}`);
    } catch (failure) {
      if (signal.aborted) return;
      if (!pending.current?.project && failure.status && failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status)) {
        sessionStorage.removeItem(key); pending.current = null; setUncertain(false);
      }
      // Keep the project identity even on a definite run rejection, so changing
      // a price/brief does not manufacture another empty project on retry.
      setError(failure);
    } finally { gate.current = false; if (!signal.aborted) setBusy(false); }
  }
  function openDraft() {
    const request = pending.current;
    if (!request?.project) return;
    // Copy the exact unconfirmed body to the workspace's recovery journal.
    // The user can recover the same request there; it is never auto-submitted.
    try {
      sessionStorage.setItem(`creation-submit:${userId}:${request.project.id}:${request.project.sessionId}`, JSON.stringify({ key: request.runKey, sessionId: request.project.sessionId, body: request.body }));
      sessionStorage.removeItem(key);
      router.push(`/creation?project=${request.project.id}&session=${request.project.sessionId}`);
    } catch (failure) { setError(failure); }
  }
  const placeholders = {
    poster: ["描述海报用途、风格和需要保留的准确文案…", "Describe the purpose, style and exact poster copy…"],
    slides: ["描述演示主题、受众、内容和语言要求…", "Describe the presentation topic, audience, content and language…"],
    document: ["描述文档主题、读者、结构和需要覆盖的要点…", "Describe the document topic, audience, structure and key points…"],
    sheet: ["描述表格用途、字段、数据关系和需要的计算…", "Describe the workbook purpose, fields, data relationships and calculations…"],
    web: ["描述网站目标、受众、页面和视觉方向…", "Describe the website goal, audience, pages and visual direction…"],
  }[kind];
  return <form className="cr-creation-launcher" onSubmit={start}>
    <textarea aria-label={text("创作需求", "Creation request")} value={prompt} disabled={busy || uncertain} maxLength={12000} onChange={event => setPrompt(event.target.value)} placeholder={text(...placeholders)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) event.currentTarget.form.requestSubmit(); } }} />
    <ReferenceAssets value={assetIds} onChange={setAssetIds} disabled={busy || uncertain} zh={zh} />
    <div className="cr-creation-options">
      <details className="cr-creation-settings">
        <summary><SlidersHorizontal size={15} /><span>{text("参数", "Settings")}</span><ChevronDown size={12} /></summary>
        <div className="cr-creation-settings-panel">
          {["poster", "slides"].includes(kind) && <label>{text("尺寸", "Size")}<select value={size} disabled={busy || uncertain} onChange={event => setSize(event.target.value)}>{["1080x1440", "1080x1080", "1920x1080", "1080x1920"].map((value, index) => <option value={value} key={value}>{["3:4", "1:1", "16:9", "9:16"][index]}</option>)}</select></label>}{["slides", "web"].includes(kind) && <label>{text(kind === "web" ? "页面数" : "页数", kind === "web" ? "Pages" : "Slides")}<input type="number" min={1} max={kind === "web" ? 20 : 100} value={pages} disabled={busy || uncertain} onChange={event => setPages(Math.min(kind === "web" ? 20 : 100, Math.max(1, Number(event.target.value) || 1)))} /></label>}{kind === "document" && <label>{text("章节数", "Sections")}<input type="number" min={1} max={50} value={sectionCount} disabled={busy || uncertain} onChange={event => setSectionCount(Math.min(50, Math.max(1, Number(event.target.value) || 1)))} /></label>}{kind === "sheet" && <><label>{text("工作表", "Sheets")}<input type="number" min={1} max={5} value={sheetCount} disabled={busy || uncertain} onChange={event => setSheetCount(Math.min(5, Math.max(1, Number(event.target.value) || 1)))} /></label><label>{text("目标行数", "Target rows")}<input type="number" min={1} max={100} value={targetRows} disabled={busy || uncertain} onChange={event => setTargetRows(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} /></label></>}
          {imageChoice && <label className="cr-poster-image-choice" title={text("先生成视觉素材，再排版可编辑文字；最多使用前两张参考图。选择八张素材时使用已有素材排版。", "Generate artwork, then lay out editable text. Uses the first two reference images. Eight selected assets use existing artwork only.")}><input type="checkbox" checked={withImage} disabled={busy || uncertain || assetIds.length >= 8} onChange={event => setGenerateImage(event.target.checked)} />{text("AI 配图", "AI artwork")} · {imageChoice.expectedCost} {text("积分", "credits")}</label>}
        </div>
      </details>
      <span className="cr-creation-cost" aria-live="polite">{cost ?? "—"} {text("积分", "credits")}</span><button className="cr-send" disabled={busy || !uncertain && (!caps?.[kind] || !prompt.trim() || cost == null)} aria-label={text(uncertain ? "恢复提交" : "开始创作", uncertain ? "Recover submission" : "Start creating")}>{busy ? <LoaderCircle size={18} className="ca-spin" /> : uncertain ? <RefreshCw size={18} /> : <ArrowUp size={18} />}</button></div>
    {uncertain && <p className="cr-creation-note">{text("提交尚未确认，重试会核对同一项目和任务。", "Submission is unconfirmed. Retry checks the same project and task.")}</p>}
    {error && <div role="alert" className="cr-creation-error">{creationError(error, zh)}{projectReady ? <button type="button" onClick={openDraft}>{text("打开项目处理", "Open project")}</button> : <button type="button" onClick={() => setAttempt(value => value + 1)}>{text("刷新可用能力", "Refresh availability")}</button>}</div>}
  </form>;
}
