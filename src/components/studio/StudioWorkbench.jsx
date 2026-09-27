"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Aperture, ArrowUp, ArrowDown, ArrowUpRight, Plus, X, FolderOpen, Download, Save, Undo2, Redo2, MousePointer2, Hand, ImagePlus, Type, Layers3, Sparkles, WandSparkles, Expand, Crop, Eraser, Move, ScanText, Scissors, Video, MessageCircle, Zap, ShoppingBag, ChevronDown, Check, LoaderCircle, ZoomIn, Minus, Maximize, Trash2, Eye, EyeOff, Copy, Coins, Play, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { TOOLS, getTool } from "@/lib/studio/tools";
import { appendResult, scaleToFit } from "@/lib/studio/canvas-utils";
import { maskHash as hashMask } from "@/lib/studio/mask-hash";
import "./studio.css";

const Canvas = dynamic(() => import("./StudioCanvas"), { ssr: false, loading: () => <div className="ms-loading"><LoaderCircle className="ms-spin" size={22} /></div> });
const ICONS = { generate: Sparkles, edit: WandSparkles, expand: Expand, upscale: ZoomIn, describe: WandSparkles, erase: Eraser, inpaint: Scissors, split: Layers3, move: Move, ocr: ScanText, "remove-bg": Scissors, crop: Crop, video: Video };
const TERMINAL = ["succeeded", "failed", "cancelled"];
const blank = () => ({ id: null, version: null, name: "Untitled", layers: [], messages: [], jobs: [], appliedJobs: [], plan: null });
const imageUrl = id => `/api/assets/${id}`;
const delay = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("SESSION_CLOSED")); }, { once: true }); });

