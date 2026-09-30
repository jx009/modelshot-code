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
import { imageUrl, previewUrl } from "@/lib/studio/image-url";
import { loadImage } from "@/lib/studio/image-processor";
import { maskHash as hashMask } from "@/lib/studio/mask-hash";
import { promptTitle } from "@/lib/studio/project-title";
import { useStudioProject } from "./useStudioProject";
import StudioTaskPopover from "./StudioTaskPopover";
import StudioMessageHistory from "./StudioMessageHistory";
import { useStudioView } from "./useStudioView";
import RecentProjects from "./RecentProjects";
import StudioExportDialog from "./StudioExportDialog";
import ToolPanel from "./ToolPanel";
import PromptOptimizer from "./PromptOptimizer";
import AssetLibrary from "./AssetLibrary";
import UserMenu from "@/components/UserMenu";
import Modal from "@/components/ui/Modal";
import "./studio.css";

const Canvas = dynamic(() => import("./StudioCanvas"), { ssr: false, loading: () => <div className="ms-loading"><LoaderCircle className="ms-spin" size={22} /></div> });
const ICONS = { generate: Sparkles, edit: WandSparkles, expand: Expand, upscale: ZoomIn, describe: WandSparkles, erase: Eraser, inpaint: Scissors, split: Layers3, move: Move, ocr: ScanText, "remove-bg": Scissors, crop: Crop, video: Video };
const TERMINAL = ["succeeded", "failed", "cancelled"];
const delay = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("SESSION_CLOSED")); }, { once: true }); });

