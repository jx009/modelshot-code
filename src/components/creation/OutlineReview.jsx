"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { readArtifactDraft, writeArtifactDraft } from "@/lib/creation/client/drafts";
import { creationError } from "./creation-errors";
import DraftSessionGate from "./DraftSessionGate";
import GenerationModelSelect from "./GenerationModelSelect";

const visualsFor = outline => (outline?.design?.visuals || []).filter(visual => outline.pages?.some(page => page.visualId === visual.id));

export default function OutlineReview(props) {
  return <DraftSessionGate key={`${props.userId}:${props.runId}`} userId={props.userId} artifactId={`outline:${props.runId}`} editorRef={props.editorRef} zh={props.zh}>{(draftSessionId, onDrafts) => <OutlineReviewSession {...props} draftSessionId={draftSessionId} onDrafts={onDrafts} />}</DraftSessionGate>;
}
function OutlineReviewSession({ userId, runId, zh, onConfirmed, onClose, draftSessionId, onDrafts, editorRef }) {
  const [value, setValue] = useState(null), [quote, setQuote] = useState(null), [selected, setSelected] = useState(0);
  const [budget, setBudget] = useState(""), [pending, setPending] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  const [showApproved, setShowApproved] = useState(false);
  const [generateVisuals, setGenerateVisuals] = useState(false);
  const [imageProvider, setImageProvider] = useState("");
  const life = useRef(null), gate = useRef(false), draft = useRef(null), timer = useRef(null), submission = useRef(null);
  const draftId = `outline:${runId}`, text = (cn, en) => zh ? cn : en;
  const isDocument = quote?.kind === "document", itemsKey = isDocument ? "sections" : "pages";
  const title = isDocument ? text("文档大纲", "Document outline") : text("演示文稿大纲", "Presentation outline");
  useImperativeHandle(editorRef, () => ({ flush: async () => {
    if (gate.current) throw new Error("CREATION_ACTION_PENDING");
    clearTimeout(timer.current);
    if (draft.current) await writeArtifactDraft(userId, draftId, draft.current, draftSessionId);
  } }), [userId, draftId, draftSessionId]);
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    async function load() {
      setLoading(true); setError(null);
      try {
        const remote = await api(`/api/creation/runs/${runId}/outline`, { signal: controller.signal });
        let saved;
        saved = await readArtifactDraft(userId, draftId, draftSessionId);
        if (controller.signal.aborted) return;
        setQuote(remote);
        setImageProvider(saved?.inflight?.image?.provider ?? saved?.imageProvider ?? remote.imageProvider ?? remote.image?.provider ?? "");
        const field = remote.kind === "document" ? "sections" : "pages";
        if (saved?.format === "outline-v1" && saved.value?.[field]?.length) {
          setValue(saved.value); setBudget(String(saved.budget ?? remote.maxCredits));
          setGenerateVisuals(Boolean(saved.inflight?.image || saved.generateVisuals));
          submission.current = saved.inflight || null; setPending(saved.inflight || null);
          draft.current = saved;
        } else {
          const useImages = Boolean(remote.image && visualsFor(remote.outline).length);
          setGenerateVisuals(useImages);
          setValue(remote.outline); setBudget(String(Math.max(remote.maxCredits, remote.committedCredits + remote.outline[field].length * (remote.unitCost || 0) + (useImages ? visualsFor(remote.outline).length * remote.image.expectedCost : 0))));
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [runId, userId, draftId, draftSessionId, attempt]);
  useEffect(() => {
    if (!value || loading) return;
    const snapshot = { format: "outline-v1", value, budget, generateVisuals, imageProvider, dirty: !quote?.confirmed || Boolean(draft.current?.dirty), inflight: submission.current };
    draft.current = snapshot;
    timer.current = setTimeout(() => { void writeArtifactDraft(userId, draftId, snapshot, draftSessionId).catch(failure => { if (!life.current?.signal.aborted) setError(failure); }); }, 500);
    return () => clearTimeout(timer.current);
  }, [value, budget, generateVisuals, imageProvider, pending, loading, quote, userId, draftId, draftSessionId]);
  useEffect(() => {
    const save = () => {
      clearTimeout(timer.current);
      if (draft.current) void writeArtifactDraft(userId, draftId, draft.current, draftSessionId).catch(() => {});
    };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { save(); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, [userId, draftId, draftSessionId]);
  const displayed = showApproved && quote?.confirmed ? quote.outline : value;
  const page = displayed?.[itemsKey][Math.min(selected, displayed[itemsKey].length - 1)], readOnly = busy || Boolean(pending) || !quote?.canConfirm || showApproved;
  const visuals = visualsFor(value), usesImages = !isDocument && generateVisuals && visuals.length > 0;
  const image = pending ? pending.image : !imageProvider || quote?.image?.provider === imageProvider ? quote?.image : quote?.imageModels?.find(model => model.id === imageProvider)?.image;
  const required = quote?.unitCost == null || !value || usesImages && !image ? null : quote.committedCredits + value[itemsKey].length * quote.unitCost + (usesImages ? visuals.length * image.expectedCost : 0);
  function changePage(changes) { setValue(current => ({ ...current, [itemsKey]: current[itemsKey].map(item => item.id === page.id ? { ...item, ...changes } : item) })); }
  function move(offset) {
    const target = selected + offset;
    if (target < 0 || target >= value[itemsKey].length) return;
    setValue(current => { const pages = [...current[itemsKey]], [item] = pages.splice(selected, 1); pages.splice(target, 0, item); return { ...current, [itemsKey]: pages }; });
    setSelected(target);
  }
  async function refreshQuote() {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError(null);
    try {
      const fresh = await api(`/api/creation/runs/${runId}/outline`, { signal: life.current.signal });
      if (!life.current.signal.aborted) setQuote(fresh);
    } catch (failure) { if (!life.current.signal.aborted) setError(failure); }
    finally { gate.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  async function confirm() {
    if (gate.current || !value || !pending && (!quote?.canConfirm || quote.unitCost == null)) return;
    gate.current = true; setBusy(true); setError(null); clearTimeout(timer.current);
    const signal = life.current.signal;
    try {
      if (!submission.current && usesImages && !image) throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
      const body = submission.current || { saveKey: requestKey(), expectedSequence: quote.expectedSequence, expectedUnitCost: quote.unitCost, maxCredits: Number(budget), outline: value, ...(usesImages && image ? { image } : {}) };
      submission.current = body; setPending(body);
      draft.current = { format: "outline-v1", value: body.outline, budget: body.maxCredits, generateVisuals: Boolean(body.image), imageProvider, dirty: true, inflight: body };
      await writeArtifactDraft(userId, draftId, draft.current, draftSessionId);
      signal.throwIfAborted();
      const run = await api(`/api/creation/runs/${runId}/outline`, { method: "POST", body, signal, timeoutMs: 30000 });
      if (signal.aborted) return;
      clearTimeout(timer.current);
      draft.current = { format: "outline-v1", value: body.outline, budget: body.maxCredits, generateVisuals: Boolean(body.image), imageProvider, dirty: false, inflight: null };
      await writeArtifactDraft(userId, draftId, draft.current, draftSessionId);
      submission.current = null;
      if (!signal.aborted) { setPending(null); onConfirmed(run); }
    } catch (failure) {
      if (signal.aborted) return;
      if (failure.status >= 400 && failure.status < 500 && ![408, 429].includes(failure.status)) {
        submission.current = null; setPending(null);
        if (draft.current) draft.current = { ...draft.current, inflight: null, dirty: true };
      }
      setError(failure);
    } finally { gate.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <section className="cw-outline" aria-label={title}>
    <header><div><strong>{title}</strong><small>{isDocument ? text("确认章节和预算后开始分节写作", "Review sections and budget before writing") : text("先确认内容，再开始逐页设计", "Review the content before designing slides")}</small></div><button disabled={loading || busy || Boolean(pending)} onClick={async () => {
      try { if (draft.current) await writeArtifactDraft(userId, draftId, draft.current, draftSessionId); onDrafts(); } catch (error) { setError(error); }
    }}>{text("本地草稿", "Local drafts")}</button><button onClick={onClose} aria-label={text("关闭大纲", "Close outline")}><X size={17} /></button></header>
    {loading ? <p role="status">{text("正在读取大纲…", "Loading outline…")}</p> : value && <>
      {!quote.canConfirm && <p role="status">{text("此任务已离开大纲确认阶段。保留的本地内容可查看，不能覆盖已确认的任务。", "This task is no longer awaiting an outline. Preserved local content is viewable but cannot overwrite an accepted task.")}</p>}
      {quote.confirmed && <button onClick={() => { setShowApproved(current => !current); setSelected(0); }}>{text(showApproved ? "查看保留的本地大纲" : "查看服务器已确认大纲", showApproved ? "View preserved local outline" : "View confirmed server outline")}</button>}
      <label className="cw-outline-title">{isDocument ? text("文档标题", "Document title") : text("演示标题", "Presentation title")}<input value={displayed.title} maxLength={160} disabled={readOnly} onChange={event => setValue(current => ({ ...current, title: event.target.value }))} /></label>
      {!isDocument && displayed.design && <details className="cw-outline-design">
        <summary>{text("整套设计方案", "Deck design plan")}</summary>
        <div>{[["audience", "目标观众", "Audience", 600], ["narrative", "叙事主线", "Narrative", 2000], ["artDirection", "视觉方向", "Art direction", 2000], ["typography", "字体层级", "Typography", 1000], ["spacing", "间距与构图", "Spacing", 1000]].map(([field, cn, en, limit]) => <label key={field}>{text(cn, en)}<textarea value={displayed.design[field]} maxLength={limit} disabled={readOnly} onChange={event => setValue(current => ({ ...current, design: { ...current.design, [field]: event.target.value } }))} /></label>)}</div>
      </details>}
      {isDocument && displayed.design && <details className="cw-outline-design">
        <summary>{text("全篇写作与排版方案", "Document writing and layout plan")}</summary>
        <div>{[["purpose", "文档目标", "Purpose", 800], ["tone", "写作风格", "Tone", 600], ["narrative", "全篇结构", "Narrative", 1600], ["terminology", "术语与口径", "Terminology", 1200]].map(([field, cn, en, limit]) => <label key={field}>{text(cn, en)}<textarea value={displayed.design[field]} maxLength={limit} disabled={readOnly} onChange={event => setValue(current => ({ ...current, design: { ...current.design, [field]: event.target.value } }))} /></label>)}</div>
        <p className="cw-outline-help">{displayed.design.page.size} · {displayed.design.page.orientation === "landscape" ? text("横向", "Landscape") : text("纵向", "Portrait")} · {displayed.design.theme.fontSize} pt</p>
      </details>}
      <div className="cw-outline-body"><nav aria-label={isDocument ? text("大纲章节", "Outline sections") : text("大纲页面", "Outline pages")}>{displayed[itemsKey].map((item, index) => <button key={item.id} aria-current={page?.id === item.id ? "page" : undefined} onClick={() => setSelected(index)}><span>{index + 1}</span>{item.title || (isDocument ? text("未命名章节", "Untitled section") : text("未命名页面", "Untitled slide"))}</button>)}<button disabled={readOnly || value[itemsKey].length >= (isDocument ? 50 : 100)} onClick={() => {
        setValue(current => ({ ...current, [itemsKey]: [...current[itemsKey], { id: requestKey(), title: isDocument ? text("新章节", "New section") : text("新页面", "New slide"), brief: "", ...(isDocument ? {} : { notes: "" }) }] })); setSelected(value[itemsKey].length);
      }}><Plus size={14} />{isDocument ? text("添加章节", "Add section") : text("添加页面", "Add slide")}</button></nav>
      {page && <div className="cw-outline-page"><div className="cw-outline-page-actions"><strong>{text(`第 ${selected + 1} ${isDocument ? "节" : "页"}`, `${isDocument ? "Section" : "Slide"} ${selected + 1}`)}</strong><button disabled={readOnly || selected === 0} onClick={() => move(-1)} aria-label={isDocument ? text("章节前移", "Move section up") : text("页面前移", "Move slide up")}><ArrowUp size={15} /></button><button disabled={readOnly || selected === value[itemsKey].length - 1} onClick={() => move(1)} aria-label={isDocument ? text("章节后移", "Move section down") : text("页面后移", "Move slide down")}><ArrowDown size={15} /></button><button disabled={readOnly || value[itemsKey].length === 1} onClick={() => { setValue(current => ({ ...current, [itemsKey]: current[itemsKey].filter(item => item.id !== page.id) })); setSelected(Math.max(0, selected - 1)); }} aria-label={isDocument ? text("删除此节", "Remove section") : text("删除此页", "Remove slide")}><Trash2 size={15} /></button></div>
        <label>{isDocument ? text("章节标题", "Section title") : text("页面标题", "Slide title")}<input value={page.title} maxLength={160} disabled={readOnly} onChange={event => changePage({ title: event.target.value })} /></label>
        <label>{isDocument ? text("内容要点与写作要求", "Content and writing brief") : text("内容要点与排版要求", "Content and layout brief")}<textarea value={page.brief} maxLength={4000} disabled={readOnly} onChange={event => changePage({ brief: event.target.value })} /></label>
        {!isDocument && <><label>{text("此页作用", "Slide role")}<input value={page.role || ""} maxLength={240} disabled={readOnly} onChange={event => changePage({ role: event.target.value })} /></label><label>{text("构图与视觉层级", "Composition and hierarchy")}<textarea value={page.layout || ""} maxLength={1200} disabled={readOnly} onChange={event => changePage({ layout: event.target.value })} /></label>
          {page.visualId && <p className="cw-outline-help">{text("计划配图：", "Planned illustration: ")}{displayed.design?.visuals.find(visual => visual.id === page.visualId)?.prompt}</p>}</>}
        {!isDocument && <label>{text("演讲备注", "Speaker notes")}<textarea value={page.notes} maxLength={16000} disabled={readOnly} onChange={event => changePage({ notes: event.target.value })} /></label>}
      </div>}</div>
      {!isDocument && visuals.length > 0 && <div className="cw-outline-images">
        <GenerationModelSelect zh={zh} models={quote.imageModels} value={imageProvider} onChange={setImageProvider} disabled={readOnly} />
        <label><input type="checkbox" checked={generateVisuals} disabled={readOnly || !image && !generateVisuals} onChange={event => setGenerateVisuals(event.target.checked)} />{text("生成专属配图", "Generate original illustrations")}</label>
        <span>{image ? text(`${visuals.length} 张 × ${image.expectedCost} 积分，计入总预算；取消后只生成文字与排版。`, `${visuals.length} images × ${image.expectedCost} credits, included in the total. Uncheck for text and layout only.`) : text("配图服务暂不可用，可取消勾选继续生成文字与排版。", "Illustration service unavailable. Uncheck to continue with text and layout.")}</span>
      </div>}
      <footer><div><span>{text(`共 ${value[itemsKey].length} ${isDocument ? "节" : "页"} · 已用 ${quote.committedCredits} 积分`, `${value[itemsKey].length} ${isDocument ? "sections" : "slides"} · ${quote.committedCredits} credits used`)}</span><span>{required == null ? text("当前价格不可用", "Current price unavailable") : text(`预计总计 ${required} 积分（含已完成大纲）`, `Estimated total: ${required} credits, including the outline`)}</span></div>
        <label>{text("总预算上限", "Total budget limit")}<input type="number" min={quote.committedCredits} max={200000} step={1} value={budget} disabled={readOnly} onChange={event => setBudget(event.target.value)} /></label>
        <button disabled={busy || Boolean(pending)} onClick={refreshQuote}><RefreshCw size={14} />{text("刷新报价", "Refresh quote")}</button>
        <button className="cw-outline-confirm" disabled={busy || !pending && (readOnly || required == null || Number(budget) < required || !value.title.trim() || value[itemsKey].some(item => !item.title.trim() || !item.brief.trim()))} onClick={confirm}>{busy ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}{text(pending ? "恢复确认" : isDocument ? "确认并生成文档" : "确认并生成页面", pending ? "Recover confirmation" : isDocument ? "Confirm and generate document" : "Confirm and generate slides")}</button>
      </footer>
      <p className="cw-outline-help">{pending ? text("上次确认尚未得到结果，恢复会核对同一次请求。", "The previous confirmation is unverified. Recover checks the same request.") : text("修改暂存于此浏览器；确认后服务器会持续生成，关闭页面也会继续。", "Edits are kept in this browser. After confirmation, the server continues even if this page closes.")}</p>
    </>}
    {error && <p role="alert" className="cw-error">{creationError(error, zh)}{!value && <button onClick={() => setAttempt(value => value + 1)}>{text("重试", "Retry")}</button>}</p>}
  </section>;
}