export default function StudioWorkbench({ initialDocument = "", initialPrompt = "", initialMode = "chat" }) {
  const locale = useLocale(), zh = locale === "zh", { data: session, status } = useSession();
  const t = useCallback((cn, en) => zh ? cn : en, [zh]);
  const [draft, setDraft] = useState(blank), draftRef = useRef(draft);
  const [selectedId, setSelected] = useState(null), [tab, setTab] = useState(initialMode), [mode, setMode] = useState("select");
  const [toolId, setTool] = useState(null), [prompt, setPrompt] = useState(initialPrompt), [params, setParams] = useState({ size: "1024x1024", scale: 2, padding: 256, dx: 100, dy: 0, duration: 5, editPadding: 0.25 });
  const [brush, setBrush] = useState(40), [zoom, setZoom] = useState(1), [capabilities, setCapabilities] = useState(null), [usage, setUsage] = useState(null);
  const [modelProvider, setModelProvider] = useState("");
  const [objectSelection, setObjectSelection] = useState(null);
  const [projects, setProjects] = useState(null), [jobs, setJobs] = useState([]), [showLayers, setShowLayers] = useState(false), [mobileChat, setMobileChat] = useState(true);
  const [busy, setBusy] = useState(false), [saveState, setSaveState] = useState("local"), [notice, setNotice] = useState(null), [preview, setPreview] = useState(null), [ocr, setOcr] = useState(null);
  const [historyCount, setHistoryCount] = useState({ past: 0, future: 0 });
  const history = useRef({ past: [], future: [] }), canvas = useRef(null), fileInput = useRef(null), saveQueue = useRef(Promise.resolve()), fitTimer = useRef(null);
  const life = useRef(null), submission = useRef(false);
  const selected = draft.layers.find(l => l.id === selectedId);
  const tool = getTool(toolId), toolStatus = capabilities?.tools.find(row => row.id === toolId);
  const activeModel = capabilities?.imageModels?.find(model => model.id === modelProvider);
  const quickCost = activeModel?.creditCost ?? capabilities?.tools.find(row => row.id === (selected?.type === "image" ? "edit" : "generate"))?.cost ?? 18;
  const toolCost = toolStatus?.cost ?? tool?.cost ?? 0;
  const storageKey = session?.user?.id ? `modelshot-studio-v1:${session.user.id}` : null;

  const update = useCallback(next => {
    const value = typeof next === "function" ? next(draftRef.current) : next;
    draftRef.current = value; setDraft(value); setSaveState("local");
    // Flush on every committed operation, including undo/redo. A debounced write
    // can lose the last edit when switching locale or immediately refreshing.
    if (storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify(value)); }
      catch { setNotice(t("本地存储已满，请保存到云端。", "Local storage is full. Save to the cloud.")); }
    }
    return value;
  }, [storageKey, t]);
  const notify = useCallback(error => {
    const code = typeof error === "string" ? error : error?.code || error?.message || "UNKNOWN_ERROR";
    const descriptions = {
      DOCUMENT_VERSION_CONFLICT: t("云端版本已更新。本地修改仍在，请另存为新项目或打开云端版本。", "Cloud version changed. Save as a new project or open the cloud version."),
      INSUFFICIENT_CREDITS: t("可用积分不足，请补充积分后重试。", "Not enough available credits."),
      UNAUTHORIZED: t("请先登录，素材和作品会保存到你的账户。", "Sign in to save assets and projects."),
      SERVICE_NOT_CONFIGURED: t("这个工具还没有连接模型服务，请在部署配置中启用。", "This tool needs a configured provider."),
      SEGMENTATION_NOT_CONFIGURED: t("请先启用物体分割服务，再选择需要移动或修改的物体。", "Object editing requires the segmentation service."),
      SEGMENTATION_FAILED: t("没有识别出物体，请用框选或套索贴近目标重新选择。", "No object was detected. Draw a tighter selection and try again."),
      TOOL_SERVICE_UNAVAILABLE: t("图像工具服务不可用，请检查 tools 容器。", "The image tool service is unavailable."),
      TOOL_DISABLED: t("管理员已停用这个工具。", "This tool has been disabled by an administrator."),
      TARGET_CHANGED: t("目标图片已变化，请重新选择图片。", "The target changed. Select the image again."),
      VISION_NOT_CONFIGURED: t("管理员尚未配置对话规划模型。请在后台“模型通道”填写视觉/对话规划模型并设为规划通道；也可使用“快速生图”直接生成一张图。", "No planning model is configured. Configure one in Admin → Model channels, or use Quick generation for a direct single-image request."),
    };
    setNotice(descriptions[code] || code);
  }, [t]);
  const commitLayers = useCallback(layers => {
    history.current.past = [...history.current.past, draftRef.current.layers].slice(-40); history.current.future = [];
    update(d => ({ ...d, layers })); setHistoryCount({ past: history.current.past.length, future: 0 });
  }, [update]);
  function undo(redo = false) {
    const from = redo ? history.current.future : history.current.past;
    if (!from.length) return;
    const to = redo ? history.current.past : history.current.future;
    to.push(draftRef.current.layers); update(d => ({ ...d, layers: from.pop() })); setHistoryCount({ past: history.current.past.length, future: history.current.future.length });
  }
  function message(role, text, assetId, id = requestKey()) {
    update(d => d.messages.some(m => m.id === id) ? d : ({ ...d, messages: [...d.messages, { id, role, text, ...(assetId ? { assetId } : {}) }].slice(-100) }));
  }
  function scheduleFit(delay = 0) {
    clearTimeout(fitTimer.current);
    fitTimer.current = setTimeout(() => canvas.current?.fit(), delay);
  }
  useEffect(() => {
    const abort = new AbortController(); life.current = abort;
    if (status === "authenticated") {
      Promise.resolve().then(async () => {
        if (initialDocument) {
          const doc = await api(`/api/studio/documents/${encodeURIComponent(initialDocument)}`, { signal: abort.signal });
          if (!abort.signal.aborted) { update({ ...blank(), id: doc.id, version: doc.version, name: doc.name, ...doc.content }); scheduleFit(200); }
        } else { try { const cached = JSON.parse(localStorage.getItem(storageKey)); update(cached?.layers && cached?.messages ? { ...blank(), ...cached } : blank()); } catch { update(blank()); } }
      }).catch(e => { if (!abort.signal.aborted) notify(e); });
      Promise.all([api("/api/studio/capabilities", { signal: abort.signal }), api("/api/usage", { signal: abort.signal })]).then(([caps, value]) => { setCapabilities(caps); setModelProvider(current => current || caps.imageProvider || caps.imageModels?.[0]?.id || ""); setUsage(value); }).catch(e => { if (!abort.signal.aborted) notify(e); });
    } else if (status === "unauthenticated") Promise.resolve().then(() => update(blank()));
    return () => { abort.abort(); clearTimeout(fitTimer.current); };
  }, [status, storageKey, update, notify, initialDocument]);
  useEffect(() => {
    const handler = e => {
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); document.querySelector('[data-action="save-studio"]')?.click(); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);

  const collectResult = useCallback(job => {
    if (job.status !== "succeeded") return;
    const current = draftRef.current;
    if (job.documentId !== current.id) return;
    if (current.appliedJobs?.includes(job.id)) return;
    const layers = appendResult(current.layers, job, current.layers.find(l => l.id === job.targetId));
    const messages = [...current.messages];
    if (!messages.some(m => m.id === job.id)) messages.push({ id: job.id, role: "assistant", text: job.resultData?.text || `${zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · ${t("已完成", "Complete")}`, ...(job.resultData?.assets?.[0]?.contentType?.startsWith("image/") ? { assetId: job.resultData.assets[0].id } : {}) });
    if (layers.length !== current.layers.length) {
      history.current.past = [...history.current.past, current.layers].slice(-40); history.current.future = [];
      setHistoryCount({ past: history.current.past.length, future: 0 });
    }
    update({ ...current, layers, messages: messages.slice(-100), appliedJobs: [...(current.appliedJobs || []), job.id].slice(-100) });
  }, [update, zh, t]);
  useEffect(() => {
    if (!draft.id || status !== "authenticated") return;
    const abort = new AbortController();
    let timer;
    let signature = "";
    async function poll() {
      try {
        const rows = await api(`/api/studio/jobs?documentId=${encodeURIComponent(draft.id)}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setJobs(rows); rows.toReversed().forEach(collectResult);
        const nextSignature = rows.map(row => `${row.id}:${row.status}`).join("|");
        if (signature !== nextSignature) {
          signature = nextSignature;
          const value = await api("/api/usage", { signal: abort.signal });
          if (!abort.signal.aborted) setUsage(value);
        }
      } catch (e) { if (!abort.signal.aborted) notify(e); }
      if (!abort.signal.aborted) timer = setTimeout(poll, 4000);
    }
    poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [draft.id, status, collectResult, notify]);

  function save(copy = false) {
    const task = async () => {
      if (!session?.user) throw new Error("UNAUTHORIZED");
      setSaveState("saving");
      const d = draftRef.current;
      const saved = await api("/api/studio/documents", { method: "POST", body: { ...(!copy && d.id ? { id: d.id, version: d.version } : {}), name: d.name, content: { schemaVersion: 1, layers: d.layers, messages: d.messages, jobs: d.jobs, appliedJobs: d.appliedJobs || [], plan: d.plan || null } } });
      if (draftRef.current.id === d.id) update(current => ({ ...current, id: saved.id, version: saved.version }));
      setSaveState("saved"); return saved;
    };
    saveQueue.current = saveQueue.current.catch(() => {}).then(task);
    return saveQueue.current;
  }
  async function uploadFile(file) {
    if (!session?.user) throw new Error("UNAUTHORIZED");
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error(t("请选择 10 MB 以内的 PNG / JPG / WebP。", "Choose a PNG, JPG or WebP under 10 MB."));
    const form = new FormData(); form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form }); const data = await res.json();
    if (!res.ok) throw new Error(data.code || "UPLOAD_FAILED");
    return data;
  }
  async function upload(files) {
    if (submission.current) return;
    submission.current = true; setBusy(true);
    try {
      for (const file of [...files].slice(0, 12)) {
        const asset = await uploadFile(file), size = scaleToFit(asset.width, asset.height, 480);
        const current = draftRef.current.layers, id = requestKey();
        commitLayers([...current, { id, assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x: current.length ? Math.max(...current.map(l => l.x + l.width)) + 48 : 90, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, opacity: 1, visible: true }]);
        setSelected(id);
      }
      setMobileChat(false); scheduleFit(150);
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  function chooseTool(id) {
    clearTimeout(fitTimer.current);
    setTool(id); canvas.current?.clearMask(); setObjectSelection(null);
    setMode(["move", "inpaint"].includes(id) ? "object-select-rect" : id === "expand" ? "expand" : getTool(id)?.mask ? "mask" : id === "crop" ? "crop" : "select");
    if (id === "crop" && selected) setParams(p => ({ ...p, rect: { left: 0, top: 0, width: selected.pixelWidth, height: selected.pixelHeight } }));
    if (id === "move") setParams(p => ({ ...p, dx: 0, dy: 0 }));
    if (id === "expand") {
      setParams(p => ({ ...p, padding: typeof p.padding === "number" ? { left: p.padding, right: p.padding, top: p.padding, bottom: p.padding } : p.padding }));
    }
    setOcr(null);
  }
  async function submit(id, target, text, options = {}, maskBlob, key = requestKey()) {
    const saved = await save();
    const maskHash = maskBlob ? await hashMask(maskBlob) : null;
    const signature = JSON.stringify({ id, target: target?.id, asset: target?.assetId, text, options, maskHash, documentId: saved.id });
    const pending = draftRef.current.pendingSubmit;
    let body;
    let maskId;
    if (pending?.signature === signature) { body = { ...pending.body, documentVersion: saved.version }; key = pending.key; }
    else {
      if (maskBlob) maskId = (await uploadFile(new File([maskBlob], "mask.png", { type: "image/png" }))).assetId;
      body = { tool: id, ...(modelProvider ? { provider: modelProvider } : {}), documentId: saved.id, documentVersion: saved.version, ...(target ? { targetId: target.id, assetId: target.assetId } : {}), ...(maskId ? { maskId } : {}), params: { ...options, prompt: text } };
      const next = update(d => ({ ...d, pendingSubmit: { signature, key, body } }));
      // Persist the key before network I/O so a refresh cannot silently submit twice.
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    }
    const job = await api("/api/studio/jobs", { method: "POST", key, body });
    update(d => ({ ...d, pendingSubmit: null, jobs: [...new Set([...d.jobs, job.id])].slice(-100) }));
    setJobs(current => [job, ...current.filter(j => j.id !== job.id)]); return job;
  }
  async function runTool() {
    if (submission.current || (["move", "inpaint"].includes(toolId) && !objectSelection)) return;
    if (toolId === "move" && !params.dx && !params.dy) return;
    submission.current = true; setBusy(true);
    try {
      const mask = tool?.mask ? await canvas.current.maskBlob() : null;
      const target = selected;
      await submit(toolId, target, prompt, { ...params, selectionMode: ["move", "inpaint"].includes(toolId) ? "object" : "mask" }, mask);
      message("user", prompt || (zh ? tool.zh : tool.en), target?.assetId);
      setTool(null); setMode("select"); setPrompt(""); setObjectSelection(null); canvas.current?.clearMask();
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  async function send() {
    if (submission.current || !prompt.trim()) return;
    const text = prompt, target = selected?.type === "image" ? selected : null;
    submission.current = true; setBusy(true);
    try {
      if (tab === "quick") await submit(target ? "edit" : "generate", target, text, { size: params.size });
      else {
        const planned = await api("/api/studio/plan", { method: "POST", body: { prompt: text, ...(target ? { assetId: target.assetId } : {}), messages: draftRef.current.messages.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 2000) })) } });
        update(d => ({ ...d, plan: { ...planned, id: requestKey(), index: 0, targetId: target?.id || null, status: "ready", activeJob: null } }));
      }
      message("user", text, target?.assetId); setPrompt("");
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  async function waitJob(id) {
    const signal = life.current.signal;
    while (!signal.aborted) {
      const job = await api(`/api/studio/jobs/${id}`, { signal });
      if (TERMINAL.includes(job.status)) { collectResult(job); return job; }
      await delay(2000, signal);
    }
    throw new Error("SESSION_CLOSED");
  }
  async function runPlan() {
    if (submission.current) return;
    submission.current = true; setBusy(true);
    const planId = draftRef.current.plan.id;
    try {
      let p = draftRef.current.plan;
      for (let index = p.index; index < p.steps.length; index++) {
        const step = p.steps[index];
        const target = draftRef.current.layers.find(l => l.id === p.targetId);
        if (getTool(step.tool).source && !target) throw new Error("TARGET_CHANGED");
        const job = p.activeJob ? { id: p.activeJob } : await submit(step.tool, target, step.params.prompt || "", step.params, null, `${planId}-${index}-${p.attempt || 0}`);
        p = { ...p, activeJob: job.id, status: "running", index }; update(d => ({ ...d, plan: p }));
        const result = await waitJob(job.id);
        if (result.status !== "succeeded") {
          update(d => ({ ...d, plan: { ...p, activeJob: null, attempt: (p.attempt || 0) + 1, status: "paused" } }));
          throw new Error(result.errorCode || result.status);
        }
        p = { ...p, index: index + 1, activeJob: null, attempt: 0, targetId: result.resultData?.assets?.length ? `${job.id}-0` : p.targetId, status: "ready" };
        update(d => ({ ...d, plan: p }));
      }
      update(d => ({ ...d, plan: { ...p, status: "complete" } })); await save();
    } catch (e) { if (e.message !== "SESSION_CLOSED") notify(e); update(d => ({ ...d, plan: d.plan?.id === planId ? { ...d.plan, status: "paused" } : d.plan })); }
    finally { submission.current = false; setBusy(false); }
  }
  function textLayer(text = t("双击创意，开始表达", "Make room for an idea"), placement) {
    const id = requestKey(); commitLayers([...draftRef.current.layers, { id, name: t("文字", "Text"), type: "text", x: 150, y: 180, width: 400, height: 80, rotation: 0, visible: true, opacity: 1, text, fontSize: 36, fill: "#fafaf8", ...placement }]); setSelected(id); setTool(null); setMode("select");
  }
  async function openProject(id) {
    try {
      const data = await api(`/api/studio/documents/${id}`);
      update({ ...blank(), id: data.id, version: data.version, name: data.name, ...data.content });
      history.current = { past: [], future: [] }; setHistoryCount({ past: 0, future: 0 }); setSelected(null); setTool(null); setProjects(null); setJobs([]);
      scheduleFit(150);
    } catch (e) { notify(e); }
  }
  async function replaceText(box) {
    if (!selected || submission.current) return;
    submission.current = true; setBusy(true);
    try {
      const source = selected, mask = await canvas.current.maskBlob(box.rect);
      const job = await submit("erase", source, "Remove only the text in the mask. Preserve the background.", { size: params.size }, mask);
      const result = await waitJob(job.id);
      if (result.status !== "succeeded") throw new Error(result.errorCode || "EDIT_FAILED");
      const target = draftRef.current.layers.find(l => l.id === `${job.id}-0`), factor = target.width / source.pixelWidth;
      textLayer(box.text, { x: target.x + box.rect.left * factor, y: target.y + box.rect.top * factor, width: Math.max(40, box.rect.width * factor), height: Math.max(24, box.rect.height * factor), fontSize: Math.max(8, box.rect.height * factor * 0.8) });
      setOcr(null);
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  const closeTool = () => {
    const restoreView = toolId === "expand";
    setTool(null); setMode("select"); setObjectSelection(null); canvas.current?.clearMask();
    if (restoreView) scheduleFit();
  };
  return <div className="ms-studio" data-history={historyCount.past}>
    <header className="ms-topbar">
      <Link href="/" className="ms-brand"><Aperture size={26} /><span>ModelShot<span className="ms-brand-mark"> / </span><small>CANVAS</small></span></Link>
      <span className="ms-top-divider" />
      <button className="ms-project-trigger" disabled={busy} onClick={async () => { try { setProjects(await api("/api/studio/documents")); } catch (e) { notify(e); } }}><FolderOpen size={17} /><span>{draft.name === "Untitled" ? t("未命名项目", "Untitled project") : draft.name}<small>{saveState === "saving" ? t("正在保存…", "Saving…") : saveState === "saved" ? t("已保存到云端", "Saved to cloud") : t("本地自动保存", "Saved on this device")}</small></span><ChevronDown size={14} /></button>
      <button className="ms-icon ms-new" title={t("新建项目", "New project")} disabled={busy} onClick={() => { update(blank()); setSelected(null); setJobs([]); history.current = { past: [], future: [] }; }}><Plus size={19} /></button>
      <div className="ms-top-actions">
        <button className="ms-button ms-save" data-action="save-studio" onClick={() => save().catch(notify)} disabled={busy}><Save size={15} />{t("保存", "Save")}</button>
        <button className="ms-button ms-export" onClick={() => canvas.current?.exportPNG().catch(notify)}><Download size={15} />{t("导出", "Export")}</button>
        <Link href="/account" className="ms-credit"><Zap size={15} />{usage?.credits ?? "—"}<span>{t("积分", "credits")}</span></Link>
        {session?.user ? <Link href="/account" className="ms-avatar" title={session.user.email}>{(session.user.name || session.user.email || "M").slice(0, 1).toUpperCase()}</Link> : <Link href="/login" className="ms-button ms-primary">{t("登录", "Sign in")}</Link>}
      </div>
    </header>
    <div className={`ms-body ${mobileChat ? "show-chat" : "show-canvas"}`}>
      <aside className="ms-chat">
        <div className="ms-chat-heading"><span><Sparkles size={16} />{t("创意，从一句话开始", "An idea starts a conversation")}</span><button className="ms-icon" title={t("查看画布", "Show canvas")} onClick={() => setMobileChat(false)}><PanelLeftClose size={17} /></button></div>
        <div className="ms-tabs" role="tablist">
          {[["chat", MessageCircle, t("对话规划", "Planned chat")], ["quick", Zap, t("快速生图", "Quick generation")]].map(([id, Icon, label]) => <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}<Link href="/commerce" className="ms-commerce-tab"><ShoppingBag size={15} />{t("电商套图", "Commerce")}</Link>
        </div>
        <div className="ms-conversation">
          {!draft.messages.length && <div className="ms-welcome">
            <div className="ms-orb"><Aperture size={31} strokeWidth={1.2} /></div><h1>{t("想象一下，然后实现它。", "Imagine it. Make it real.")}</h1>
            <p>{t("描述画面，上传灵感。和 AI 一起，让每个想法变成作品。", "Describe a scene. Bring a reference. Give your next idea a place to grow.")}</p>
            <div className="ms-suggestions">{[t("为我的商品设计一张自然光海报", "Create a natural-light product poster"), t("把这张图片变成电影感的画面", "Give this image a cinematic look"), t("帮我拆分主体和背景", "Separate the subject and background")].map((text, i) => <button key={text} onClick={() => { setPrompt(text); if (i === 2 && selected) chooseTool("split"); }}><span>{text}</span><ArrowUpRight size={15} /></button>)}</div>
            <span className="ms-model-note"><span className="ms-status-dot" />{t("每一步编辑，都保留原图", "Every edit keeps your original")}</span>
          </div>}
          {draft.messages.map(m => <div className={`ms-message ${m.role}`} key={m.id}>{m.role === "assistant" && <span className="ms-speaker"><Aperture size={17} />ModelShot</span>}<p>{m.text}</p>{m.assetId && <button className="ms-message-image" onClick={() => { const layer = draft.layers.find(l => l.assetId === m.assetId); if (layer) { setSelected(layer.id); setMobileChat(false); setTimeout(() => canvas.current?.fit(), 100); } }}><Image unoptimized width={480} height={480} src={imageUrl(m.assetId)} alt={t("对话引用的图片", "Image referenced in conversation")} /></button>}</div>)}
          {draft.plan && <div className="ms-plan"><span className="ms-eyebrow"><Sparkles size={13} />{t("创作计划", "CREATIVE PLAN")}</span><p>{draft.plan.summary}</p>{draft.plan.steps.map((step, i) => <div className="ms-plan-step" key={i}><span>{i < draft.plan.index ? <Check size={13} /> : i + 1}</span><div>{zh ? getTool(step.tool)?.zh : getTool(step.tool)?.en}<small>{step.explanation}</small></div></div>)}<button className="ms-button ms-primary" disabled={busy || draft.plan.status === "complete"} onClick={runPlan}>{draft.plan.status === "complete" ? t("已完成", "Complete") : draft.plan.index ? t("继续执行", "Continue") : t("确认并执行", "Run plan")}<span>{draft.plan.credits} {t("积分", "credits")}</span></button><button className="ms-text-button" disabled={busy} onClick={() => update(d => ({ ...d, plan: null }))}>{t("移除计划", "Dismiss plan")}</button></div>}
          {jobs.length > 0 && <div className="ms-job-list"><span className="ms-eyebrow">{t("任务记录", "RECENT TASKS")}</span>{jobs.slice(0, 8).map(job => <div className="ms-job" key={job.id}><span className={`ms-job-dot ${job.status}`} /><div>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en}<small>{job.status === "succeeded" ? t("已完成", "Complete") : job.status === "failed" ? `${t("失败", "Failed")} · ${job.errorCode}` : job.status === "cancelled" ? t("已取消", "Cancelled") : job.status === "reconciling" ? t("正在核对供应商结果…", "Checking provider result…") : t("正在处理…", "Processing…")}</small></div>{!TERMINAL.includes(job.status) && <button className="ms-icon" title={t("取消任务", "Cancel task")} onClick={() => api(`/api/studio/jobs/${job.id}`, { method: "DELETE" }).catch(notify)}><X size={13} /></button>}{job.resultData?.ocr && <button className="ms-text-button" onClick={() => { setSelected(job.targetId); setOcr(job.resultData.ocr); }}>{t("编辑文字", "Edit text")}</button>}</div>)}</div>}
        </div>
        <div className="ms-composer">
          {selected?.type === "image" && <div className="ms-reference"><Image unoptimized width={480} height={480} src={imageUrl(selected.assetId)} alt="" /><span>{t("正在引用", "Referencing")} · {selected.name}</span><button className="ms-icon" title={t("取消引用", "Clear reference")} onClick={() => setSelected(null)}><X size={13} /></button></div>}
          <textarea aria-label={t("创作描述", "Creative prompt")} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t("描述你想要的画面，或选择图片继续修改…", "Describe an image, or select one to keep editing…")} maxLength={4000} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          <div className="ms-composer-tools"><button className="ms-icon" title={t("添加参考图", "Add reference")} disabled={busy} onClick={() => fileInput.current.click()}><ImagePlus size={19} /></button><label className="ms-model-pill"><span className="ms-mini-orb" /><select aria-label={t("生图模型", "Image model")} value={modelProvider} onChange={e => setModelProvider(e.target.value)}>{(capabilities?.imageModels || []).map(item => <option key={item.id} value={item.id}>{item.label} · {item.creditCost} {t("积分", "credits")}</option>)}</select><ChevronDown size={11} /></label><select aria-label={t("图片比例", "Aspect ratio")} value={params.size} onChange={e => setParams(p => ({ ...p, size: e.target.value }))}><option value="1024x1024">1:1</option><option value="1024x1536">2:3</option><option value="1536x1024">3:2</option></select><button className="ms-send" disabled={busy || !prompt.trim()} onClick={send} title={tab === "quick" ? t(`生成 · ${quickCost} 积分`, `Generate · ${quickCost} credits`) : t("生成计划", "Create plan")}>{busy ? <LoaderCircle className="ms-spin" size={18} /> : <ArrowUp size={19} />}</button></div>
          <small className="ms-composer-hint">{tab === "quick" ? t(`直接按当前文字生成或编辑一张图，不调用规划模型 · ${quickCost} 积分`, `Generate or edit one image directly without the planning model · ${quickCost} credits`) : capabilities?.chatModel ? t(`由 ${capabilities.chatModel} 先拆解步骤，再由你确认执行`, `Plan steps with ${capabilities.chatModel}, then review before execution`) : t("对话规划模型尚未配置；请联系管理员或切换到快速生图", "Planning model is not configured; contact an admin or use Quick generation")}</small>
        </div>
      </aside>
      <main className="ms-canvas-space">
        <Canvas ref={canvas} layers={draft.layers} selectedId={selectedId} onSelect={id => { setSelected(id); if (id !== selectedId) closeTool(); }} onChange={commitLayers} mode={mode} brushSize={brush}
          editPadding={params.editPadding}
          moveOffset={{ dx: params.dx, dy: params.dy }} onMoveOffset={offset => setParams(p => ({ ...p, ...offset }))} onMovePreparing={() => { setObjectSelection(null); setMode("object-preparing"); }} onMoveReady={value => { setObjectSelection(value); setParams(p => ({ ...p, dx: 0, dy: 0 })); setMode(toolId === "inpaint" ? "object-edit" : "move"); }} onMoveFailed={() => { setObjectSelection(null); setMode("object-select-rect"); }}
          onCrop={rect => setParams(p => ({ ...p, rect }))} expandPadding={params.padding} onExpandPadding={padding => setParams(p => ({ ...p, padding }))}
          onZoom={setZoom} onUpload={upload} onError={notify} label={t("图片编辑画布", "Image editing canvas")} />
        <div className="ms-canvas-label"><span className="ms-status-dot" />{t("自由画布", "FREE CANVAS")}<span> / </span>{draft.layers.length} {t("个图层", "layers")}</div>
        {!draft.layers.length && <div className="ms-empty-canvas"><div className="ms-empty-art"><div className="ms-art-frame back"><Image unoptimized width={480} height={480} loading="eager" src="/studio/scene-05.webp" alt="" /></div><div className="ms-art-frame front"><Image unoptimized width={480} height={480} loading="eager" src="/studio/scene-03.webp" alt="" /><span><Sparkles size={12} />{t("灵感，正在发生", "A place for possibilities")}</span></div><span className="ms-art-cross one">+</span><span className="ms-art-cross two">+</span></div><h2>{t("你的下一幅作品，从这里开始", "A blank canvas. Endless possibilities.")}</h2><p>{t("拖入图片，或在左侧说出你的想法", "Drop an image here, or start with an idea on the left")}</p><button className="ms-button ms-primary" disabled={busy} onClick={() => fileInput.current.click()}><Plus size={17} />{t("上传第一张图片", "Upload your first image")}</button><small>PNG · JPG · WEBP · 10 MB</small></div>}
        <div className="ms-canvas-top-right"><button className={`ms-icon ${showLayers ? "active" : ""}`} title={t("图层", "Layers")} onClick={() => setShowLayers(!showLayers)}><Layers3 size={18} /></button></div>
        {selected?.type === "image" && !showLayers && !toolId && !ocr && <div className="ms-image-menu ms-context-toolbar">
          <div className="ms-menu-caption"><span>{selected.name}</span><span>{selected.pixelWidth} × {selected.pixelHeight}</span></div>
          <div className="ms-context-scroll">{TOOLS.filter(item => !["generate", "edit"].includes(item.id)).map(item => { const Icon = ICONS[item.id], capability = capabilities?.tools.find(row => row.id === item.id), unavailable = !capability?.available && item.id !== "crop"; return <button key={item.id} disabled={unavailable} title={`${zh ? item.zh : item.en} · ${unavailable ? t("尚未配置", "Not configured") : capability?.cost ?? item.cost}`} onClick={() => chooseTool(item.id)}><Icon size={16} /><span>{zh ? item.zh : item.en}</span>{unavailable ? <i className="ms-setup-dot" /> : <small>{capability?.cost ?? item.cost}</small>}</button>; })}
            <button title={t("添加到聊天", "Add to chat")} onClick={() => { setMobileChat(true); setPrompt(t("请帮我修改这张图片：", "Edit this image: ")); }}><MessageCircle size={16} /><span>{t("聊天", "Chat")}</span></button>
            <a title={t("下载原图", "Download image")} href={imageUrl(selected.assetId)} download={`${selected.name}.png`}><Download size={16} /><span>{t("下载", "Download")}</span></a>
          </div>
        </div>}
        {toolId && <div className={`ms-tool-panel ms-direct-dock ${["move", "inpaint"].includes(toolId) ? "ms-object-dock" : ""}`}><div className="ms-direct-title"><span>{zh ? tool.zh : tool.en}</span><button className="ms-icon" onClick={closeTool} title={t("关闭工具", "Close tool")}><X size={16} /></button></div>
          <div className="ms-direct-controls">
            {tool.mask && !["move", "inpaint"].includes(toolId) && <><span className="ms-direct-hint">{t("直接在图片上涂抹", "Paint directly on the image")}</span><label>{t("画笔", "Brush")}<input type="range" min="5" max="200" value={brush} onChange={e => setBrush(Number(e.target.value))} /><span>{brush}px</span></label><button className="ms-text-button" onClick={() => canvas.current.clearMask()}>{t("清除", "Clear")}</button></>}
            {["move", "inpaint"].includes(toolId) && <div className="ms-object-controls">
              <div className="ms-object-steps"><span className={!objectSelection ? "active" : "done"}>1 · {t("选择物体", "Select object")}</span><span className={objectSelection ? "active" : ""}>2 · {t("移动或修改", "Move or edit")}</span></div>
              {objectSelection ? <>
                <div className="ms-selected-object">
                  <Image unoptimized src={objectSelection.thumbnail} width={56} height={56} alt={t("已选中的物体", "Selected object")} />
                  <span><strong>{t("物体已选中", "Object selected")}</strong><small>{toolId === "move" ? t("拖动发光的物体，预览新位置", "Drag the detected object to preview its position") : t("描述这个物体要变成什么样", "Describe how this object should change")}</small></span>
                  <button className="ms-button ms-reselect" disabled={busy} onClick={() => { canvas.current.clearMovePreview(); setObjectSelection(null); setMode("object-select-rect"); setParams(p => ({ ...p, dx: 0, dy: 0 })); }}><MousePointer2 size={15} />{t("重新圈选", "Select again")}</button>
                </div>
                <div className="ms-object-actions" role="group" aria-label={t("物体操作", "Object action")}>
                  <button className={`ms-button ${toolId === "move" ? "active" : ""}`} disabled={busy || !capabilities?.tools.find(item => item.id === "move")?.available} onClick={() => { setTool("move"); setMode("move"); }}><Move size={16} />{t("移动物体", "Move object")}</button>
                  <button className={`ms-button ${toolId === "inpaint" ? "active" : ""}`} disabled={busy || !capabilities?.tools.find(item => item.id === "inpaint")?.available} onClick={() => { setTool("inpaint"); setMode("object-edit"); setParams(p => ({ ...p, dx: 0, dy: 0 })); }}><WandSparkles size={16} />{t("修改物体 / 动作", "Edit object / pose")}</button>
                </div>
                {toolId === "move" ? <div className="ms-object-tip"><span>{t("确认后补全原位置的背景", "Apply to reconstruct the original background")}</span><div className="ms-move-offset"><span>ΔX {params.dx}px</span><span>ΔY {params.dy}px</span></div></div> : <>
                  <textarea className="ms-object-prompt" aria-label={t("物体修改描述", "Object edit instruction")} placeholder={t("例如：让猫抬起前爪；把这把椅子换成香蕉造型，保留坐着的人", "For example: raise the cat’s front paw; replace this chair with a banana-shaped chair, keeping the person seated")} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} disabled={busy} />
                  <label className="ms-edit-room">{t("动作空间", "Room for new pose")}<input aria-label={t("动作空间", "Room for new pose")} type="range" min="0.05" max="0.5" step="0.05" value={params.editPadding} disabled={busy} onChange={e => setParams(p => ({ ...p, editPadding: Number(e.target.value) }))} /><span>{Math.round(params.editPadding * 100)}%</span></label>
                  <span className="ms-object-tip">{t("白色虚线内可生成新动作；框外保持原图", "New poses can extend within the white boundary; outside it stays unchanged")}</span>
                </>}
              </> : <>
                <span className="ms-direct-hint" role="status" aria-live="polite">{mode === "object-preparing" ? <><LoaderCircle size={16} className="ms-spin" />{t("正在提取所选物体…", "Extracting your selected object…")}</> : t("在图片上框住或圈出一个物体，松手后贴合边缘", "Draw a box or lasso around one object; release to refine its edges")}</span>
                <div className="ms-segment-modes">{[["rect", Crop, t("框选", "Rectangle")], ["lasso", Scissors, t("套索", "Lasso")]].map(([shape, Icon, title]) => <button key={shape} className={`ms-button ${mode === `object-select-${shape}` ? "active" : ""}`} onClick={() => { canvas.current.clearMovePreview(); setObjectSelection(null); setMode(`object-select-${shape}`); }}><Icon size={15} />{title}</button>)}</div>
                {mode === "object-preparing" && <button className="ms-button ms-reselect" onClick={() => { canvas.current.clearMovePreview(); setMode("object-select-rect"); }}>{t("取消识别，重新选择", "Cancel and select again")}</button>}
              </>}
            </div>}
            {toolId === "crop" && <span className="ms-direct-hint">{t(`拖动裁剪框和角点 · ${params.rect?.width || selected.pixelWidth} × ${params.rect?.height || selected.pixelHeight}`, `Drag the crop box and handles · ${params.rect?.width || selected.pixelWidth} × ${params.rect?.height || selected.pixelHeight}`)}</span>}
            {toolId === "expand" && <><span className="ms-direct-hint">{t("拖动图片外侧边界扩展画布", "Drag the outer handles to expand the canvas")}</span><div className="ms-edge-readout">{Object.entries(typeof params.padding === "number" ? { left: params.padding, right: params.padding, top: params.padding, bottom: params.padding } : params.padding).map(([key, value]) => <span key={key}>{key[0].toUpperCase()} {value}</span>)}</div><button className="ms-text-button" onClick={() => setParams(p => ({ ...p, padding: { left: 256, right: 256, top: 256, bottom: 256 } }))}>{t("重置边界", "Reset edges")}</button></>}
            {toolId === "upscale" && <label>{t("放大", "Scale")}<select value={params.scale} onChange={e => setParams(p => ({ ...p, scale: Number(e.target.value) }))}><option value="2">2×</option><option value="4">4×</option></select></label>}
            {toolId === "video" && <label>{t("时长", "Duration")}<select value={params.duration} onChange={e => setParams(p => ({ ...p, duration: Number(e.target.value) }))}><option value="5">5s</option><option value="10">10s</option></select></label>}
            {["erase", "expand", "video"].includes(toolId) && <input className="ms-direct-prompt" aria-label={t("工具提示词", "Tool prompt")} placeholder={toolId === "inpaint" || toolId === "video" ? t("描述希望生成的效果…", "Describe the result…") : t("可选补充说明…", "Optional instruction…")} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} />}
            {toolId === "split" && <span className="ms-direct-hint">{t("完成后前景和修复背景会成为两个可编辑图层", "The foreground and repaired background become editable layers")}</span>}
            {!toolStatus?.available && toolId !== "crop" && <span className="ms-unavailable">{toolStatus?.reason === "TOOL_DISABLED" ? t("管理员已停用", "Disabled by admin") : t("尚未配置服务", "Service not configured")}</span>}
          </div>
          {(!["move", "inpaint"].includes(toolId) || objectSelection) && <button className="ms-button ms-primary ms-direct-apply" disabled={busy || (toolId === "move" && !params.dx && !params.dy) || (!toolStatus?.available && toolId !== "crop") || ["inpaint", "video"].includes(toolId) && !prompt.trim()} onClick={runTool}>{busy ? <LoaderCircle size={16} className="ms-spin" /> : <Sparkles size={15} />}{toolId === "move" ? t("确认移动", "Apply move") : toolId === "inpaint" ? t("生成修改", "Apply edit") : t("生成", "Apply")}<span>{toolCost ? `${toolCost} ${t("积分", "credits")}` : t("免费", "Free")}</span></button>}
        </div>}
        {selected?.type === "text" && <div className="ms-tool-panel"><div className="ms-panel-title">{t("文字编辑", "Edit text")}<Type size={16} /></div><textarea aria-label={t("图层文字", "Layer text")} value={selected.text} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, text: e.target.value } : l))} /><label>{t("字号", "Font size")}<input type="number" min="8" max="512" value={selected.fontSize} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, fontSize: Number(e.target.value) || 8 } : l))} /></label><label>{t("颜色", "Color")}<input type="color" value={selected.fill} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, fill: e.target.value } : l))} /></label></div>}
        {selected?.type === "video" && <div className="ms-tool-panel"><div className="ms-panel-title">{t("视频作品", "Video result")}</div><button className="ms-button ms-primary" onClick={() => setPreview(selected.assetId)}><Play size={15} />{t("播放视频", "Play video")}</button><a className="ms-button" href={imageUrl(selected.assetId)} download="modelshot-video.mp4"><Download size={15} />{t("下载 MP4", "Download MP4")}</a></div>}
        {ocr && <div className="ms-tool-panel"><div className="ms-panel-title">{t("图片中的文字", "Image text")}<button className="ms-icon" onClick={() => setOcr(null)} title={t("关闭", "Close")}><X size={15} /></button></div><p>{t("修改文字后，移除原文字并创建可编辑文字层。18 积分/区域。", "Replace original text with an editable layer. 18 credits per region.")}</p>{(ocr.boxes || []).map((box, index) => <div className="ms-ocr-row" key={index}><input value={box.text} onChange={e => setOcr(data => ({ ...data, boxes: data.boxes.map((b, i) => i === index ? { ...b, text: e.target.value } : b) }))} /><button className="ms-icon" disabled={busy || !capabilities?.tools.find(c => c.id === "erase")?.available} onClick={() => replaceText(box)} title={t("替换此文字", "Replace text")}><Check size={16} /></button></div>)}</div>}
        {showLayers && <div className="ms-layers"><div className="ms-panel-title">{t("图层", "Layers")}<span>{draft.layers.length}</span></div>{draft.layers.toReversed().map(layer => <div className={`ms-layer ${selectedId === layer.id ? "selected" : ""}`} key={layer.id}><button className="ms-layer-select" onClick={() => { setSelected(layer.id); closeTool(); }}>{layer.type === "image" ? <Image unoptimized width={480} height={480} src={imageUrl(layer.assetId)} alt="" /> : layer.type === "text" ? <Type size={18} /> : <Video size={18} />}<span>{layer.name}</span></button><button className="ms-icon" title={t("显示/隐藏", "Show/hide")} onClick={() => commitLayers(draft.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l))}>{layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button></div>)}{selected && <div className="ms-layer-actions"><button className="ms-icon" title={t("上移一层", "Raise layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i < list.length - 1) { [list[i], list[i + 1]] = [list[i + 1], list[i]]; commitLayers(list); } }}><ArrowUp size={15} /></button><button className="ms-icon" title={t("下移一层", "Lower layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i > 0) { [list[i], list[i - 1]] = [list[i - 1], list[i]]; commitLayers(list); } }}><ArrowDown size={15} /></button><button className="ms-icon" title={t("复制图层", "Duplicate layer")} onClick={() => commitLayers([...draft.layers, { ...selected, id: requestKey(), x: selected.x + 24, y: selected.y + 24 }])}><Copy size={15} /></button><button className="ms-icon" title={t("删除图层", "Delete layer")} onClick={() => { commitLayers(draft.layers.filter(l => l.id !== selectedId)); setSelected(null); }}><Trash2 size={15} /></button></div>}</div>}
        <div className="ms-bottom-toolbar">{[["select", MousePointer2, t("选择", "Select")], ["hand", Hand, t("平移", "Pan")]].map(([id, Icon, title]) => <button key={id} className={`ms-icon ${mode === id ? "active" : ""}`} title={title} onClick={() => { closeTool(); setMode(id); }}><Icon size={20} /></button>)}<span /><button className="ms-icon" title={t("上传图片", "Upload image")} disabled={busy} onClick={() => fileInput.current.click()}><ImagePlus size={20} /></button><button className="ms-icon" title={t("添加文字", "Add text")} onClick={() => textLayer()}><Type size={20} /></button><span /><button className="ms-icon" title={t("撤销", "Undo")} disabled={!historyCount.past} onClick={() => undo()}><Undo2 size={19} /></button><button className="ms-icon" title={t("重做", "Redo")} disabled={!historyCount.future} onClick={() => undo(true)}><Redo2 size={19} /></button></div>
        <div className="ms-zoom"><button className="ms-icon" title={t("缩小", "Zoom out")} onClick={() => canvas.current.zoom(0.8)}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="ms-icon" title={t("放大", "Zoom in")} onClick={() => canvas.current.zoom(1.25)}><Plus size={16} /></button><button className="ms-icon" title={t("适应画布", "Fit canvas")} onClick={() => canvas.current.fit()}><Maximize size={16} /></button></div>
      </main>
    </div>
    <button className="ms-mobile-toggle" onClick={() => setMobileChat(!mobileChat)}>{mobileChat ? <Layers3 size={17} /> : <PanelLeftOpen size={17} />}{mobileChat ? t("画布", "Canvas") : t("对话", "Chat")}</button>
    <input className="ms-file-input" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label={t("上传图片文件", "Upload image files")} onChange={e => upload(e.target.files)} />
    {notice && <div className="ms-notice" role="alert"><span>{notice}</span><button className="ms-icon" title={t("关闭提示", "Dismiss")} onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {projects && <div className="ms-modal-backdrop"><section className="ms-project-modal" role="dialog" aria-modal="true" aria-label={t("项目管理", "Projects")}><div className="ms-panel-title">{t("我的项目", "Your projects")}<button className="ms-icon" title={t("关闭", "Close")} onClick={() => setProjects(null)}><X size={18} /></button></div><label>{t("当前项目名称", "Current project name")}<input value={draft.name} maxLength={100} onChange={e => update(d => ({ ...d, name: e.target.value }))} /></label><div className="ms-project-buttons"><button className="ms-button ms-primary" onClick={() => save().then(() => setProjects(null)).catch(notify)}><Save size={15} />{t("保存项目", "Save project")}</button><button className="ms-button" onClick={() => save(true).then(() => setProjects(null)).catch(notify)}>{t("另存为", "Save as new")}</button></div><div className="ms-project-list">{projects.length ? projects.map(p => <button key={p.id} onClick={() => openProject(p.id)}><FolderOpen size={20} /><span>{p.name}<small>{new Date(p.updatedAt).toLocaleString(locale)}</small></span><ArrowUpRight size={15} /></button>) : <p>{t("还没有云端项目。保存你的第一个作品。", "No cloud projects yet. Save your first creation.")}</p>}</div></section></div>}
    {preview && <div className="ms-modal-backdrop"><section className="ms-video-modal"><button className="ms-icon" title={t("关闭视频", "Close video")} onClick={() => setPreview(null)}><X size={20} /></button><video src={imageUrl(preview)} controls autoPlay playsInline /></section></div>}
  </div>;
}