export default function StudioWorkbench({ initialDocument = "", initialPrompt = "", initialMode = "chat", initialProvider = "" }) {
  const locale = useLocale(), zh = locale === "zh", { data: session, status } = useSession();
  const t = useCallback((cn, en) => zh ? cn : en, [zh]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null);
  const notify = useCallback(error => {
    const code = typeof error === "string" ? error : error?.code || error?.message || "UNKNOWN_ERROR";
    if (code === "SESSION_CLOSED") return;
    const descriptions = {
      LOCAL_SAVE_FAILED: t("本地保存失败，请保持页面打开并重试云端保存。", "Local save failed. Keep this page open and retry saving to the cloud."),
      DOCUMENT_VERSION_CONFLICT: t("云端版本已更新。本地修改仍在，请另存为新项目或打开云端版本。", "Cloud version changed. Save as a new project or open the cloud version."),
      INSUFFICIENT_CREDITS: t("可用积分不足，请补充积分后重试。", "Not enough available credits."),
      UNAUTHORIZED: t("请先登录，素材和作品会保存到你的账户。", "Sign in to save assets and projects."),
      SERVICE_NOT_CONFIGURED: t("这个工具还没有连接模型服务，请在部署配置中启用。", "This tool needs a configured provider."),
      SEGMENTATION_NOT_CONFIGURED: t("请先启用物体分割服务，再选择需要移动或修改的物体。", "Object editing requires the segmentation service."),
      SEGMENTATION_FAILED: t("没有识别出物体，请用框选或套索贴近目标重新选择。", "No object was detected. Draw a tighter selection and try again."),
      NO_SEPARABLE_OBJECTS: t("这张图片没有识别出可拆分的独立区域，请换一张主体更清晰的图片。", "No separate regions were detected. Try an image with clearer subjects."),
      TOOL_SERVICE_UNAVAILABLE: t("图像工具服务暂时不可用，请稍后重试。", "The image tool service is temporarily unavailable."),
      SEGMENTATION_TIMEOUT: t("物体识别超时，原图已保留，请重新选择。", "Object detection timed out. Your original is safe; select again."),
      SEGMENTATION_UNAVAILABLE: t("云端分割服务连接失败，请稍后重试或检查该工具的模型配置。", "Could not reach the segmentation provider. Retry or check the tool configuration."),
      SEGMENTATION_CREDENTIALS: t("分割服务鉴权失败，请管理员检查对应模型的密钥和权限。", "Segmentation authentication failed. Ask an admin to check its credentials and permissions."),
      SEGMENTATION_RATE_LIMITED: t("分割服务请求过于频繁，请稍后重试。", "The segmentation provider is rate limited. Please retry shortly."),
      SEGMENTATION_REJECTED: t("分割服务未接受这次请求，请检查模型配置或更换图片。", "The segmentation provider rejected the request. Check its configuration or try another image."),
      REQUEST_FAILED: t("请求失败，服务暂时没有返回结果，请稍后重试。", "The request failed without a result. Please try again shortly."),
      IMAGE_LOAD_TIMEOUT: t("图片加载超时，原图已保留。可在任务记录中重新加载，无需再次生成。", "Image loading timed out. Retry loading from the task; no new generation is needed."),
      IMAGE_LOAD_FAILED: t("图片加载失败，原图已保留。请重试加载。", "Image loading failed. Your original is safe; retry loading."),
      EDIT_GEOMETRY_MISMATCH: t("模型返回的画面比例不符合编辑要求，已保留原图。", "The provider returned an incompatible aspect ratio. Your original was preserved."),
      TOOL_DISABLED: t("管理员已停用这个工具。", "This tool has been disabled by an administrator."),
      TARGET_CHANGED: t("目标图片已变化，请重新选择图片。", "The target changed. Select the image again."),
      VISION_NOT_CONFIGURED: t("管理员尚未配置对话规划模型。请在后台“模型配置 → 后台大语言模型”配置；也可使用“快速生图”直接生成一张图。", "No planning model is configured. Configure one in Admin → Models → Backend language model, or use Quick generation for a direct single-image request."),
    };
    const detail = code === "REQUEST_FAILED" && error?.url
      ? `（${error.method || "GET"} ${error.url}${error.detail ? `：${error.detail}` : ""}）`
      : "";
    setNotice((descriptions[code] || code) + detail);
  }, [t]);
  const { draft, draftRef, update, save, saveState, ready, open: loadProject, create: createProject, flushLocal, reloadCloud } = useStudioProject({ userId: session?.user?.id, initialDocument, initialPrompt, paused: busy, onError: error => notify(error) });
  const [selectedId, setSelected] = useState(null), [tab, setTab] = useState(initialMode === "quick" ? "quick" : "chat"), [mode, setMode] = useState("select");
  const [toolId, setTool] = useState(null), [params, setParams] = useState({ size: "1024x1024", scale: 2, padding: 256, dx: 100, dy: 0, duration: 5, editPadding: 0.25, numLayers: 4 });
  const [hasMask, setHasMask] = useState(false);
  const [brush, setBrush] = useState(8), [zoom, setZoom] = useState(1), [capabilities, setCapabilities] = useState(null), [usage, setUsage] = useState(null);
  const [modelProvider, setModelProvider] = useState(initialProvider);
  const prompt = draft.composer?.text ?? "";
  const fixedPrompt = draft.composer?.fixedPrompt || "", outputCount = draft.composer?.outputCount || 1;
  const setComposer = value => update(d => ({ ...d, composer: { ...d.composer, ...value } }));
  const setPrompt = value => update(d => ({ ...d, composer: { ...d.composer, text: typeof value === "function" ? value(d.composer?.text || "") : value } }));
  const [referencePicker, setReferencePicker] = useState(false), [fixedOpen, setFixedOpen] = useState(false);
  const [objectSelection, setObjectSelection] = useState(null);
  const [panning, setPanning] = useState(false), [spaceHeld, setSpaceHeld] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false), [viewport, setViewport] = useState(null);
  const menuTop = viewport ? Math.max(52, Math.min(viewport.viewportHeight - 620, viewport.top)) : 52;
  const [imagePreview, setImagePreview] = useState(null), [previewZoom, setPreviewZoom] = useState(1);
  const moveUnchanged = objectSelection?.region ? JSON.stringify(params.moveSource) === JSON.stringify(params.moveTarget) : !params.dx && !params.dy;
  const [resultStates, setResultStates] = useState({}), [planRunning, setPlanRunning] = useState(false);
  const [projectLoad, setProjectLoad] = useState(0);
  const [pendingTask, setPendingTask] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const resultLoads = useRef(new Map()), planExecution = useRef(false);
  const [projects, setProjects] = useState(null), [jobs, setJobs] = useState([]), [showLayers, setShowLayers] = useState(false), [mobileChat, setMobileChat] = useState(true);
  const [preview, setPreview] = useState(null), [ocr, setOcr] = useState(null);
  const [historyCount, setHistoryCount] = useState({ past: 0, future: 0 });
  const history = useRef({ past: [], future: [] }), canvas = useRef(null), fileInput = useRef(null), fitTimer = useRef(null);
  const life = useRef(null), submission = useRef(false);
  const interaction = useRef({});
  useEffect(() => { interaction.current = { editing: Boolean(toolId) || busy, navigating: panning || spaceHeld }; }, [toolId, panning, spaceHeld, busy]);
  const onCamera = useStudioView({ documentId: draft.id, draftKey: draft.createKey, userId: session?.user?.id, ready, canvas });
  const selected = draft.layers.find(l => l.id === selectedId && l.visible);
  const references = (draft.composer?.referenceIds?.length ? draft.composer.referenceIds.map(id => draft.layers.find(layer => layer.id === id)).filter(Boolean) : selected?.type === "image" ? [selected] : []);
  const tool = getTool(toolId), toolStatus = capabilities?.tools.find(row => row.id === toolId);
  const activeModel = capabilities?.imageModels?.find(model => model.id === modelProvider);
  const referenceLimit = activeModel?.maxReferenceImages ?? 3;
  const quickCost = activeModel?.creditCost ?? capabilities?.tools.find(row => row.id === (selected?.type === "image" ? "edit" : "generate"))?.cost ?? 18;
  const toolCost = toolStatus?.cost ?? tool?.cost ?? 0;
  const commitLayers = useCallback(layers => {
    history.current.past = [...history.current.past, draftRef.current.layers].slice(-40); history.current.future = [];
    update(d => ({ ...d, layers })); setHistoryCount({ past: history.current.past.length, future: 0 });
  }, [update, draftRef]);
  function undo(redo = false) {
    const from = redo ? history.current.future : history.current.past;
    if (!from.length) return;
    const to = redo ? history.current.past : history.current.future;
    to.push(draftRef.current.layers); update(d => ({ ...d, layers: from.pop() })); setHistoryCount({ past: history.current.past.length, future: history.current.future.length });
  }
  function message(role, text, assetId, id = requestKey()) {
    update(d => d.messages.some(m => m.id === id) ? d : ({ ...d, messages: [...d.messages, { id, role, text, ...(assetId ? { assetId } : {}) }] }));
  }
  function nameFromFirstPrompt(text) {
    if (text.trim() && ["fallback", "upload"].includes(draftRef.current.nameSource)) {
      update(d => ({ ...d, name: promptTitle(text), nameSource: "prompt" }));
    }
  }
  function scheduleFit(delay = 0) {
    clearTimeout(fitTimer.current);
    fitTimer.current = setTimeout(() => canvas.current?.fit(), delay);
  }
  useEffect(() => {
    const abort = new AbortController(); life.current = abort;
    if (status === "authenticated") {
      Promise.all([api("/api/studio/capabilities", { signal: abort.signal }), api("/api/usage", { signal: abort.signal })]).then(([caps, value]) => { setCapabilities(caps); setModelProvider(current => current || caps.imageProvider || caps.imageModels?.[0]?.id || ""); setUsage(value); }).catch(e => { if (!abort.signal.aborted) notify(e); });
    }
    return () => { abort.abort(); clearTimeout(fitTimer.current); };
  }, [status, notify]);
  useEffect(() => {
    if (status !== "authenticated" || !modelProvider) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ ...(modelProvider ? { imageProvider: modelProvider } : {}) });
    api(`/api/studio/capabilities?${query}`, { signal: abort.signal }).then(setCapabilities).catch(e => { if (!abort.signal.aborted) notify(e); });
    return () => abort.abort();
  }, [modelProvider, status, notify]);
  useEffect(() => {
    const handler = e => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable) return;
      if (e.code === "Space") { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === "Escape") { setImagePreview(null); setProjects(null); }
      if (e.ctrlKey || e.metaKey) {
        const action = e.key.toLowerCase() === "s" ? "save-studio" : e.key.toLowerCase() === "z" ? e.shiftKey ? "redo" : "undo" : null;
        if (action) { e.preventDefault(); document.querySelector(`[data-action="${action}"]`)?.click(); }
      }
    };
    const release = e => { if (!e.code || e.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", handler); window.addEventListener("keyup", release); window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", handler); window.removeEventListener("keyup", release); window.removeEventListener("blur", release); };
  }, []);

  const collectResult = useCallback(job => {
    if (job.status !== "succeeded" || job.documentId !== draftRef.current.id || draftRef.current.appliedJobs?.includes(job.id)) return Promise.resolve();
    if (resultLoads.current.has(job.id)) return resultLoads.current.get(job.id);
    const task = (async () => {
    setResultStates(s => ({ ...s, [job.id]: "loading" }));
    // Load the exact same cached preview that the canvas will draw before
    // replacing anything. A failed download must never hide the original.
    await Promise.all((job.resultData?.assets || []).filter(asset => asset.contentType.startsWith("image/")).map(asset => loadImage(previewUrl(asset.id), { signal: life.current?.signal })));
    const current = draftRef.current;
    if (job.documentId !== current.id || life.current?.signal.aborted || current.appliedJobs?.includes(job.id)) { resultLoads.current.delete(job.id); return; }
    const layers = appendResult(current.layers, job, current.layers.find(l => l.id === job.targetId));
    const messages = [...current.messages];
    if (!messages.some(m => m.id === job.id)) messages.push({ id: job.id, role: "assistant", text: job.resultData?.text || `${zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · ${t("已完成", "Complete")}`, ...(job.resultData?.assets?.[0]?.contentType?.startsWith("image/") ? { assetId: job.resultData.assets[0].id } : {}) });
    if (job.resultData?.placement === "repair-background") {
      history.current.past = history.current.past.map(snapshot => appendResult(snapshot, job));
      history.current.future = history.current.future.map(snapshot => appendResult(snapshot, job));
    } else if (layers !== current.layers && (layers.length !== current.layers.length || layers.some((layer, index) => layer !== current.layers[index]))) {
      history.current.past = [...history.current.past, current.layers].slice(-40); history.current.future = [];
      setHistoryCount({ past: history.current.past.length, future: 0 });
    }
    update({ ...current, layers, messages, appliedJobs: [...(current.appliedJobs || []), job.id] });
    setResultStates(s => ({ ...s, [job.id]: "ready" }));
    const result = layers.find(layer => layer.sourceJobId === job.id && layer.visible);
    if (result && !draftRef.current.pendingBatch && !interaction.current.editing && !interaction.current.navigating) {
      setSelected(result.id); setPanning(false); setTool(null); setMode("select"); setObjectSelection(null); canvas.current?.clearMask(); setMobileChat(false);
      clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => canvas.current?.fit(), 100);
    }
    })().catch(error => {
      if (job.documentId === draftRef.current.id && error.name !== "AbortError") { setResultStates(s => ({ ...s, [job.id]: "failed" })); notify(error); }
      throw error;
    });
    resultLoads.current.set(job.id, task);
    // Keep failed loads until an explicit retry, but do not cache an applied
    // result forever: reopening an older saved project must recover its jobs.
    task.then(() => { if (resultLoads.current.get(job.id) === task) resultLoads.current.delete(job.id); }, () => {});
    return task;
  }, [update, draftRef, zh, t, notify]);
  useEffect(() => {
    if (!draft.id || status !== "authenticated") return;
    const abort = new AbortController();
    let timer;
    let signature = "";
    async function poll() {
      try {
        const rows = await api(`/api/studio/jobs?documentId=${encodeURIComponent(draft.id)}&recover=1`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setJobs(rows); rows.toReversed().forEach(job => { collectResult(job).catch(() => {}); });
        const nextSignature = rows.map(row => `${row.id}:${row.status}`).join("|");
        if (signature !== nextSignature) {
          signature = nextSignature;
          const value = await api("/api/usage", { signal: abort.signal });
          if (!abort.signal.aborted) setUsage(value);
        }
        // Once every job is terminal there is nothing useful to poll. The
        // submit path changes draft.jobs, which restarts this effect for a new job.
        if (!rows.some(row => !TERMINAL.includes(row.status))) return;
      } catch (e) {
        // Job recovery is a background poll. A transient 502/timeout should
        // not cover the canvas with repeated generic REQUEST_FAILED toasts.
        if (abort.signal.aborted) return;
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 4000);
    }
    poll(); return () => { abort.abort(); clearTimeout(timer); };
  }, [draft.id, draft.version, draft.jobs?.length, projectLoad, status, collectResult, notify]);

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
        if (draftRef.current.nameSource === "fallback") update(d => ({ ...d, name: promptTitle(file.name.replace(/\.[^.]+$/, "")), nameSource: "upload" }));
        const current = draftRef.current.layers, id = requestKey();
        commitLayers([...current, { id, assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x: current.length ? Math.max(...current.map(l => l.x + l.width)) + 48 : 90, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, opacity: 1, visible: true }]);
        setSelected(id);
      }
      setMobileChat(false); scheduleFit(150);
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function importLibrary(items) {
    const scope = draftRef.current.createKey;
    const originals = await Promise.all(items.map(item => loadImage(previewUrl(item.assetId))));
    if (scope !== draftRef.current.createKey) return;
    const layers = [...draftRef.current.layers];
    items.forEach((item, index) => {
      const width = item.asset.width || originals[index].width, height = item.asset.height || originals[index].height;
      const size = scaleToFit(width, height, 480);
      layers.push({ id: requestKey(), assetId: item.assetId, type: "image", name: item.name, x: Math.max(40, ...layers.map(layer => layer.x + layer.width)) + 48, y: 100, ...size, pixelWidth: width, pixelHeight: height, rotation: 0, opacity: 1, visible: true });
    });
    commitLayers(layers);
    if (libraryOpen === "reference") {
      setComposer({ referenceIds: [...references.map(layer => layer.id), ...layers.slice(-items.length).map(layer => layer.id)].slice(0, 3), text: prompt.replace(/[*@]$/, "") });
      setMobileChat(true);
    } else { setSelected(layers.at(-1)?.id); setMobileChat(false); scheduleFit(150); }
    setLibraryOpen(false);
  }
  function chooseTool(id) {
    clearTimeout(fitTimer.current);
    setPanning(false); setTool(id); canvas.current?.clearMask(); setObjectSelection(null);
    setMode(id === "move" ? "object-select-rect" : id === "expand" ? "expand" : getTool(id)?.mask ? "mask" : id === "crop" ? "crop" : "select");
    if (id === "crop" && selected) setParams(p => ({ ...p, rect: { left: 0, top: 0, width: selected.pixelWidth, height: selected.pixelHeight } }));
    if (id === "move") { setParams(p => ({ ...p, dx: 0, dy: 0, moveSource: undefined, moveTarget: undefined })); canvas.current?.focusSelection(); }
    if (["inpaint", "erase"].includes(id)) canvas.current?.focusSelection();
    if (id === "expand") {
      setParams(p => ({ ...p, padding: typeof p.padding === "number" ? { left: p.padding, right: p.padding, top: p.padding, bottom: p.padding } : p.padding }));
    }
    setOcr(null);
  }
  async function submit(id, target, text, options = {}, maskBlob, key = requestKey(), extracted, referenceAssetIds = []) {
    const projectKey = draftRef.current.createKey;
    const assertCurrent = () => { if (draftRef.current.createKey !== projectKey) throw new Error("SESSION_CLOSED"); };
    const temporary = { id: `submit-${key}`, tool: id, assetId: target?.assetId, status: "submitting", createdAt: new Date().toISOString() };
    setPendingTask(temporary);
    try {
    const saved = await save();
    assertCurrent();
    const maskHash = maskBlob ? await hashMask(maskBlob) : null;
    const provider = modelProvider;
    const signature = JSON.stringify({ id, provider, extracted, referenceAssetIds, target: target?.id, asset: target?.assetId, text, options, maskHash, documentId: saved.id });
    const pending = draftRef.current.pendingSubmit;
    let body;
    let maskId = extracted?.maskId;
    if (pending?.signature === signature) { body = { ...pending.body, documentVersion: saved.version }; key = pending.key; }
    else {
      if (maskBlob && !maskId) maskId = (await uploadFile(new File([maskBlob], "mask.png", { type: "image/png" }))).assetId;
      assertCurrent();
      body = { tool: id, ...(referenceAssetIds.length ? { referenceAssetIds } : {}), ...(provider ? { provider } : {}), ...(id === "move" && extracted?.objectAssetId ? { moveBundle: { objectAssetId: extracted.objectAssetId, holeAssetId: extracted.holeAssetId, bounds: extracted.bounds } } : {}), documentId: saved.id, documentVersion: saved.version, ...(target ? { targetId: target.id, assetId: target.assetId } : {}), ...(maskId ? { maskId } : {}), params: { ...options, prompt: text } };
      update(d => ({ ...d, pendingSubmit: { signature, key, body } }));
      await flushLocal();
    }
    const job = await api("/api/studio/jobs", { method: "POST", key, body });
    assertCurrent();
    update(d => ({ ...d, pendingSubmit: null, jobs: [...new Set([...d.jobs, job.id])].slice(-100) }));
    setJobs(current => [job, ...current.filter(j => j.id !== job.id)]); setPendingTask(null); return job;
    } catch (error) { if (draftRef.current.createKey === projectKey) setPendingTask({ ...temporary, status: "failed", errorCode: error.code || error.message }); throw error; }
  }
  async function runTool() {
    if (submission.current || (toolId === "move" && !objectSelection)) return;
    if (toolId === "move" && moveUnchanged) return;
    submission.current = true; setBusy(true);
    try {
      const mask = tool?.mask && !objectSelection?.region && !objectSelection?.maskId ? await canvas.current.maskBlob() : null;
      const target = selected;
      nameFromFirstPrompt(prompt);
      await submit(toolId, target, prompt, { ...params, selectionMode: objectSelection?.region ? "region" : objectSelection ? "object" : "mask" }, mask, requestKey(), objectSelection);
      message("user", prompt || (zh ? tool.zh : tool.en), target?.assetId);
      setPanning(false); setTool(null); setMode("select"); setPrompt(""); setObjectSelection(null); canvas.current?.clearMask();
      await save();
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  async function send(planned = false) {
    if (!ready || submission.current || !prompt.trim()) return;
    const text = [fixedPrompt, prompt].filter(Boolean).join("\n"), target = references[0] || null, extraReferences = references.slice(1).map(layer => layer.assetId);
    submission.current = true; setBusy(true);
    try {
      if (text.length > 4000) throw new Error(t("固定提示词与描述合计不能超过 4000 字。", "The fixed prompt and description must total at most 4,000 characters."));
      if (references.length > referenceLimit) throw new Error(t(`当前模型最多支持 ${referenceLimit} 张参考图，请更换模型或移除部分引用。`, `This model supports ${referenceLimit} reference images. Change model or remove references.`));
      if (planned && extraReferences.length) throw new Error(t("多步骤规划目前支持一张参考图；多张参考图可直接生成。", "Multi-step planning supports one reference. Use direct generation for multiple references."));
      nameFromFirstPrompt(prompt);
      const signature = JSON.stringify({ text, target: target?.id, extraReferences, modelProvider, tab, planned, outputCount });
      const messageId = draftRef.current.pendingMessage?.signature === signature ? draftRef.current.pendingMessage.id : requestKey();
      update(d => ({ ...d, pendingMessage: { signature, id: messageId } }));
      message("user", prompt, target?.assetId, messageId);
      if (!planned) {
        const previous = draftRef.current.pendingBatch;
        const batch = previous?.signature === signature ? previous : { signature, keys: Array.from({ length: outputCount }, () => requestKey()), index: 0 };
        update(d => ({ ...d, pendingBatch: batch }));
        for (let i = batch.index; i < batch.keys.length; i++) {
          const previousText = tab === "chat" ? draftRef.current.messages.filter(m => m.role === "user" && m.id !== messageId).slice(-3).map(m => m.text).join("\n").slice(-Math.max(0, Math.min(1200, 3800 - text.length))) : "";
          const imagePrompt = previousText && text.length < 3800 ? `Conversation context (apply the latest request):\n${previousText}\nLatest request:\n${text}` : text;
          await submit(target ? "edit" : "generate", target, imagePrompt, { size: params.size }, null, batch.keys[i], null, extraReferences);
          update(d => ({ ...d, pendingBatch: { ...batch, index: i + 1 } }));
        }
        update(d => ({ ...d, pendingBatch: null }));
      }
      else {
        const planned = await api("/api/studio/plan", { method: "POST", key: requestKey(), body: { ...(modelProvider ? { provider: modelProvider } : {}), prompt: text, ...(target ? { assetId: target.assetId } : {}), messages: draftRef.current.messages.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 2000) })) } });
        update(d => ({ ...d, plan: { summary: planned.summary, steps: planned.steps, credits: planned.credits, id: requestKey(), index: 0, targetId: target?.id || null, status: "ready", activeJob: null } }));
      }
      setPrompt("");
      update(d => ({ ...d, pendingMessage: null }));
      api("/api/usage").then(setUsage).catch(() => {});
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  async function waitJob(id) {
    const signal = life.current.signal;
    while (!signal.aborted) {
      const job = await api(`/api/studio/jobs/${id}`, { signal });
      if (TERMINAL.includes(job.status)) { await collectResult(job); return job; }
      await delay(2000, signal);
    }
    throw new Error("SESSION_CLOSED");
  }
  async function runPlan() {
    if (submission.current || planExecution.current) return;
    planExecution.current = true; setPlanRunning(true);
    const planId = draftRef.current.plan.id;
    try {
      let p = draftRef.current.plan;
      for (let index = p.index; index < p.steps.length; index++) {
        if (draftRef.current.plan?.id !== planId) throw new Error("SESSION_CLOSED");
        const step = p.steps[index];
        const target = draftRef.current.layers.find(l => l.id === p.targetId);
        if (getTool(step.tool).source && !target) throw new Error("TARGET_CHANGED");
        submission.current = true; setBusy(true);
        let job;
        try { job = p.activeJob ? { id: p.activeJob } : await submit(step.tool, target, step.params.prompt || "", step.params, null, `${planId}-${index}-${p.attempt || 0}`); }
        finally { submission.current = false; setBusy(false); }
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
    finally { planExecution.current = false; setPlanRunning(false); }
  }
  function textLayer(text = t("双击创意，开始表达", "Make room for an idea"), placement) {
    const id = requestKey(); commitLayers([...draftRef.current.layers, { id, name: t("文字", "Text"), type: "text", x: 150, y: 180, width: 400, height: 80, rotation: 0, visible: true, opacity: 1, text, fontSize: 36, fill: "#fafaf8", ...placement }]); setSelected(id); setPanning(false); setTool(null); setMode("select");
  }
  async function openProject(id) {
    try {
      if (id === draftRef.current.id && saveState !== "conflict") { setProjects(null); return; }
      await loadProject(id);
      history.current = { past: [], future: [] }; setHistoryCount({ past: 0, future: 0 }); setSelected(null); setTool(null); setProjects(null); setJobs([]); setPendingTask(null);
      setMode("select"); setObjectSelection(null); canvas.current?.clearMask(); setProjectLoad(value => value + 1);
    } catch (e) { notify(e); }
  }
  async function newProject() {
    try {
      await createProject();
      setSelected(null); setJobs([]); setPendingTask(null); setResultStates({}); setTool(null); setObjectSelection(null); setMode("select");
      setPrompt(""); setProjects(null); canvas.current?.clearMask();
      history.current = { past: [], future: [] }; setHistoryCount({ past: 0, future: 0 });
      scheduleFit();
    } catch (error) { notify(error); }
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
    const restoreView = ["expand", "move", "inpaint", "erase"].includes(toolId);
    setPanning(false); setTool(null); setMode("select"); setObjectSelection(null); canvas.current?.clearMask();
    if (restoreView) scheduleFit();
  };
  const ActiveToolIcon = toolId ? (ICONS[toolId] || Sparkles) : Sparkles;
  return <div className="ms-studio" data-history={historyCount.past}>
    <header className="ms-topbar">
      <Link href="/" className="ms-brand"><Aperture size={26} /><span>ModelShot<span className="ms-brand-mark"> / </span><small>CANVAS</small></span></Link>
      <span className="ms-top-divider" />
      <button className="ms-project-trigger" disabled={busy} onClick={async () => { try { setProjects(await api("/api/studio/documents")); } catch (e) { notify(e); } }}><FolderOpen size={17} /><span>{draft.name === "Untitled" ? t("新建项目", "New project") : draft.name}<small>{saveState === "saving" ? t("正在保存…", "Saving…") : saveState === "saved" ? t("已保存到云端", "Saved to cloud") : saveState === "error" ? (typeof navigator !== "undefined" && !navigator.onLine ? t("离线，修改已保存在此设备", "Offline — saved on this device") : t("保存失败，点击保存重试", "Save failed — retry")) : saveState === "conflict" ? t("版本冲突，本地修改已保留", "Conflict — local edits preserved") : saveState === "loading" ? t("正在打开…", "Opening…") : t("待同步到云端", "Waiting to sync")}</small></span><ChevronDown size={14} /></button>
      <RecentProjects zh={zh} onChoose={openProject} disabled={busy || !ready} />
      <button className="ms-icon ms-new" title={t("新建项目", "New project")} disabled={busy || !ready} onClick={newProject}><Plus size={19} /></button>
      <div className="ms-top-actions">
        <button className="ms-button ms-save" data-action="save-studio" onClick={() => save().catch(notify)} disabled={busy}><Save size={15} />{t("保存", "Save")}</button>
        <button className="ms-button ms-export" onClick={() => setExportOpen(true)}><Download size={15} />{t("导出", "Export")}</button>
        <Link href="/account" className="ms-credit"><Zap size={15} />{usage?.credits ?? "—"}<span>{t("积分", "credits")}</span></Link>
        {session?.user ? <UserMenu user={session.user} /> : <Link href="/login" className="ms-button ms-primary">{t("登录", "Sign in")}</Link>}
      </div>
    </header>
    <div className={`ms-body ${chatCollapsed ? "chat-collapsed" : ""} ${mobileChat ? "show-chat" : "show-canvas"}`}>
      <aside className="ms-chat">
        <div className="ms-chat-heading"><span><Sparkles size={16} />{t("创意，从一句话开始", "An idea starts a conversation")}</span><button className="ms-icon" title={t("查看画布", "Show canvas")} onClick={() => { setMobileChat(false); setChatCollapsed(true); }}><PanelLeftClose size={17} /></button></div>
        <div className="ms-tabs" role="tablist">
          {[["chat", MessageCircle, t("对话", "Chat")], ["quick", Zap, t("快速", "Quick generation")]].map(([id, Icon, label]) => <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}<Link href="/commerce" className="ms-commerce-tab"><ShoppingBag size={15} />{t("电商套图", "Commerce")}</Link>
        </div>
        <div className="ms-conversation">
          <StudioMessageHistory key={draft.id || draft.createKey} documentId={draft.id} messages={draft.messages} zh={zh} onError={notify} onImage={assetId => { setImagePreview(assetId); setPreviewZoom(1); }} />
          {!draft.messages.length && <div className="ms-welcome">
            <div className="ms-orb"><Aperture size={31} strokeWidth={1.2} /></div><h1>{t("想象一下，然后实现它。", "Imagine it. Make it real.")}</h1>
            <p>{t("描述画面，上传灵感。和 AI 一起，让每个想法变成作品。", "Describe a scene. Bring a reference. Give your next idea a place to grow.")}</p>
            <div className="ms-suggestions">{[t("为我的商品设计一张自然光海报", "Create a natural-light product poster"), t("把这张图片变成电影感的画面", "Give this image a cinematic look"), t("帮我拆分主体和背景", "Separate the subject and background")].map((text, i) => <button key={text} onClick={() => { setPrompt(text); if (i === 2 && selected) chooseTool("split"); }}><span>{text}</span><ArrowUpRight size={15} /></button>)}</div>
            <span className="ms-model-note"><span className="ms-status-dot" />{t("每一步编辑，都保留原图", "Every edit keeps your original")}</span>
          </div>}
          {draft.messages.map(m => <div className={`ms-message ${m.role}`} key={m.id}>{m.role === "assistant" && <span className="ms-speaker"><Aperture size={17} />ModelShot</span>}<p>{m.text}</p>{m.assetId && <button className="ms-message-image" onClick={() => { const layer = draft.layers.find(l => l.assetId === m.assetId); if (layer) { setSelected(layer.id); setMobileChat(false); setTimeout(() => canvas.current?.fit(), 100); } }}><Image unoptimized width={480} height={480} loading="eager" src={previewUrl(m.assetId, 320)} alt={t("对话引用的图片", "Image referenced in conversation")} /></button>}</div>)}
          {draft.plan && <div className="ms-plan"><span className="ms-eyebrow"><Sparkles size={13} />{t("创作计划", "CREATIVE PLAN")}</span><p>{draft.plan.summary}</p>{draft.plan.steps.map((step, i) => <div className="ms-plan-step" key={i}><span>{i < draft.plan.index ? <Check size={13} /> : i + 1}</span><div>{zh ? getTool(step.tool)?.zh : getTool(step.tool)?.en}<small>{step.explanation}</small></div></div>)}<button className="ms-button ms-primary" disabled={busy || planRunning || draft.plan.status === "complete"} onClick={runPlan}>{draft.plan.status === "complete" ? t("已完成", "Complete") : draft.plan.index ? t("继续执行", "Continue") : t("确认并执行", "Run plan")}<span>{draft.plan.credits} {t("积分", "credits")}</span></button><button className="ms-text-button" disabled={busy || planRunning} onClick={() => update(d => ({ ...d, plan: null }))}>{t("移除计划", "Dismiss plan")}</button></div>}
          {jobs.length > 0 && <div className="ms-job-list"><span className="ms-eyebrow">{t("任务记录", "RECENT TASKS")}</span>{jobs.slice(0, 8).map(job => <div className="ms-job" key={job.id}><span className={`ms-job-dot ${job.status}`} /><div>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en}<small>{job.status === "succeeded" ? resultStates[job.id] === "failed" ? t("结果加载失败，原图已保留", "Result failed to load; original kept") : !draft.appliedJobs?.includes(job.id) ? t("已生成，正在加载到画布…", "Generated; loading onto canvas…") : t("已完成", "Complete") : job.status === "failed" ? `${t("失败", "Failed")} · ${job.errorCode}` : job.status === "cancelled" ? t("已取消", "Cancelled") : job.status === "reconciling" ? t("正在核对供应商结果…", "Checking provider result…") : t("正在处理…", "Processing…")}</small></div>{resultStates[job.id] === "failed" && <button className="ms-text-button" onClick={() => { setNotice(null); resultLoads.current.delete(job.id); collectResult(job).catch(() => {}); }}>{t("重试加载", "Retry loading")}</button>}{!TERMINAL.includes(job.status) && <button className="ms-icon" title={t("取消任务", "Cancel task")} onClick={() => api(`/api/studio/jobs/${job.id}`, { method: "DELETE" }).catch(notify)}><X size={13} /></button>}{job.resultData?.ocr && <button className="ms-text-button" onClick={() => { setSelected(job.targetId); setOcr(job.resultData.ocr); }}>{t("编辑文字", "Edit text")}</button>}</div>)}</div>}
        </div>
        <div className="ms-composer">
          {references.length > 0 && <div className="ms-reference-list">{references.map((layer, index) => <div key={layer.id} className="ms-reference"><Image unoptimized width={64} height={64} src={previewUrl(layer.assetId, 320)} alt="" /><span>{index + 1} · {layer.name}</span><button className="ms-icon" title={t("取消引用", "Clear reference")} onClick={() => { setComposer({ referenceIds: references.filter(item => item.id !== layer.id).map(item => item.id) }); if (layer.id === selectedId) setSelected(null); }}><X size={13} /></button></div>)}</div>}
          {referencePicker && <div className="ms-reference-picker"><header>{t("引用项目图片", "Reference project images")}<button className="ms-icon" aria-label={t("关闭图片选择", "Close image picker")} onClick={() => setReferencePicker(false)}><X size={14} /></button></header><div>{draft.layers.filter(layer => layer.type === "image").map(layer => <button key={layer.id} title={layer.name} disabled={references.length >= referenceLimit && !references.some(item => item.id === layer.id)} onClick={() => { setComposer({ referenceIds: [...new Set([...references.map(item => item.id), layer.id])], text: prompt.replace(/@$/, "") }); setReferencePicker(false); }}><Image unoptimized width={70} height={70} src={previewUrl(layer.assetId, 320)} alt={layer.name} /></button>)}</div><button className="ms-text-button" onClick={() => { setReferencePicker(false); setLibraryOpen("reference"); }}>{t("从素材库选择", "Choose from asset library")}</button></div>}
          {fixedOpen && <textarea className="ms-fixed-prompt" aria-label={t("固定提示词", "Fixed prompt")} placeholder={t("每次生成都会附加这段要求…", "Include these instructions with each generation…")} value={fixedPrompt} maxLength={2000} onChange={e => setComposer({ fixedPrompt: e.target.value })} />}
          <textarea aria-label={t("创作描述", "Creative prompt")} value={prompt} onChange={e => { setPrompt(e.target.value); if (e.target.value.endsWith("@")) setReferencePicker(true); if (e.target.value.endsWith("*")) setLibraryOpen("reference"); }} placeholder={t("描述你想要的画面，或选择图片继续修改…", "Describe an image, or select one to keep editing…")} maxLength={4000} onKeyDown={e => { if (!e.nativeEvent.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          <div className="ms-composer-tools"><button className="ms-icon" title={t("添加参考图", "Add reference")} disabled={busy} onClick={() => setReferencePicker(value => !value)}><ImagePlus size={19} /></button><button className={`ms-icon ${fixedPrompt ? "active" : ""}`} title={t("固定提示词", "Fixed prompt")} aria-pressed={fixedOpen} onClick={() => setFixedOpen(value => !value)}><Type size={16} /></button><label className="ms-model-pill"><span className="ms-mini-orb" /><select aria-label={t("生图模型", "Image model")} value={modelProvider} onChange={e => setModelProvider(e.target.value)}>{(capabilities?.imageModels || []).map(item => <option key={item.id} value={item.id}>{item.label} · {item.creditCost} {t("积分", "credits")}</option>)}</select><ChevronDown size={11} /></label><select aria-label={t("图片比例", "Aspect ratio")} value={params.size} onChange={e => setParams(p => ({ ...p, size: e.target.value }))}><option value="1024x1024">1:1</option><option value="1024x1536">2:3</option><option value="1536x1024">3:2</option></select><select aria-label={t("生成张数", "Output count")} value={outputCount} onChange={e => setComposer({ outputCount: Number(e.target.value) })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}{t("张", "×")}</option>)}</select><button className="ms-send" disabled={busy || !ready || !prompt.trim()} onClick={() => send()} title={t(`生成 · ${quickCost * outputCount} 积分`, `Generate · ${quickCost * outputCount} credits`)}>{busy ? <LoaderCircle className="ms-spin" size={18} /> : <ArrowUp size={19} />}</button></div>
          <small className="ms-composer-hint"><PromptOptimizer key={draft.createKey} prompt={prompt} disabled={busy || !ready} available={capabilities?.planningAvailable} cost={capabilities?.planningCost ?? 1} zh={zh} onApply={setPrompt} onCharged={() => api("/api/usage").then(setUsage).catch(() => {})} />{t(`一次提交 ${outputCount} 张 · ${quickCost * outputCount} 积分`, `${outputCount} image(s) · ${quickCost * outputCount} credits`)}{tab === "chat" && <button className="ms-text-button" disabled={busy || !ready || !prompt.trim() || !capabilities?.planningAvailable} onClick={() => send(true)} title={t("将复杂需求拆成多个步骤，先查看计划和费用", "Plan a multi-step task and review its cost first")}>{t(`生成计划 · ${capabilities?.planningCost ?? 1} 积分`, `Create plan · ${capabilities?.planningCost ?? 1} credits`)}</button>}</small>
        </div>
      </aside>
      <main className="ms-canvas-space">
        <button className="ms-icon ms-library-trigger" title={t("素材库", "Asset library")} onClick={() => setLibraryOpen(true)}><FolderOpen size={19} /></button>
        {saveState === "conflict" && <div className="ms-save-conflict" role="alert"><span>{t("云端项目已更新，本地修改已保留", "The cloud project changed. Your local edits are preserved.")}</span><button onClick={() => save(true).catch(notify)}>{t("另存为新项目", "Save as new project")}</button><button onClick={() => reloadCloud().catch(notify)}>{t("打开云端版本", "Open cloud version")}</button></div>}
        <StudioTaskPopover documentId={draft.id} key={draft.createKey || draft.id} jobs={jobs} pending={pendingTask} appliedJobs={draft.appliedJobs} resultStates={resultStates} zh={zh}
          onRetry={job => { setNotice(null); resultLoads.current.delete(job.id); collectResult(job).catch(() => {}); }}
          onCancel={async job => { try { await api(`/api/studio/jobs/${job.id}`, { method: "DELETE" }); setJobs(current => current.map(row => row.id === job.id ? { ...row, cancelRequested: true } : row)); setProjectLoad(value => value + 1); } catch (error) { notify(error); } }}
          onLocate={job => {
            let layers = draftRef.current.layers, layer = layers.find(item => item.sourceJobId === job.id);
            if (!layer && job.resultData?.assets?.length) {
              const first = job.resultData.assets[0];
              const target = layers.find(item => item.id === job.targetId) || { id: job.targetId || requestKey(), assetId: job.assetId, name: zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en, type: "image", width: Math.min(first.width, 480), height: Math.min(first.width, 480) * first.height / first.width, x: 0, y: 100, rotation: 0, visible: true, opacity: 1 };
              layers = appendResult(layers, job, target); commitLayers(layers); layer = layers.find(item => item.sourceJobId === job.id);
            }
            if (layer) { if (!layer.visible) commitLayers(layers.map(item => item.id === layer.id ? { ...item, visible: true } : item)); setSelected(layer.id); setMobileChat(false); setTimeout(() => canvas.current?.focusLayer(layer.id), 0); }
          }} />
        {chatCollapsed && <button className="ms-icon ms-chat-restore" title={t("展开聊天", "Open chat")} onClick={() => { setChatCollapsed(false); setMobileChat(true); }}><PanelLeftOpen size={18} /></button>}
        <Canvas ref={canvas} layers={draft.layers} selectedId={selectedId} onSelect={id => { setSelected(id); if (id !== selectedId) closeTool(); }} onChange={commitLayers} mode={mode} brushSize={brush}
          selectionTool={toolId} editPadding={params.editPadding}
          zh={zh} onViewport={setViewport} onCamera={onCamera} onPreview={asset => { setImagePreview(asset); setPreviewZoom(1); }}
          moveRegions={toolId === "move" && objectSelection?.region ? { source: params.moveSource, target: params.moveTarget } : null} onMoveRegions={patch => setParams(p => ({ ...p, ...patch }))}
          cropRect={params.rect} cropShape={params.cropShape} cropGrid={params.cropGrid} onCropGrid={cropGrid => setParams(p => ({ ...p, cropGrid }))} onMaskChange={setHasMask} panning={panning || spaceHeld} moveOffset={{ dx: params.dx, dy: params.dy }} onMoveOffset={offset => setParams(p => ({ ...p, ...offset }))} onMovePreparing={() => { setObjectSelection(null); setMode("object-preparing"); }} onMoveReady={value => { setObjectSelection(value); setParams(p => ({ ...p, dx: 0, dy: 0, ...(value.region ? { moveSource: { ...value.bounds, rotation: 0 }, moveTarget: { ...value.bounds, rotation: 0 } } : {}) })); setMode(toolId === "inpaint" ? "object-edit" : "move"); }} onMoveFailed={() => { setObjectSelection(null); setMode("object-select-rect"); }}
          onCrop={rect => setParams(p => ({ ...p, rect }))} expandPadding={params.padding} onExpandPadding={padding => setParams(p => ({ ...p, padding }))}
          onZoom={setZoom} onUpload={upload} onError={notify} label={t("图片编辑画布", "Image editing canvas")} />
        <div className="ms-canvas-label"><span className="ms-status-dot" />{t("自由画布", "FREE CANVAS")}<span> / </span>{draft.layers.length} {t("个图层", "layers")}</div>
        {selected?.type === "image" && viewport && !toolId && <div className="ms-image-dimensions" style={{ left: Math.max(85, Math.min(viewport.viewportWidth - 85, viewport.left + viewport.width / 2)), top: Math.max(44, Math.min(viewport.viewportHeight - 150, viewport.top + viewport.height + 14)) }}>W {selected.pixelWidth}<span>H {selected.pixelHeight}</span></div>}
        {jobs.some(job => !TERMINAL.includes(job.status) || job.status === "succeeded" && !draft.appliedJobs?.includes(job.id)) && <div className="ms-task-status" role="status" aria-live="polite">{jobs.filter(job => !TERMINAL.includes(job.status) || job.status === "succeeded" && !draft.appliedJobs?.includes(job.id)).slice(0, 3).map(job => <div key={job.id}><span>{zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · {resultStates[job.id] === "failed" ? t("图片加载失败，原图已保留", "Image failed to load; original kept") : job.status === "succeeded" ? t("正在加载结果…", "Loading result…") : t("正在生成，原图已保留…", "Generating; original kept…")}</span>{resultStates[job.id] === "failed" && <button className="ms-text-button" onClick={() => { setNotice(null); resultLoads.current.delete(job.id); collectResult(job).catch(() => {}); }}>{t("重试加载", "Retry loading")}</button>}</div>)}</div>}
        {!draft.layers.length && <div className="ms-empty-canvas"><div className="ms-empty-art"><div className="ms-art-frame back"><Image unoptimized width={480} height={480} loading="eager" src="/studio/scene-05.webp" alt="" /></div><div className="ms-art-frame front"><Image unoptimized width={480} height={480} loading="eager" src="/studio/scene-03.webp" alt="" /><span><Sparkles size={12} />{t("灵感，正在发生", "A place for possibilities")}</span></div><span className="ms-art-cross one">+</span><span className="ms-art-cross two">+</span></div><h2>{t("你的下一幅作品，从这里开始", "A blank canvas. Endless possibilities.")}</h2><p>{t("拖入图片，或在左侧说出你的想法", "Drop an image here, or start with an idea on the left")}</p><button className="ms-button ms-primary" disabled={busy} onClick={() => fileInput.current.click()}><Plus size={17} />{t("上传第一张图片", "Upload your first image")}</button><small>PNG · JPG · WEBP · 10 MB</small></div>}
        <div className="ms-canvas-top-right"><button className={`ms-icon ${showLayers ? "active" : ""}`} title={t("图层", "Layers")} onClick={() => setShowLayers(!showLayers)}><Layers3 size={18} /></button></div>
        {selected?.type === "image" && !showLayers && !toolId && !ocr && <div className="ms-image-menu ms-context-toolbar" style={viewport ? { left: Math.max(8, Math.min(viewport.viewportWidth - 174, viewport.left + viewport.width + 14)), top: menuTop, maxHeight: Math.max(100, viewport.viewportHeight - menuTop - 90) } : undefined}>
          <div className="ms-menu-caption"><span>{selected.name}</span><span>{selected.pixelWidth} × {selected.pixelHeight}</span></div>
          <div className="ms-context-scroll">{TOOLS.filter(item => !["generate", "edit"].includes(item.id)).map(item => { const Icon = ICONS[item.id], capability = capabilities?.tools.find(row => row.id === item.id), unavailable = !capability?.available && item.id !== "crop";
            const configHint = unavailable && capability?.reason === "SEGMENTATION_NOT_CONFIGURED" ? t("需管理员配置物体分割模型", "Admin: configure a segmentation model") : unavailable && item.dependency === "split" ? t("需管理员配置图层拆分模型", "Admin: configure layer split model") : unavailable && item.dependency === "image" ? t("需管理员配置编辑模型", "Admin: configure edit model") : unavailable ? t("需管理员启用", "Admin: enable required") : "";
            return <button key={item.id} disabled={unavailable} title={`${zh ? item.zh : item.en}${unavailable ? ` · ${configHint}` : ` · ${capability?.cost ?? item.cost} ${t("积分", "credits")}`}`} onClick={() => chooseTool(item.id)}><Icon size={16} /><span>{zh ? item.zh : item.en}</span>{unavailable ? <i className="ms-setup-dot" /> : <small>{capability?.cost ?? item.cost}</small>}</button>; })}
            <button title={t("添加到聊天", "Add to chat")} onClick={() => { setMobileChat(true); setChatCollapsed(false); setComposer({ referenceIds: [selected.id], text: prompt }); }}><MessageCircle size={16} /><span>{t("聊天", "Chat")}</span></button>
            <button onClick={() => api("/api/library", { method: "POST", body: { assetId: selected.assetId, name: selected.name } }).then(() => setNotice(t("已保存到素材库", "Saved to asset library"))).catch(notify)}><FolderOpen size={16} /><span>{t("存入素材库", "Save to library")}</span></button>
            <a title={t("下载原图", "Download image")} href={imageUrl(selected.assetId)} download={`${selected.name}.png`}><Download size={16} /><span>{t("下载", "Download")}</span></a>
          </div>
        </div>}
        {toolId && selected && <ToolPanel tool={tool} Icon={ActiveToolIcon} status={toolStatus} selected={selected} params={params} onParams={patch => setParams(p => ({ ...p, ...patch }))}
          prompt={prompt} onPrompt={setPrompt} brush={brush} onBrush={setBrush} hasMask={hasMask} selection={objectSelection} busy={busy} moveUnchanged={moveUnchanged} cost={toolCost} zh={zh}
          onClose={closeTool} onRun={runTool} onReset={() => {
            if (toolId === "move") { canvas.current.clearMovePreview(); setObjectSelection(null); setMode("object-select-rect"); }
            else if (["inpaint", "erase"].includes(toolId)) canvas.current.clearMask();
            else if (toolId === "crop") setParams(p => ({ ...p, rect: { left: 0, top: 0, width: selected.pixelWidth, height: selected.pixelHeight }, cropShape: "rectangle", cropGrid: undefined }));
            else if (toolId === "expand") setParams(p => ({ ...p, padding: { left: 256, right: 256, top: 256, bottom: 256 } }));
          }} />}
        {selected?.type === "text" && <div className="ms-tool-panel"><div className="ms-panel-title">{t("文字编辑", "Edit text")}<Type size={16} /></div><textarea aria-label={t("图层文字", "Layer text")} value={selected.text} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, text: e.target.value } : l))} /><label>{t("字号", "Font size")}<input type="number" min="8" max="512" value={selected.fontSize} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, fontSize: Number(e.target.value) || 8 } : l))} /></label><label>{t("颜色", "Color")}<input type="color" value={selected.fill} onChange={e => commitLayers(draft.layers.map(l => l.id === selectedId ? { ...l, fill: e.target.value } : l))} /></label></div>}
        {selected?.type === "video" && <div className="ms-tool-panel"><div className="ms-panel-title">{t("视频作品", "Video result")}</div><button className="ms-button ms-primary" onClick={() => setPreview(selected.assetId)}><Play size={15} />{t("播放视频", "Play video")}</button><a className="ms-button" href={imageUrl(selected.assetId)} download="modelshot-video.mp4"><Download size={15} />{t("下载 MP4", "Download MP4")}</a></div>}
        {ocr && <div className="ms-tool-panel"><div className="ms-panel-title">{t("图片中的文字", "Image text")}<button className="ms-icon" onClick={() => setOcr(null)} title={t("关闭", "Close")}><X size={15} /></button></div><p>{t(`修改文字后，移除原文字并创建可编辑文字层。${capabilities?.tools.find(c => c.id === "erase")?.cost ?? 18} 积分/区域。`, `Replace original text with an editable layer. ${capabilities?.tools.find(c => c.id === "erase")?.cost ?? 18} credits per region.`)}</p>{(ocr.boxes || []).map((box, index) => <div className="ms-ocr-row" key={index}><input value={box.text} onChange={e => setOcr(data => ({ ...data, boxes: data.boxes.map((b, i) => i === index ? { ...b, text: e.target.value } : b) }))} /><button className="ms-icon" disabled={busy || !capabilities?.tools.find(c => c.id === "erase")?.available} onClick={() => replaceText(box)} title={t("替换此文字", "Replace text")}><Check size={16} /></button></div>)}</div>}
        {showLayers && <div className="ms-layers"><div className="ms-panel-title">{t("图层", "Layers")}<span>{draft.layers.length}</span></div>{draft.layers.toReversed().map(layer => <div className={`ms-layer ${selectedId === layer.id ? "selected" : ""}`} key={layer.id}><button className="ms-layer-select" onClick={() => { setSelected(layer.id); closeTool(); }}>{layer.type === "image" ? <Image unoptimized width={480} height={480} src={previewUrl(layer.assetId, 320)} alt="" /> : layer.type === "text" ? <Type size={18} /> : <Video size={18} />}<span>{layer.name}</span></button><button className="ms-icon" title={t("显示/隐藏", "Show/hide")} onClick={() => commitLayers(draft.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l))}>{layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button></div>)}{selected && <div className="ms-layer-actions"><button className="ms-icon" title={t("上移一层", "Raise layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i < list.length - 1) { [list[i], list[i + 1]] = [list[i + 1], list[i]]; commitLayers(list); } }}><ArrowUp size={15} /></button><button className="ms-icon" title={t("下移一层", "Lower layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i > 0) { [list[i], list[i - 1]] = [list[i - 1], list[i]]; commitLayers(list); } }}><ArrowDown size={15} /></button><button className="ms-icon" title={t("复制图层", "Duplicate layer")} onClick={() => commitLayers([...draft.layers, { ...selected, id: requestKey(), x: selected.x + 24, y: selected.y + 24 }])}><Copy size={15} /></button><button className="ms-icon" title={t("删除图层", "Delete layer")} onClick={() => { commitLayers(draft.layers.filter(l => l.id !== selectedId)); setSelected(null); }}><Trash2 size={15} /></button></div>}</div>}
        <div className="ms-bottom-toolbar">{[["select", MousePointer2, t("选择", "Select")], ["hand", Hand, t("平移", "Pan")]].map(([id, Icon, title]) => <button key={id} className={`ms-icon ${(id === "hand" ? panning : !panning) ? "active" : ""}`} title={title} aria-pressed={id === "hand" ? panning : !panning} onClick={() => setPanning(id === "hand")}><Icon size={20} /></button>)}<span /><button className="ms-icon" title={t("上传图片", "Upload image")} disabled={busy} onClick={() => fileInput.current.click()}><ImagePlus size={20} /></button><button className="ms-icon" title={t("添加文字", "Add text")} onClick={() => textLayer()}><Type size={20} /></button><span /><button className="ms-icon" data-action="undo" title={t("撤销", "Undo")} disabled={!historyCount.past} onClick={() => undo()}><Undo2 size={19} /></button><button className="ms-icon" data-action="redo" title={t("重做", "Redo")} disabled={!historyCount.future} onClick={() => undo(true)}><Redo2 size={19} /></button></div>
        <div className="ms-zoom"><button className="ms-icon" title={t("缩小", "Zoom out")} onClick={() => canvas.current.zoom(0.8)}><Minus size={16} /></button><input aria-label={t("画布缩放", "Canvas zoom")} type="range" min="8" max="400" value={Math.round(zoom * 100)} onChange={event => canvas.current.zoom(Number(event.target.value) / 100 / zoom)} /><output>{Math.round(zoom * 100)}%</output><button className="ms-icon" title={t("放大", "Zoom in")} onClick={() => canvas.current.zoom(1.25)}><Plus size={16} /></button><button className="ms-icon" title={t("适应画布", "Fit canvas")} onClick={() => canvas.current.fit()}><Maximize size={16} /></button><button className="ms-icon" title={t("预览图片", "Preview image")} disabled={selected?.type !== "image"} onClick={() => { setImagePreview(selected.assetId); setPreviewZoom(1); }}><Eye size={17} /></button></div>
      </main>
    </div>
    <button className="ms-mobile-toggle" onClick={() => setMobileChat(!mobileChat)}>{mobileChat ? <Layers3 size={17} /> : <PanelLeftOpen size={17} />}{mobileChat ? t("画布", "Canvas") : t("对话", "Chat")}</button>
    <input className="ms-file-input" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label={t("上传图片文件", "Upload image files")} onChange={e => upload(e.target.files)} />
    {notice && <div className="ms-notice" role="alert"><span>{notice}</span><button className="ms-icon" title={t("关闭提示", "Dismiss")} onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {exportOpen && <StudioExportDialog zh={zh} selected={selected && selected.type !== "video"} onClose={() => setExportOpen(false)} onExport={options => canvas.current.exportImage({ ...options, name: draft.name })} />}
    {projects && <div className="ms-modal-backdrop"><section className="ms-project-modal" role="dialog" aria-modal="true" aria-label={t("项目管理", "Projects")}><div className="ms-panel-title">{t("我的项目", "Your projects")}<button className="ms-icon" title={t("关闭", "Close")} onClick={() => setProjects(null)}><X size={18} /></button></div><label>{t("当前项目名称", "Current project name")}<input value={draft.name} maxLength={100} onChange={e => update(d => ({ ...d, name: e.target.value, nameSource: "manual" }))} /></label><div className="ms-project-buttons"><button className="ms-button ms-primary" onClick={() => save().then(() => setProjects(null)).catch(notify)}><Save size={15} />{t("保存项目", "Save project")}</button><button className="ms-button" onClick={() => save(true).then(() => setProjects(null)).catch(notify)}>{t("另存为", "Save as new")}</button></div><div className="ms-project-list">{projects.length ? projects.map(p => <button key={p.id} onClick={() => openProject(p.id)}><FolderOpen size={20} /><span>{p.name}<small>{new Date(p.updatedAt).toLocaleString(locale)}</small></span><ArrowUpRight size={15} /></button>) : <p>{t("还没有云端项目。保存你的第一个作品。", "No cloud projects yet. Save your first creation.")}</p>}</div></section></div>}
    {libraryOpen && <Modal label={t("选择素材", "Choose assets")} className="ml-picker-dialog" onClose={() => setLibraryOpen(false)}><button className="ms-icon" title={t("关闭", "Close")} onClick={() => setLibraryOpen(false)}><X size={18} /></button><AssetLibrary maxSelection={libraryOpen === "reference" ? Math.max(0, referenceLimit - references.length) : 10} onSelect={importLibrary} /></Modal>}
    {imagePreview && <div className="ms-image-preview" role="dialog" aria-label={t("图片预览", "Image preview")} aria-modal="true">
      <div className="ms-preview-controls"><button className="ms-icon" title={t("缩小预览", "Zoom preview out")} onClick={() => setPreviewZoom(z => Math.max(0.25, z - 0.25))}><Minus size={18} /></button><span>{Math.round(previewZoom * 100)}%</span><button className="ms-icon" title={t("放大预览", "Zoom preview in")} onClick={() => setPreviewZoom(z => Math.min(4, z + 0.25))}><Plus size={18} /></button><a className="ms-icon" href={imageUrl(imagePreview)} download="modelshot.png" title={t("下载原图", "Download image")}><Download size={18} /></a><button autoFocus className="ms-icon" title={t("关闭预览", "Close preview")} onClick={() => setImagePreview(null)}><X size={20} /></button></div>
      <div className="ms-preview-image"><Image unoptimized src={imageUrl(imagePreview)} width={2048} height={2048} style={{ transform: `scale(${previewZoom})` }} alt={t("完整图片", "Full image")} /></div>
      <div className="ms-preview-history">{draft.layers.filter(l => l.type === "image").map(l => <button key={l.id} className={l.assetId === imagePreview ? "active" : ""} aria-label={l.name} onClick={() => { setImagePreview(l.assetId); setPreviewZoom(1); }}><Image unoptimized src={previewUrl(l.assetId, 320)} width={64} height={64} alt="" /></button>)}</div>
    </div>}
    {preview && <div className="ms-modal-backdrop"><section className="ms-video-modal"><button className="ms-icon" title={t("关闭视频", "Close video")} onClick={() => setPreview(null)}><X size={20} /></button><video src={imageUrl(preview)} controls autoPlay playsInline /></section></div>}
  </div>;
}
