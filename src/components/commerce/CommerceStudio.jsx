"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ArrowUp, ImagePlus, Sparkles, LoaderCircle, Download, LayoutGrid, RefreshCw, X, FolderOpen, Plus, Check, MessageSquare, ScanEye } from "lucide-react";
import ModelPicker from "@/components/ui/ModelPicker";
import Modal from "@/components/ui/Modal";
import { getCase } from "@/lib/commerce/catalog";
import { normalizeBrief } from "@/lib/commerce/schema-client";
import { commerceContent } from "@/lib/commerce/project";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";
import "./agent.css";

function initialBrief(locale, caseId, description) {
  const item = getCase(caseId);
  return normalizeBrief({ product: item ? locale === "zh" ? item.product : item.productEn : "", description: description || (item ? locale === "zh" ? item.brief : item.briefEn : ""), language: locale, imageCount: 0, style: item?.style || "natural", theme: item?.theme || "linen", caseId: item?.id || "" }, { partial: true });
}

export default function CommerceStudio({ caseId = "", description = "", documentId = "", homeDraft = "" }) {
  const locale = useLocale(), zh = locale === "zh", router = useRouter(), { data: session, status } = useSession();
  const t = useCallback((cn, en) => zh ? cn : en, [zh]);
  const [brief, setBrief] = useState(() => initialBrief(locale, caseId, description));
  const [sources, setSources] = useState({ product: null, reference: null });
  const [doc, setDoc] = useState(null), docRef = useRef(null);
  const [jobs, setJobs] = useState([]), jobsRef = useRef([]);
  const [jobRefresh, setJobRefresh] = useState(0);
  const [loadedCaps, setCaps] = useState(null), [provider, setProvider] = useState(""), [size, setSize] = useState("1024x1536");
  const [message, setMessage] = useState(""), [target, setTarget] = useState(null), [busy, setBusy] = useState(""), [notice, setNotice] = useState("");
  const [projects, setProjects] = useState(null), [ready, setReady] = useState(false), [showFacts, setShowFacts] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const lock = useRef(false), pending = useRef(null), syncFailed = useRef(null), files = useRef({}), chatEnd = useRef(null);
  const storageKey = `modelshot-commerce-agent:${session?.user?.id || "guest"}`;
  const pendingKey = `${storageKey}:pending`;
  const commerce = doc?.content.commerce, sections = commerce?.sections || [], messages = doc?.content.messages || [];
  const caps = loadedCaps?.requestedProvider === provider ? loadedCaps : null;
  const editTool = caps?.tools?.find(tool => tool.id === "edit"), imageCost = editTool?.cost, planningCost = caps?.planningCost;
  const currentJob = s => jobs.find(j => j.sectionId === s.id && (j.sectionAttempt || 0) === s.attempt);
  const unstarted = sections.filter(s => !currentJob(s));

  const notify = useCallback(error => {
    const code = error?.code || error?.message || String(error);
    const labels = {
      UNAUTHORIZED: t("请先登录，填写的资料会保留。", "Sign in to continue; your brief is retained."),
      VISION_NOT_CONFIGURED: t("请在管理后台配置支持看图的大语言模型。", "Configure a vision-capable language model in admin."),
      SERVICE_NOT_CONFIGURED: t("所选图片模型尚未配置。", "The image model is not configured."),
      DOCUMENT_VERSION_CONFLICT: t("项目在其他页面有更新。请重新打开项目后继续，避免覆盖已有内容。", "This project changed elsewhere. Reopen it before continuing."),
      INSUFFICIENT_CREDITS: t("积分不足；已提交的任务会继续。", "Insufficient credits; submitted jobs continue."),
      INVALID_AGENT_PLAN: t("策划结果不完整，本次模型调用未扣费。请重试或补充要求。", "The plan was invalid and the model call was not charged. Retry or add detail."),
      REQUEST_IN_PROGRESS: t("这次策划仍在处理中，请稍后重试以取回结果，不会重复扣费。", "This request is still processing. Retry to recover it without another charge."),
      PRODUCT_IMAGE_REQUIRED: t("请上传商品原图。", "Upload a product image."),
      INVALID_INPUT: t("请填写产品名称和创作要求。", "Enter a product name and your request."),
    };
    setNotice(labels[code] || `${t("操作未完成：", "Could not complete: ")}${code}`);
  }, [t]);
  const accept = useCallback(next => { docRef.current = next; setDoc(next); }, []);
  const hydrate = useCallback(next => {
    const c = next.content?.commerce;
    if (!c) throw new Error("NOT_COMMERCE_PROJECT");
    if (docRef.current?.id !== next.id) { jobsRef.current = []; setJobs([]); }
    accept(next); setBrief(c.brief); setProvider(c.provider || ""); setSize(c.size || "1024x1536");
    const source = id => { const l = next.content.layers.find(l => l.assetId === id); return id ? { assetId: id, width: l?.pixelWidth, height: l?.pixelHeight } : null; };
    setSources({ product: source(c.productAssetId), reference: source(c.referenceAssetId) });
  }, [accept]);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    async function load() {
      if (documentId && session?.user?.id) {
        if (docRef.current?.id !== documentId) {
          const saved = await api(`/api/studio/documents/${encodeURIComponent(documentId)}`);
          if (!cancelled) hydrate(saved);
        }
      } else if (!docRef.current) {
        const stored = homeDraft ? JSON.parse(sessionStorage.getItem(`commerce-start:${homeDraft}`) || "null") : !caseId && !description ? JSON.parse(localStorage.getItem(storageKey) || "null") : null;
        if (stored && (stored.owner === "guest" || stored.owner === session?.user?.id) && !cancelled) {
          setBrief(normalizeBrief(stored.brief, { partial: true }));
          if (stored.owner === session?.user?.id) setSources({ product: stored.product, reference: stored.reference });
          setMessage(stored.message || "");
          if (homeDraft) { sessionStorage.removeItem(`commerce-start:${homeDraft}`); router.replace("/commerce"); }
        }
      }
      try {
        const savedTurn = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
        if (!cancelled && savedTurn?.body && (!documentId || savedTurn.body.documentId === documentId)) {
          if (docRef.current?.content.commerce?.agent?.lastTurn === savedTurn.key) sessionStorage.removeItem(pendingKey);
          else { pending.current = savedTurn; setRecoverable(true); }
        }
      } catch { /* Optional recovery cache. */ }
      if (!cancelled) setReady(true);
    }
    load().catch(e => { if (!cancelled) { notify(e); setReady(true); } });
    return () => { cancelled = true; };
  }, [status, session?.user?.id, documentId, homeDraft, caseId, description, storageKey, pendingKey, hydrate, notify, router]);

  useEffect(() => {
    if (!ready || doc) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify({ owner: session?.user?.id || "guest", brief, ...sources, message, pending: pending.current })); } catch { /* Cloud projects still work without local storage. */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [ready, doc, brief, sources, message, storageKey, session?.user?.id]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    api(`/api/studio/capabilities${provider ? `?imageProvider=${encodeURIComponent(provider)}` : ""}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setCaps({ ...result, requestedProvider: provider });
    }).catch(e => { if (!controller.signal.aborted) notify(e); });
    return () => controller.abort();
  }, [status, provider, notify]);

  useEffect(() => {
    if (!doc?.id) return;
    const controller = new AbortController(); let timer, fetching = false;
    async function poll() {
      if (fetching || document.visibilityState === "hidden") return;
      clearTimeout(timer); fetching = true;
      try {
        const rows = await api(`/api/studio/jobs?documentId=${doc.id}&recover=1`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        jobsRef.current = rows; setJobs(rows);
        if (rows.some(j => !terminalStatus(j.status))) timer = setTimeout(poll, 2500);
      } catch (e) { if (!controller.signal.aborted) { notify(e); timer = setTimeout(poll, 10000); } }
      finally { fetching = false; }
    }
    poll(); document.addEventListener("visibilitychange", poll);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", poll); };
  }, [doc?.id, jobRefresh, notify]);

  // Import finished images into this document, including older attempts. No
  // polling write when nothing changed, and never race a foreground operation.
  useEffect(() => {
    const saved = docRef.current;
    if (!saved || lock.current || busy) return;
    const content = commerceContent(saved.content, saved.content.commerce, [], jobs);
    const syncKey = `${saved.id}:${saved.version}:${content.layers.length}`;
    if (content.layers.length === saved.content.layers.length || syncFailed.current === syncKey) return;
    lock.current = true; setBusy("sync");
    api("/api/studio/documents", { method: "POST", body: { id: saved.id, version: saved.version, name: saved.name, content } }).then(accept).catch(e => { syncFailed.current = syncKey; notify(e); }).finally(() => { lock.current = false; setBusy(""); });
  }, [jobs, busy, accept, notify]);
  useEffect(() => {
    const chat = chatEnd.current?.parentElement;
    chat?.scrollTo({ top: chat.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [messages.length, busy]);

  async function action(label, fn) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setNotice("");
    try { await fn(); } catch (e) { notify(e); } finally { lock.current = false; setBusy(""); }
  }
  async function upload(kind, file) {
    if (!file) return;
    await action("upload", async () => {
      if (!session?.user) throw new Error("UNAUTHORIZED");
      if (file.size > 10 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body }); const asset = await response.json();
      if (!response.ok) throw new Error(asset.code || "UPLOAD_FAILED");
      setSources(s => ({ ...s, [kind]: asset }));
    });
  }
  async function turn({ reviewJobId, text, recover = false } = {}) {
    await action(reviewJobId ? "review" : "plan", async () => {
      if (!sources.product && !recover) throw new Error("PRODUCT_IMAGE_REQUIRED");
      const request = text || message.trim() || brief.description.trim();
      if ((!brief.product.trim() || !request) && !recover) throw new Error("INVALID_INPUT");
      const saved = docRef.current;
      const body = recover ? pending.current.body : { ...(saved ? { documentId: saved.id, version: saved.version } : {}), brief, productAssetId: sources.product.assetId, ...(sources.reference ? { referenceAssetId: sources.reference.assetId } : {}), ...(provider ? { provider } : {}), size, message: request, ...(target && !reviewJobId ? { targetSectionId: target } : {}), ...(reviewJobId ? { reviewJobId } : {}) };
      const fingerprint = JSON.stringify(body);
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: requestKey(), body };
      try { sessionStorage.setItem(pendingKey, JSON.stringify(pending.current)); } catch { /* In-memory replay still works. */ }
      let result;
      try { result = await api("/api/commerce/plan", { method: "POST", key: pending.current.key, body }); }
      catch (e) {
        const canRecover = !e.code || ["REQUEST_IN_PROGRESS", "REQUEST_FAILED", "INTERNAL_ERROR", "DOCUMENT_VERSION_CONFLICT"].includes(e.code);
        setRecoverable(canRecover);
        if (!canRecover) { pending.current = null; try { sessionStorage.removeItem(pendingKey); } catch { /* Optional cache. */ } }
        throw e;
      }
      pending.current = null; setRecoverable(false); hydrate(result.document); setMessage(""); setTarget(null);
      try { localStorage.removeItem(storageKey); sessionStorage.removeItem(pendingKey); } catch { /* Optional draft cache. */ }
      router.replace(`/commerce?document=${result.document.id}`);
    });
  }
  async function persist(nextCommerce = docRef.current.content.commerce) {
    const saved = docRef.current;
    const content = commerceContent(saved.content, { ...nextCommerce, ...(provider ? { provider } : { provider: undefined }), size }, [], jobsRef.current);
    const next = await api("/api/studio/documents", { method: "POST", body: { id: saved.id, version: saved.version, name: saved.name, content } });
    accept(next); return next;
  }
  async function run(sectionId, retry = false) {
    await action("run", async () => {
      const c = docRef.current.content.commerce;
      const nextCommerce = retry ? { ...c, sections: c.sections.map(s => s.id === sectionId ? { ...s, attempt: s.attempt + 1 } : s) } : c;
      const saved = await persist(nextCommerce);
      const ids = sectionId ? [sectionId] : saved.content.commerce.sections.filter(s => !jobsRef.current.some(j => j.sectionId === s.id && (j.sectionAttempt || 0) === s.attempt)).map(s => s.id);
      if (!ids.length) return;
      const result = await api("/api/commerce/run", { method: "POST", body: { documentId: saved.id, version: saved.version, sectionIds: ids } });
      jobsRef.current = [...result.jobs, ...jobsRef.current.filter(j => !result.jobs.some(n => n.id === j.id))]; setJobs(jobsRef.current);
      setJobRefresh(value => value + 1);
      if (result.failure) throw new Error(result.failure);
    });
  }
  async function downloadSet() {
    await action("download", async () => {
      const { default: JSZip } = await import("jszip"), zip = new JSZip();
      for (const [index, section] of sections.entries()) {
        const asset = currentJob(section)?.resultData?.assets?.[0];
        if (!asset) continue;
        const response = await fetch(`/api/assets/${asset.id}`);
        if (!response.ok) throw new Error("IMAGE_LOAD_FAILED");
        zip.file(`${String(index + 1).padStart(2, "0")}-${section.id}.png`, await response.blob());
      }
      zip.file("creative-brief.json", JSON.stringify(commerce, null, 2));
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "modelshot-commerce.zip"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function newProject() {
    accept(null); setBrief(initialBrief(locale, "", "")); setSources({ product: null, reference: null }); setJobs([]); jobsRef.current = []; setMessage(""); setTarget(null); pending.current = null; setRecoverable(false); setShowFacts(false);
    try { localStorage.removeItem(storageKey); sessionStorage.removeItem(pendingKey); } catch { /* Optional cache. */ }
    router.replace("/commerce");
  }
  const disabled = Boolean(busy), models = caps?.imageModels?.filter(m => m.maxReferenceImages > 0) || [];
  const modelControls = <div className="ca-model-controls"><ModelPicker models={models} value={provider || caps?.imageProvider} onChange={setProvider} zh={zh} disabled={disabled} /><select aria-label={t("图片比例", "Image ratio")} value={size} disabled={disabled} onChange={e => setSize(e.target.value)}><option value="1024x1536">2:3</option><option value="1024x1024">1:1</option><option value="1536x1024">3:2</option></select></div>;
  const facts = <div className="ca-facts"><div className="ca-uploads">{[["product", "商品原图", "Product image"], ["reference", "风格参考", "Style reference"]].map(([kind, cn, en]) => <div key={kind}><button type="button" disabled={disabled || Boolean(doc)} onClick={() => files.current[kind]?.click()} aria-label={zh ? cn : en}>{sources[kind] ? <Image unoptimized src={previewUrl(sources[kind].assetId, 640)} width={120} height={100} alt={zh ? cn : en} /> : <ImagePlus size={23} />}<span>{zh ? cn : en}</span></button>{sources[kind] && !doc && <button type="button" className="ca-remove" aria-label={t("移除", "Remove ") + (zh ? cn : en)} onClick={() => setSources(s => ({ ...s, [kind]: null }))}><X size={12} /></button>}<input hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("上传", "Upload ") + (zh ? cn : en.toLowerCase())} ref={el => { files.current[kind] = el; }} onChange={e => { upload(kind, e.target.files[0]); e.target.value = ""; }} /></div>)}</div><div className="ca-fields">{[["product", "产品名称", "Product", 80], ["brand", "品牌", "Brand", 60]].map(([key, cn, en, max]) => <label key={key}>{zh ? cn : en}<input maxLength={max} value={brief[key]} disabled={disabled} onChange={e => setBrief(b => ({ ...b, [key]: e.target.value }))} /></label>)}</div><div className="ca-fields three">{[["platform", "平台", "Platform", [["taobao", "淘宝 / 天猫"], ["amazon", "Amazon A+"], ["shopify", "Shopify"]]], ["region", "市场", "Market", [["CN", "中国"], ["US", "US"], ["EU", "EU"]]], ["language", "语言", "Language", [["zh", "中文"], ["en", "English"]]]].map(([key, cn, en, options]) => <label key={key}>{zh ? cn : en}<select aria-label={zh ? cn : en} disabled={disabled} value={brief[key]} onChange={e => setBrief(b => ({ ...b, [key]: e.target.value }))}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div><div className="ca-fields"><label>{t("视觉方向", "Art direction")}<select aria-label={t("视觉方向", "Art direction")} disabled={disabled} value={brief.style} onChange={e => setBrief(b => ({ ...b, style: e.target.value }))}><option value="natural">{t("自然生活方式", "Natural lifestyle")}</option><option value="editorial">{t("品牌杂志风", "Editorial")}</option><option value="studio">{t("干净棚拍", "Clean studio")}</option></select></label><label>{t("图片数量", "Image count")}<select aria-label={t("图片数量", "Image count")} disabled={disabled || Boolean(sections.length)} value={brief.imageCount || 0} onChange={e => setBrief(b => ({ ...b, imageCount: Number(e.target.value) }))}><option value={0}>{t("由需求决定", "Based on brief")}</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label></div><label>{t("产品事实与要求", "Product facts & requirements")}<textarea rows={3} maxLength={2400} value={brief.description} disabled={disabled} onChange={e => setBrief(b => ({ ...b, description: e.target.value }))} placeholder={t("告诉我真实卖点、受众和想要的感觉…", "Verified features, audience and desired feeling…")} /></label></div>;

  return <main className={`cm-workspace ca-workspace ${doc ? "ca-has-project" : ""}`}>
    <header className="ca-header"><div><span className="ca-eyebrow">COMMERCE STUDIO</span><h1>{doc?.name || t("为你的产品，设计一整套表达。", "A complete visual story for your product.")}</h1></div><div><button className="ca-button" disabled={disabled} onClick={() => action("projects", async () => setProjects(await api("/api/studio/documents?kind=commerce")))}><FolderOpen size={16} />{t("项目", "Projects")}</button>{doc && <button className="ca-button" disabled={disabled} onClick={newProject}><Plus size={16} />{t("新建", "New")}</button>}</div></header>
    {notice && <div role="alert" className="ca-notice">{notice}<button aria-label={t("关闭提示", "Dismiss")} onClick={() => setNotice("")}><X size={16} /></button></div>}
    {recoverable && <div className="ca-notice"><span>{t("上次请求未确认完成，可以取回同一次请求的结果。", "The last request was not confirmed. Recover that request without submitting a new one.")}</span><button className="ca-button" disabled={disabled} onClick={() => turn({ recover: true })}>{t("恢复上次请求", "Recover request")}</button></div>}
    {!session?.user && ready && <p className="ca-notice">{t("登录后开始策划与生成，填写的资料会保留。", "Sign in to plan and generate. Your brief is retained.")}<Link href={`/login?callbackUrl=${encodeURIComponent(`/${locale}/commerce`)}`}>{t("登录", "Sign in")}</Link></p>}
    {!doc ? <section className="ca-start"><div className="ca-intro"><Sparkles size={25} /><h2>{t("先聊产品，再做设计。", "Start with your product.")}</h2><p>{t("上传商品，描述目标。一起确定每张图的内容、风格和用途，再开始生成。", "Share a product and a goal. Build a visual direction and a tailored image plan before generating.")}</p></div>{facts}<div className="ca-start-footer">{modelControls}<button className="ca-primary" disabled={disabled || !ready || !session?.user || !sources.product || !brief.product.trim() || !brief.description.trim() || !caps?.planningAvailable} onClick={() => turn()}>{busy ? <LoaderCircle size={17} className="ca-spin" /> : <ArrowUp size={17} />}{t("开始策划", "Plan my collection")}</button></div><p className="ca-hint">{caps?.planningAvailable ? t(`策划 ${planningCost} 积分 / 次 · 图片生成前会显示费用`, `Planning ${planningCost} credits / turn · Image costs shown before generation`) : t("需要在后台连接支持看图的大语言模型后开始策划。", "Connect a vision-capable language model in admin to start.")}</p></section> : <div className="ca-project-layout">
      <aside className="ca-conversation"><div className="ca-conversation-heading"><span><Sparkles size={16} />{t("创作对话", "Creative direction")}</span><button disabled={disabled} onClick={() => setShowFacts(v => !v)}>{t("商品资料", "Product brief")}</button></div>{showFacts && facts}<div className="ca-messages">{messages.map(m => <article key={m.id} className={`ca-message ca-${m.role}`}><small>{m.role === "user" ? t("你", "You") : t("创作助手", "Creative assistant")}</small><p>{m.text}</p></article>)}{["plan", "review"].includes(busy) && <div className="ca-working" role="status"><LoaderCircle size={15} className="ca-spin" />{busy === "review" ? t("正在检查产品与画面…", "Reviewing product fidelity…") : t("正在分析需求与设计方案…", "Developing the visual plan…")}</div>}<div ref={chatEnd} /></div><form className="ca-composer" onSubmit={e => { e.preventDefault(); turn(); }}>{target && <div className="ca-target">{t("仅修改：", "Only revise: ")}{sections.find(s => s.id === target)?.title}<button type="button" aria-label={t("取消指定图片", "Clear target")} onClick={() => setTarget(null)}><X size={13} /></button></div>}<textarea aria-label={t("继续创作", "Continue creating")} rows={3} maxLength={2400} value={message} disabled={disabled} onChange={e => setMessage(e.target.value)} placeholder={t("比如：第二张换成户外场景，保留其他图片…", "Try: move image two outdoors, keep the rest…")} /><div><span>{planningCost != null ? `${planningCost} ${t("积分 / 次", "credits / turn")}` : ""}</span><button className="ca-primary" disabled={disabled || !message.trim() || !caps?.planningAvailable} aria-label={t("发送修改要求", "Send request")}><ArrowUp size={17} /></button></div></form></aside>
      <section className="ca-results"><header className="ca-results-heading"><div><h2>{t("创作任务", "Creative tasks")}<span>{sections.length}</span></h2><p>{t("每张图独立生成，历史版本保留在同一画布。", "Generate independently. Keep every version in this canvas.")}</p></div><button className="ca-button" disabled={disabled} onClick={() => action("canvas", async () => { const saved = await persist(); router.push(`/studio-v2?document=${saved.id}`); })}><LayoutGrid size={15} />{t("打开画布", "Open canvas")}</button></header>
        {commerce.agent?.styleLock && <details className="ca-strategy"><summary>{t("整套视觉方向与事实依据", "Campaign direction & evidence")}</summary><p>{commerce.agent.styleLock}</p>{commerce.agent.evidence.map((fact, i) => <p key={i}>· {fact}</p>)}</details>}
        <div className="ca-execution">{modelControls}<button className="ca-primary" disabled={disabled || !unstarted.length || !editTool?.available} onClick={() => run()}><Sparkles size={15} />{t(`生成待办 ${unstarted.length} 张`, `Generate ${unstarted.length} pending`)}{imageCost != null && <span>{unstarted.length * imageCost} {t("积分", "credits")}</span>}</button></div>
        {!editTool?.available && <p className="ca-hint">{t("当前图片模型不可用，请选择支持参考图编辑的模型。", "Select an available image model that supports reference editing.")}</p>}
        {!sections.length && <div className="ca-empty"><MessageSquare size={28} /><p>{t("在左侧补充关键信息，继续完善这份方案。", "Answer the questions to develop this plan.")}</p></div>}
        <div className="ca-card-grid">{sections.map((s, index) => { const job = currentJob(s), asset = job?.status === "succeeded" ? job.resultData?.assets?.[0] : null, running = job && !terminalStatus(job.status); return <article key={s.id} className={`ca-card ${target === s.id ? "ca-selected" : ""}`}><div className="ca-card-image" style={{ aspectRatio: size.replace("x", " / ") }}>{asset ? <Image unoptimized src={previewUrl(asset.id, 1280)} fill sizes="(max-width: 700px) 90vw, 400px" alt={s.title} /> : <div>{running ? <LoaderCircle size={26} className="ca-spin" /> : <span>{String(index + 1).padStart(2, "0")}</span>}<strong>{running ? t("正在生成", "Generating") : job ? t("生成未完成", "Generation incomplete") : t("待生成", "Ready to generate")}</strong><p>{s.purpose || s.title}</p></div>}</div><div className="ca-card-body"><div className="ca-card-title"><h3>{s.title}</h3>{asset && <Check size={15} />}</div><p>{s.body}</p><details><summary>{t("查看设计方案", "Design direction")}</summary><p>{s.direction || s.prompt}</p>{s.evidence && <p>{t("依据：", "Evidence: ")}{s.evidence}</p>}</details>{job?.errorCode && <p className="ca-error" role="status">{job.errorCode}</p>}<div className="ca-card-actions"><button className="ca-button" disabled={disabled} onClick={() => { setTarget(s.id); setMessage(""); }}><MessageSquare size={13} />{t("修改", "Revise")}</button><button className="ca-button" disabled={disabled || running || !editTool?.available || s.attempt >= 50} onClick={() => run(s.id, Boolean(job))}>{job ? <RefreshCw size={13} /> : <Sparkles size={13} />}{job ? t("重做", "Retry") : t("生成", "Generate")}{imageCost != null && <span>· {imageCost}</span>}</button>{asset && <button className="ca-button" disabled={disabled || !caps?.planningAvailable} onClick={() => turn({ reviewJobId: job.id, text: t(`检查「${s.title}」的产品一致性、文案和视觉效果`, `Review product fidelity, copy and design for ${s.title}`) })}><ScanEye size={13} />{t("检查", "Review")} · {planningCost}</button>}</div></div></article>; })}</div>
        {sections.some(s => currentJob(s)?.status === "succeeded") && <footer className="ca-download"><button className="ca-button" disabled={disabled} onClick={downloadSet}><Download size={15} />{t("下载已完成图片与方案", "Download completed images & brief")}</button></footer>}
      </section></div>}
    {projects && <Modal label={t("电商项目", "Commerce projects")} className="ca-modal" onClose={() => setProjects(null)}><header><h2>{t("我的项目", "My projects")}</h2><button aria-label={t("关闭", "Close")} onClick={() => setProjects(null)}><X size={18} /></button></header>{projects.length ? projects.map(p => <button className="ca-project-row" key={p.id} disabled={disabled} onClick={() => action("load", async () => { const next = await api(`/api/studio/documents/${p.id}`); hydrate(next); setJobs([]); jobsRef.current = []; setProjects(null); router.replace(`/commerce?document=${p.id}`); })}><FolderOpen size={17} /><span>{p.name}<small>{new Date(p.updatedAt).toLocaleString(locale)}</small></span></button>) : <p>{t("开始第一次策划后，项目会保存在这里。", "Your first plan creates a project here.")}</p>}</Modal>}
  </main>;
}
