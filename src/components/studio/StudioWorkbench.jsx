"use client";
import CreditIcon from "@/components/ui/CreditIcon";
import AutoGrowTextarea from "@/components/ui/AutoGrowTextarea";
import { IMAGE_REFERENCE_ROLES, IMAGE_REFERENCE_LABELS } from "@/lib/studio/image-references";
import { imageCreditCost } from "@/lib/studio/image-pricing";

import dynamic from "next/dynamic";
import Image from "@/components/studio/AssetImage";
import { lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { useRecharge } from "@/components/billing/RechargeProvider";
import { useLocale } from "next-intl";
import Link from "@/components/ui/NavigationLink";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import { ArrowUp, ArrowDown, ArrowUpRight, Plus, X, FolderOpen, Download, Save, Undo2, Redo2, MousePointer2, Hand, ImagePlus, Type, Layers3, Sparkles, WandSparkles, Expand, Crop, Eraser, Move, ScanText, Scissors, Video, Zap, ChevronDown, Check, LoaderCircle, ZoomIn, Minus, Maximize, Trash2, Eye, EyeOff, Copy, Coins, Play, PanelLeftOpen } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import ProjectManager from "./ProjectManager";
import { uploadImage } from "@/lib/upload-image";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { useUploadFeedback } from "@/hooks/useUploadFeedback";
import UploadFeedback from "@/components/ui/UploadFeedback";
import DeferredTool, { ToolLoading } from "@/components/ui/DeferredTool";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/image-upload-limits";
import { clipboardImageFiles, imagePasteDestination } from "@/lib/studio/image-paste";
import BrandLogo, { BrandMark } from "@/components/BrandLogo";
import ModelPicker from "@/components/ui/ModelPicker";
import ImageSizePicker from "@/components/ui/ImageSizePicker";
import { getTool } from "@/lib/studio/tool-catalog";
import { textLayerHeight } from "@/lib/studio/text-layer";
import { appendResult, scaleToFit } from "@/lib/studio/canvas-utils";
import { confirmedImageSubmission, submissionRejected } from "@/lib/studio/submission-recovery";
import { remapImageReferences, REMOVED_REFERENCE } from "@/lib/studio/reference-numbering";
import { reserveCanvasTasks } from "@/lib/studio/canvas-lineage";
import { commerceContent } from "@/lib/commerce/project";
import { imageUrl, previewUrl } from "@/lib/studio/image-url";
import { loadImage } from "@/lib/studio/image-processor";
import { maskHash as hashMask } from "@/lib/studio/mask-hash";
import { promptTitle } from "@/lib/studio/project-title";
import { useStudioProject } from "./useStudioProject";
import { usePageVisible } from "@/components/ui/LocalNavigation";
import { useStudioJobs } from "./useStudioJobs";
import { jobBelongsToDocument } from "@/lib/studio/job-document";
import StudioActivity from "./StudioActivity";
import StudioTaskPopover from "./StudioTaskPopover";
import StudioMessageHistory from "./StudioMessageHistory";
import StudioMessageList from "./StudioMessageList";
import "./generation-price.css";
import { useStudioView } from "./useStudioView";
import RecentProjects from "./RecentProjects";
import { selectedLayerIds } from "@/lib/studio/layer-operations";
import ImageToolToolbar from "./ImageToolToolbar";
import { adjustedImage } from "@/lib/studio/adjustments";
import { imageToolErrorMessage } from "@/lib/studio/image-tool-errors";
import "./creative-tools.css";
import UserMenu from "@/components/UserMenu";
import Modal from "@/components/ui/Modal";
import "./studio.css";
import "./workspace-density.css";
import BrandLoader from "@/components/ui/BrandLoader";
import CountPicker from "@/components/ui/CountPicker";
import VideoPlayer from "@/components/ui/VideoPlayer";

const Canvas = dynamic(() => import("./StudioCanvas"), { ssr: false, loading: () => <BrandLoader variant="panel" label="正在打开画布" /> });
const StudioImageViewer = lazy(() => import("./StudioImageViewer"));
const StudioExportDialog = lazy(() => import("./StudioExportDialog"));
const AssetLibrary = dynamic(() => import("./AssetLibrary"), { loading: ToolLoading });
const LayerSelectionTools = dynamic(() => import("./LayerSelectionTools"), { loading: ToolLoading });
const VideoResultActions = dynamic(() => import("@/components/video/VideoResultActions"), { loading: ToolLoading });
const CanvasVideoSourceDialog = dynamic(() => import("@/components/video/CanvasVideoSourceDialog"), { loading: ToolLoading });
const CanvasVideoPanel = dynamic(() => import("@/components/video/CanvasVideoPanel"), { loading: ToolLoading });
const ToolPanel = dynamic(() => import("./ToolPanel"), { loading: ToolLoading });
const AdjustmentPanel = dynamic(() => import("./AdjustmentPanel"), { loading: ToolLoading });
const PromptOptimizer = dynamic(() => import("./PromptOptimizer"), { loading: ToolLoading });
const OcrResultPanel = dynamic(() => import("./OcrResultPanel"), { loading: ToolLoading });
const DurablePlanPanel = dynamic(() => import("@/components/creation/DurablePlanPanel"), { loading: ToolLoading });
const CANVAS_HANDLER_NAMES = ["onOpenOcr", "onUsePrompt", "onSelect", "onChange", "onFocusPoint", "onViewport", "onCamera", "onPreview", "onMoveRegions", "onMoveOffset", "onMovePreparing", "onMoveReady", "onMoveFailed", "onCrop", "onCropGrid", "onMaskChange", "onExpandPadding", "onZoom", "onUpload", "onError", "onChooseTool", "onCanvasChat", "onSaveToLibrary"];
const EMPTY_CANVAS_ARRAY = Object.freeze([]);
const EMPTY_CANVAS_OBJECT = Object.freeze({});
function createCanvasViewStore() {
  let zoom = 1, viewport = null;
  const zoomListeners = new Set(), viewportListeners = new Set();
  return {
    getZoom: () => zoom,
    getViewport: () => viewport,
    subscribeZoom(listener) { zoomListeners.add(listener); return () => zoomListeners.delete(listener); },
    subscribeViewport(listener) { viewportListeners.add(listener); return () => viewportListeners.delete(listener); },
    setZoom(value) { if (value !== zoom) { zoom = value; zoomListeners.forEach(listener => listener()); } },
    setViewport(value) {
      if (value === viewport || value && viewport && Object.keys(value).every(key => value[key] === viewport[key])) return;
      viewport = value;
      viewportListeners.forEach(listener => listener());
    },
  };
}
const StudioZoomControls = memo(function StudioZoomControls({ store, canvas, zh, previewEnabled, onPreview }) {
  const zoom = useSyncExternalStore(store.subscribeZoom, store.getZoom, store.getZoom);
  const t = (cn, en) => zh ? cn : en;
  return <div className="ms-zoom"><button className="ms-icon" title={t("缩小", "Zoom out")} onClick={() => canvas.current.zoom(0.8)}><Minus size={16} /></button><input aria-label={t("画布缩放", "Canvas zoom")} type="range" min="8" max="400" value={Math.round(zoom * 100)} onChange={event => canvas.current.zoom(Number(event.target.value) / 100 / zoom)} /><output>{Math.round(zoom * 100)}%</output><button className="ms-icon" title={t("放大", "Zoom in")} onClick={() => canvas.current.zoom(1.25)}><Plus size={16} /></button><button className="ms-icon" title={t("适应画布", "Fit canvas")} onClick={() => canvas.current.fit()}><Maximize size={16} /></button><button className="ms-icon" title={t("预览图片", "Preview image")} disabled={!previewEnabled} onClick={onPreview}><Eye size={17} /></button></div>;
});
const StudioCanvasOverlays = memo(function StudioCanvasOverlays({ store, selected, zh, toolId, showLayers, ocr, size, capabilities, singleSelection, onChoose, onChat, onSave }) {
  const viewport = useSyncExternalStore(store.subscribeViewport, store.getViewport, store.getViewport);
  return <>
    {selected?.type === "image" && viewport && <div className="ms-image-dimensions" style={{ left: Math.max(85, Math.min(viewport.viewportWidth - 85, viewport.left + viewport.width / 2)), top: Math.max(44, Math.min(viewport.viewportHeight - 150, viewport.top + viewport.height + 14)) }}>W {selected.pixelWidth}<span>H {selected.pixelHeight}</span></div>}
    {selected?.type === "image" && singleSelection && !showLayers && !toolId && !ocr && <ImageToolToolbar key={selected.id} size={size} selected={selected} viewport={viewport} capabilities={capabilities} zh={zh} onChoose={onChoose} onChat={onChat} onSave={onSave} />}
  </>;
});
const ICONS = { generate: Sparkles, edit: WandSparkles, expand: Expand, upscale: ZoomIn, describe: WandSparkles, erase: Eraser, inpaint: Scissors, split: Layers3, move: Move, ocr: ScanText, "remove-bg": Scissors, crop: Crop, video: Video };
const TERMINAL = ["succeeded", "failed", "cancelled"];
const delay = (ms, signal) => new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("SESSION_CLOSED")); }, { once: true }); });

export default function StudioWorkbench({ initialDocument = "", initialPrompt = "", initialMode = "chat", initialProvider = "", initialSize = "1024x1024", initialCount = 1, initialFixed = "" }) {
  const router = useNavigationRouter();
  const pageVisible = usePageVisible();
  const recharge = useRecharge();
  const locale = useLocale(), zh = locale === "zh", { data: session, status } = useSession();
  const t = useCallback((cn, en) => zh ? cn : en, [zh]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null);
  const notify = useCallback(error => {
    const code = typeof error === "string" ? error : error?.code || error?.message || "UNKNOWN_ERROR";
    if (code === "SESSION_CLOSED") return;
    const descriptions = {
      REQUEST_TIMEOUT: t("读取超时，请稍后重试；已提交的任务不会因此取消。", "The request timed out. Try again; submitted jobs are not cancelled."),
      LOCAL_SAVE_FAILED: t("本地保存失败，请保持页面打开并重试云端保存。", "Local save failed. Keep this page open and retry saving to the cloud."),
      DOCUMENT_SAVE_UNAVAILABLE: t("画布暂未同步到云端，已自动重试。请保留当前页面，稍后点击保存重试。", "Canvas sync is temporarily unavailable after automatic retries. Keep this page open and retry saving shortly."),
      DOCUMENT_SAVE_TOO_LARGE: t("画布保存请求超过服务器大小限制，请保留当前页面并联系管理员检查上传限制。", "The canvas exceeds the server request size limit. Keep this page open and ask an admin to check upload limits."),
      DOCUMENT_LOAD_TIMEOUT: t("项目加载超时，可以重试打开；此设备上的草稿会保留。", "Project loading timed out. Retry opening it; drafts on this device are preserved."),
      DOCUMENT_VERSION_CONFLICT: t("云端版本已更新。本地修改仍在，请另存为新项目或打开云端版本。", "Cloud version changed. Save as a new project or open the cloud version."),
      PRICE_CHANGED: t("积分价格已更新，请查看最新费用后重新提交；本次未新增扣费。", "Pricing changed. Review the updated cost and submit again; no new charge was made."),
      INSUFFICIENT_CREDITS: t("可用积分不足，请补充积分后重试。", "Not enough available credits."),
      UNAUTHORIZED: t("请先登录，素材和作品会保存到你的账户。", "Sign in to save assets and projects."),
      CREATION_NOT_ENABLED: t("当前账号暂未开放视频创作，请联系管理员开通。", "Video creation is not enabled for this account. Contact an administrator."),
      IMAGE_SIZE_UNSUPPORTED: t("当前模型不支持所选比例或分辨率，请更换模型或尺寸。", "This model does not support the selected dimensions. Change the model or size."),
      IMAGE_PROMPT_INVALID: t("MiniMax 生图需要非空提示词，且最多 1500 字符，请精简后重试。", "MiniMax requires a non-empty prompt of at most 1,500 characters. Shorten it and retry."),
      IMAGE_RESOLUTION_UNSUPPORTED: t("当前模型不支持此分辨率，请选择 2K 或 4K。", "This model requires a larger resolution. Choose 2K or 4K."),
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
      UPSCALE_SCALE_UNSUPPORTED: t("当前超分服务支持 2 倍放大。", "This upscale service supports 2×."),
      UPSCALE_INPUT_DIMENSIONS: t("超分输入需宽 50–2128、高 50–4064 像素，请先裁剪或调整尺寸。", "Upscaling requires width 50–2128 and height 50–4064 pixels."),
      UPSCALE_INPUT_TOO_LARGE: t("超分输入图片需不超过 5 MB。", "Upscale input must be at most 5 MB."),
      OCR_NOT_CONFIGURED: t("请在后台配置 OCR 专用视觉模型。", "Configure a dedicated OCR vision model in Admin."),
      UPSCALE_NOT_CONFIGURED: t("请在后台配置火山超分 AK/SK。", "Configure Volcengine upscale credentials in Admin."),
      INVALID_OCR_RESULT: t("文字识别结果格式异常，请检查 OCR 模型是否支持图片和 JSON 输出。", "Invalid OCR response. Check image and JSON support."),
      VISION_NOT_CONFIGURED: t("管理员尚未配置对话规划模型。请在后台“模型配置 → 后台大语言模型”配置；也可使用“快速生图”直接生成一张图。", "No planning model is configured. Configure one in Admin → Models → Backend language model, or use Quick generation for a direct single-image request."),
    };
    const detail = ["REQUEST_FAILED", "DOCUMENT_SAVE_UNAVAILABLE", "DOCUMENT_SAVE_TOO_LARGE"].includes(code)
      ? `（${[error?.status ? `HTTP ${error.status}` : t("连接中断或响应异常", "Connection or response error"), error?.traceId ? `ID: ${error.traceId}` : ""].filter(Boolean).join(" · ")}）`
      : "";
    setNotice((descriptions[code] || imageToolErrorMessage(code, zh)) + detail);
  }, [t, zh]);
  const { draft, draftRef, update, save, saveState, ready, switching, open: loadProject, create: createProject, flushLocal, reloadCloud, retryLoad } = useStudioProject({ userId: session?.user?.id, sessionLoading: status === "loading", initialDocument, initialPrompt, initialSize, initialCount, initialFixed, paused: busy, onError: error => notify(error) });
  const [selectionIds, setSelectionIds] = useState([]);
  const uploadFeedback = useUploadFeedback(`${session?.user?.id || "guest"}:${draft.createKey}`);
  const [selectedId, setSelected] = useState(null), [tab] = useState(initialMode === "quick" ? "quick" : "chat"), [mode, setMode] = useState("select");
  const [canvasVideo, setCanvasVideo] = useState(null);
  const [videoSources, setVideoSources] = useState(null);
  const [toolId, setTool] = useState(null), [toolParams, setParams] = useState({ size: initialSize, scale: 2, padding: 256, dx: 100, dy: 0, duration: 5, editPadding: 0.25, numLayers: 4 });
  const params = useMemo(() => ({ ...toolParams, size: draft.composer?.size || toolParams.size }), [toolParams, draft.composer?.size]);
  const [hasMask, setHasMask] = useState(false);
  const [toolReferences, setToolReferences] = useState([]), [adjustments, setAdjustments] = useState({}), [compareOriginal, setCompareOriginal] = useState(false);
  const focusSession = useRef(0);
  const [brush, setBrush] = useState(8), [capabilities, setCapabilities] = useState(null), [usage, setUsage] = useState(null);
  const canvasViewStore = useMemo(() => createCanvasViewStore(), []);
  const [modelProvider, setModelProvider] = useState(initialProvider);
  const prompt = draft.composer?.text ?? "";
  const fixedPrompt = draft.composer?.fixedPrompt || "", outputCount = draft.composer?.outputCount || 1;
  const setPrompt = value => update(d => ({ ...d, composer: { ...d.composer, text: typeof value === "function" ? value(d.composer?.text || "") : value } }));
  const [referencePicker, setReferencePicker] = useState(false), [fixedOpen, setFixedOpen] = useState(false);
  const [objectSelection, setObjectSelection] = useState(null);
  const [panning, setPanning] = useState(false), [spaceHeld, setSpaceHeld] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [previewSeed, setPreviewSeed] = useState(null);
  const moveUnchanged = objectSelection?.region ? JSON.stringify(params.moveSource) === JSON.stringify(params.moveTarget) : !params.dx && !params.dy;
  const [resultStates, setResultStates] = useState({}), [planRunning, setPlanRunning] = useState(false);
  const [projectLoad, setProjectLoad] = useState(0);
  const [pendingTask, setPendingTask] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const resultLoads = useRef(new Map()), planExecution = useRef(false);
  const [projects, setProjects] = useState(null), [jobs, setJobs] = useState([]), [showLayers, setShowLayers] = useState(false), [mobileChat, setMobileChat] = useState(true);
  const [preview, setPreview] = useState(null), [ocr, setOcr] = useState(null);
  const canvasJobs = useMemo(() => jobs.filter(job => jobBelongsToDocument(job, draft.id)), [jobs, draft.id]);
  useEffect(() => {
    if (!ready || !draft.id) return;
    let live = true;
    Promise.resolve().then(() => { if (live) update(current => reserveCanvasTasks(current, canvasJobs)); });
    return () => { live = false; };
  }, [canvasJobs, ready, draft.id, update]);
  const [historyCount, setHistoryCount] = useState({ past: 0, future: 0 });
  const history = useRef({ past: [], future: [] }), canvas = useRef(null), fileInput = useRef(null), fitTimer = useRef(null);
  const life = useRef(null), submission = useRef(false);
  const uploadDestination = useRef("canvas");
  const interaction = useRef({});
  const canvasCallbacks = useRef({});
  const canvasHandlers = useMemo(() => Object.fromEntries(CANVAS_HANDLER_NAMES.map(name => [name, (...args) => canvasCallbacks.current[name]?.(...args)])), []);
  useEffect(() => { interaction.current = { editing: Boolean(toolId) || busy, navigating: panning || spaceHeld }; }, [toolId, panning, spaceHeld, busy]);
  const onCamera = useStudioView({ documentId: draft.id, draftKey: draft.createKey, userId: session?.user?.id, ready, canvas });
  const selected = draft.layers.find(l => l.id === selectedId && l.visible);
  const references = useMemo(() => Array.isArray(draft.composer?.referenceIds)
    ? draft.composer.referenceIds.map(id => draft.layers.find(layer => layer.id === id)).filter(Boolean)
    : selected?.type === "image" ? [selected] : [], [draft.composer, draft.layers, selected]);
  const setComposer = value => update(d => {
    const composer = { ...d.composer, ...value };
    if (value.referenceIds) {
      const previous = d.composer?.referenceIds?.length ? d.composer.referenceIds : references.map(layer => layer.id);
      composer.referenceRoles = Object.fromEntries(value.referenceIds.map(id => [id, composer.referenceRoles?.[id] || "subject"]));
      if (value.text === undefined) composer.text = remapImageReferences(composer.text, previous, value.referenceIds);
      if (value.fixedPrompt === undefined) composer.fixedPrompt = remapImageReferences(composer.fixedPrompt, previous, value.referenceIds);
    }
    return { ...d, composer };
  });
  const effectiveSelection = useMemo(() => selectionIds.includes(selectedId) ? selectionIds.filter(id => draft.layers.some(l => l.id === id && l.visible)) : selectedId ? [selectedId] : [], [selectionIds, selectedId, draft.layers]);
  const ocrJobsKey = JSON.stringify(jobs.filter(job => job.tool === "ocr" && job.resultData?.ocr).map(job => [job.id, job.targetId]));
  const { ids: ocrJobIds, byTargetId: ocrJobsByTargetId } = useMemo(() => {
    const relevant = JSON.parse(ocrJobsKey);
    return {
      ids: new Set(relevant.map(([id]) => id)),
      byTargetId: new Map(relevant.map(([id, targetId]) => [targetId, id])),
    };
  }, [ocrJobsKey]);
  function selectLayer(id, additive = false) {
    const ids = Array.isArray(id) ? id : selectedLayerIds(draftRef.current.layers, effectiveSelection, id, additive);
    setSelectionIds(ids); setSelected(ids.at(-1) || null); closeTool();
  }
  const tool = getTool(toolId), toolStatus = capabilities?.tools.find(row => row.id === toolId);
  const activeModel = capabilities?.imageModels?.find(model => model.id === modelProvider);
  const referenceLimit = activeModel?.maxReferenceImages ?? 3;
  const pricesReady = Boolean(capabilities) && (!modelProvider || capabilities.imageProvider === modelProvider);
  const quickOffer = capabilities?.tools.find(row => row.id === (references.length ? "edit" : "generate"));
  const quickCost = imageCreditCost(pricesReady ? quickOffer || activeModel : activeModel, params.size);
  const toolCost = imageCreditCost(toolStatus || tool, params.size, 0);
  const remainingPlanCost = draft.plan?.expectedCosts ? draft.plan.expectedCosts.slice(draft.plan.index).reduce((sum, cost, index) => sum + (index === 0 && draft.plan.activeJob ? 0 : cost), 0) : draft.plan && pricesReady ? draft.plan.steps.slice(draft.plan.index).reduce((sum, step, index) =>
    sum + (index === 0 && draft.plan.activeJob ? 0 : imageCreditCost(capabilities.tools.find(row => row.id === step.tool) || getTool(step.tool), step.params.size, 0)), 0) : null;
  const commitLayers = useCallback(layers => {
    history.current.past = [...history.current.past, draftRef.current.layers].slice(-50); history.current.future = [];
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
  function retryResult(job) {
    setNotice(null); resultLoads.current.delete(job.id); collectResult(job).catch(() => {});
  }
  async function cancelJob(job) {
    try {
      await api(`/api/studio/jobs/${job.id}`, { method: "DELETE" });
      setJobs(current => current.map(row => row.id === job.id ? { ...row, cancelRequested: true } : row));
      setProjectLoad(value => value + 1);
    } catch (error) { notify(error); }
  }
  function scheduleFit(delay = 0) {
    clearTimeout(fitTimer.current);
    fitTimer.current = setTimeout(() => canvas.current?.fit(), delay);
  }
  const loadedProvider = useRef(undefined);
  useEffect(() => {
    const abort = new AbortController(); life.current = abort;
    if (session?.user?.id) {
      api("/api/usage", { signal: abort.signal }).then(setUsage).catch(e => { if (!abort.signal.aborted) notify(e); });
    } else loadedProvider.current = undefined;
    return () => { abort.abort(); clearTimeout(fitTimer.current); };
  }, [session?.user?.id, session?.user?.credits, notify]);
  useEffect(() => {
    if (!session?.user?.id || loadedProvider.current?.userId === session.user.id && loadedProvider.current?.provider === modelProvider) return;
    const abort = new AbortController();
    const query = new URLSearchParams(modelProvider ? { imageProvider: modelProvider } : {});
    api(`/api/studio/capabilities?${query}`, { signal: abort.signal }).then(caps => {
      if (abort.signal.aborted) return;
      const selected = modelProvider || caps.imageProvider || caps.imageModels?.[0]?.id || "";
      loadedProvider.current = { userId: session.user.id, provider: selected };
      setCapabilities(caps);
      setModelProvider(selected);
    }).catch(e => { if (!abort.signal.aborted) notify(e); });
    return () => abort.abort();
  }, [modelProvider, session?.user?.id, notify]);
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
    if (job.status !== "succeeded" || !jobBelongsToDocument(job, draftRef.current.id) || draftRef.current.appliedJobs?.includes(job.id)) return Promise.resolve();
    if (resultLoads.current.has(job.id)) return resultLoads.current.get(job.id);
    const task = (async () => {
    setResultStates(s => ({ ...s, [job.id]: "loading" }));
    // Confirm previews before applying the result. This async load does not
    // block editing/navigation, and failure keeps the original plus a retry
    // action without submitting another billed generation.
    await Promise.all(
      (job.resultData?.assets || [])
        .filter(asset => asset.contentType?.startsWith("image/"))
        .map(asset => loadImage(previewUrl(asset.id), { signal: life.current?.signal }))
    );
    const current = draftRef.current;
    if (!jobBelongsToDocument(job, current.id) || life.current?.signal.aborted || current.appliedJobs?.includes(job.id)) { resultLoads.current.delete(job.id); return; }
    // Opening a commerce project must not wait for its background save. Recover
    // completed sections with the same IDs and layout used by the commerce page.
    const layers = current.commerce && job.sectionId
      ? commerceContent(current, current.commerce, [], [job]).layers
      : appendResult(current.layers, job, current.layers.find(l => l.id === (job.canvasOrigin?.layerId || job.targetId)), current.taskPositions?.[job.id]);
    const messages = [...current.messages];
    if (job.origin === "chat" && !messages.some(m => m.id === job.id)) messages.push({ id: job.id, role: "assistant", text: job.resultData?.text || `${zh ? getTool(job.tool)?.zh : getTool(job.tool)?.en} · ${t("已完成", "Complete")}`, ...(job.resultData?.assets?.[0]?.contentType?.startsWith("image/") ? { assetId: job.resultData.assets[0].id } : {}) });
    if (job.resultData?.placement === "repair-background") {
      history.current.past = history.current.past.map(snapshot => appendResult(snapshot, job));
      history.current.future = history.current.future.map(snapshot => appendResult(snapshot, job));
    } else if (layers !== current.layers && (layers.length !== current.layers.length || layers.some((layer, index) => layer !== current.layers[index]))) {
      history.current.past = [...history.current.past, current.layers].slice(-50); history.current.future = [];
      setHistoryCount({ past: history.current.past.length, future: 0 });
    }
    update({ ...current, layers, messages, appliedJobs: [...(current.appliedJobs || []), job.id] });
    setResultStates(s => ({ ...s, [job.id]: "ready" }));
    const result = layers.find(layer => layer.sourceJobId === job.id && layer.visible);
    if (result && !current.composer?.text?.trim() && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) && !draftRef.current.pendingBatch && !interaction.current.editing && !interaction.current.navigating) {
      setSelected(result.id); setPanning(false); setTool(null); setMode("select"); setObjectSelection(null); canvas.current?.clearMask(); setMobileChat(false);
      clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => result.type === "text" ? canvas.current?.focusLayer(result.id) : canvas.current?.fit(), 100);
    }
    })().catch(error => {
      if (jobBelongsToDocument(job, draftRef.current.id) && error.name !== "AbortError") { setResultStates(s => ({ ...s, [job.id]: "failed" })); notify(error); }
      throw error;
    });
    resultLoads.current.set(job.id, task);
    // Keep failed loads until an explicit retry, but do not cache an applied
    // result forever: reopening an older saved project must recover its jobs.
    task.then(() => { if (resultLoads.current.get(job.id) === task) resultLoads.current.delete(job.id); }, () => {});
    return task;
  }, [update, draftRef, zh, t, notify, setPanning, setObjectSelection, setMobileChat]);
  useStudioJobs({ documentId: draft.id, ready, userId: session?.user?.id, revision: projectLoad, onJobs: setJobs, onResult: collectResult, onUsage: setUsage });
  const refreshCreationJobs = useCallback(job => {
    if (job?.id) setJobs(rows => [job, ...rows.filter(row => row.id !== job.id)]);
    setProjectLoad(value => value + 1);
  }, []);

  async function uploadFile(file) {
    if (!session?.user) throw new Error("UNAUTHORIZED");
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error(t("请选择 50 MB 以内的 PNG / JPG / WebP。", "Choose a PNG, JPG or WebP up to 50 MB."));
    return uploadImage(file);
  }
  function chooseLocalFiles(destination = "canvas") {
    uploadDestination.current = destination;
    fileInput.current?.click();
  }
  async function upload(files, destination = "canvas") {
    if (submission.current || busy || !ready || !files?.length) return;
    const scope = draftRef.current.createKey, signal = life.current?.signal;
    const limit = destination === "reference" ? Math.max(0, referenceLimit - references.length) : 12;
    if (!limit) { setNotice(t("参考图片数量已达上限，请先移除一张。", "Reference limit reached. Remove an image first.")); return; }
    const selectedFiles = Array.from(files).slice(0, limit);
    const feedback = uploadFeedback.start(selectedFiles);
    let firstUploaded = false;
    submission.current = true; setBusy(true);
    try {
      const results = await mapWithConcurrency(selectedFiles, 2, async (file, index) => {
        if (!feedback.isCurrent() || signal?.aborted || scope !== draftRef.current.createKey) return;
        feedback.update(index, "uploading");
        try {
          const asset = await uploadFile(file);
          if (!feedback.isCurrent() || signal?.aborted || scope !== draftRef.current.createKey) return;
          const current = draftRef.current.layers;
          const x = current.length ? Math.max(40, ...current.map(layer => layer.x + layer.width)) + 48 : 90;
          const size = scaleToFit(asset.width, asset.height, 480), id = requestKey();
          if (draftRef.current.nameSource === "fallback") update(d => ({ ...d, name: promptTitle(file.name.replace(/\.[^.]+$/, "")), nameSource: "upload" }));
          commitLayers([...current, { id, assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, opacity: 1, visible: true }]);
          if (destination === "reference") {
            const ids = draftRef.current.composer?.referenceIds?.length ? draftRef.current.composer.referenceIds : references.map(layer => layer.id);
            setComposer({ referenceIds: [...ids, id].slice(0, referenceLimit) });
          }
          if (!firstUploaded) { firstUploaded = true; setSelected(id); setMobileChat(destination === "reference"); scheduleFit(150); }
          feedback.update(index, "done");
        } catch (error) {
          feedback.update(index, "error", error.message);
          throw error;
        }
      });
      if (!feedback.isCurrent() || signal?.aborted || scope !== draftRef.current.createKey) return;
      const failure = results.find(result => result.status === "rejected");
      if (failure) notify(failure.reason);
    } catch (e) { notify(e); } finally {
      if (signal?.aborted || scope !== draftRef.current.createKey) feedback.cancel();
      submission.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = "";
    }
  }
  useEffect(() => {
    const paste = event => {
      if (event.defaultPrevented) return;
      const destination = imagePasteDestination(event.target);
      if (!destination) return;
      const files = clipboardImageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      if (!ready || busy || submission.current) {
        setNotice(t("正在处理，请稍后再粘贴图片。", "Please wait for the current operation before pasting images."));
        return;
      }
      void upload(files, destination);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
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
    if (libraryOpen === "tool") {
      setToolReferences(current => [...new Set([...current, ...items.map(item => item.assetId)])].filter(id => id !== selected?.assetId).slice(0, 2));
    } else if (libraryOpen === "reference") {
      setComposer({ referenceIds: [...references.map(layer => layer.id), ...layers.slice(-items.length).map(layer => layer.id)].slice(0, 3), text: prompt.replace(/[*@]$/, "") });
      setMobileChat(true);
    } else { setSelected(layers.at(-1)?.id); setMobileChat(false); scheduleFit(150); }
    setLibraryOpen(false);
  }
  async function openVideoSources(sources, referenceLayout) {
    if (!sources.length || busy) return;
    const source = sources[0], projectKey = draftRef.current.createKey;
    setBusy(true);
    try {
      const saved = await save();
      const child = await api("/api/video/canvas", { method: "POST", body: { documentId: saved.id, layerId: source.id, ...(sources.length > 1 ? { layerIds: sources.map(item => item.id), referenceLayout } : {}) } });
      if (draftRef.current.createKey !== projectKey) return;
      setCanvasVideo({ id: child.id, sourceId: source.id });
      setVideoSources(null); setPanning(false); setTool("video"); setMode("select");
    } catch (error) { notify(error); }
    finally { setBusy(false); }
  }
  async function chooseTool(id) {
    if (id === "video") {
      const sources = effectiveSelection.map(id => draft.layers.find(layer => layer.id === id)).filter(layer => layer?.type === "image");
      if (!sources.length || busy) return;
      if (sources.length > 1) { setVideoSources(sources); return; }
      await openVideoSources(sources); return;
    }
    focusSession.current++;
    setToolReferences([]); setAdjustments({}); setCompareOriginal(false);
    setParams(p => ({ ...p, focusPoints: undefined, preserveOutside: undefined, feather: undefined, newText: "", language: "en" }));
    clearTimeout(fitTimer.current);
    setPanning(false); setTool(id); canvas.current?.clearMask(); setObjectSelection(null);
    setMode(["focus", "adjust"].includes(id) ? id : id === "move" ? "object-select-rect" : id === "expand" ? "expand" : getTool(id)?.mask ? "mask" : id === "crop" ? "crop" : "select");
    if (id === "crop" && selected) setParams(p => ({ ...p, rect: { left: 0, top: 0, width: selected.pixelWidth, height: selected.pixelHeight } }));
    if (id === "upscale") setParams(p => ({ ...p, scale: capabilities?.tools.find(t => t.id === "upscale")?.supportedScales?.[0] || 2 }));
    if (id === "move") { setParams(p => ({ ...p, dx: 0, dy: 0, moveSource: undefined, moveTarget: undefined })); }
    if (id === "expand") {
      setParams(p => ({ ...p, padding: typeof p.padding === "number" ? { left: p.padding, right: p.padding, top: p.padding, bottom: p.padding } : p.padding }));
    }
    setOcr(null);
  }
  function addFocus(point) {
    setParams(p => ({ ...p, focusPoints: [...(p.focusPoints || []), { ...point, id: requestKey(), label: t("所选对象", "Selected object") }].slice(0, 10) }));
  }
  async function identifyFocus(point) {
    const scope = focusSession.current, project = draftRef.current.createKey;
    setParams(p => ({ ...p, focusPoints: p.focusPoints.map(item => item.id === point.id ? { ...item, loading: true } : item) }));
    try {
      const result = await api("/api/studio/focus", { method: "POST", key: requestKey(), body: { assetId: selected.assetId, x: point.x, y: point.y, language: zh ? "zh" : "en" } });
      if (scope === focusSession.current && project === draftRef.current.createKey) setParams(p => ({ ...p, focusPoints: p.focusPoints?.map(item => item.id === point.id ? { ...item, label: item.manual ? item.label : result.label, loading: false } : item) }));
      api("/api/usage").then(setUsage).catch(() => {});
    } catch (error) { if (scope === focusSession.current) { notify(error); setParams(p => ({ ...p, focusPoints: p.focusPoints?.map(item => item.id === point.id ? { ...item, loading: false } : item) })); } }
  }
  async function applyAdjustments() {
    if (submission.current) return;
    submission.current = true; setBusy(true);
    const target = selected, project = draftRef.current.createKey;
    try {
      const source = await loadImage(imageUrl(target.assetId));
      const result = adjustedImage(source, adjustments);
      const output = document.createElement("canvas"); output.width = target.pixelWidth; output.height = target.pixelHeight;
      output.getContext("2d").drawImage(result, 0, 0, output.width, output.height);
      const blob = await new Promise(resolve => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("IMAGE_EXPORT_FAILED");
      const asset = await uploadFile(new File([blob], "color.png", { type: "image/png" }));
      if (draftRef.current.createKey !== project) return;
      const id = requestKey();
      commitLayers([...draftRef.current.layers, { ...target, id, assetId: asset.assetId, sourceJobId: undefined, sourceLayerIds: [target.id], sourceAssetIds: [target.assetId], adjustments: undefined, name: `${target.name} · ${t("调色", "Color")}`, x: target.x + target.width + 48 }]);
      setSelected(id); closeTool(); scheduleFit(100);
    } catch (error) { notify(error); } finally { submission.current = false; setBusy(false); }
  }
  async function submit(id, target, text, options = {}, maskBlob, key = requestKey(), extracted, referenceAssetIds = [], origin = "canvas", quote = null) {
    const projectKey = draftRef.current.createKey;
    const assertCurrent = () => { if (draftRef.current.createKey !== projectKey) throw new Error("SESSION_CLOSED"); };
    const temporary = { id: `submit-${key}`, tool: id, assetId: target?.assetId, status: "submitting", origin, createdAt: new Date().toISOString() };
    setPendingTask(temporary);
    try {
    const saved = await save();
    assertCurrent();
    const maskHash = maskBlob ? await hashMask(maskBlob) : null;
    const provider = quote ? quote.provider : modelProvider;
    // Keep the intent signature compatible with pre-origin pending requests.
    // A retry reuses the original body/key instead of charging for a new job.
    const signature = JSON.stringify({ id, provider, extracted, referenceAssetIds, target: target?.id, asset: target?.assetId, text, options, maskHash, documentId: saved.id });
    const pending = draftRef.current.pendingSubmit;
    if (pending && pending.signature !== signature) throw new Error("IMAGE_SUBMISSION_UNCONFIRMED");
    let body;
    let maskId = extracted?.maskId;
    if (pending?.signature === signature) { body = { ...pending.body, documentVersion: saved.version }; key = pending.key; }
    else {
      if (maskBlob && !maskId) maskId = (await uploadFile(new File([maskBlob], "mask.png", { type: "image/png" }))).assetId;
      assertCurrent();
      body = { tool: id, origin, ...(quote ? { expectedCost: quote.cost } : capabilities?.tools.find(tool => tool.id === id) ? { expectedCost: imageCreditCost(capabilities.tools.find(tool => tool.id === id), options.size, 0) } : {}), ...(referenceAssetIds.length ? { referenceAssetIds } : {}), ...(provider ? { provider } : {}), ...(id === "move" && extracted?.objectAssetId ? { moveBundle: { objectAssetId: extracted.objectAssetId, holeAssetId: extracted.holeAssetId, bounds: extracted.bounds } } : {}), documentId: saved.id, documentVersion: saved.version, ...(target ? { targetId: target.id, assetId: target.assetId } : {}), ...(maskId ? { maskId } : {}), params: { ...options, prompt: text } };
      update(d => ({ ...d, pendingSubmit: { signature, key, body } }));
      await flushLocal();
    }
    const job = await api("/api/studio/jobs", { method: "POST", key, body, timeoutMs: 45000 });
    if (!job?.id) throw new Error("IMAGE_SUBMISSION_UNCONFIRMED");
    assertCurrent();
    update(d => confirmedImageSubmission(d, { key }, job));
    await flushLocal();
    setJobs(current => [job, ...current.filter(j => j.id !== job.id)]);
    setProjectLoad(value => value + 1);
    setPendingTask(null); return job;
    } catch (error) {
      if (draftRef.current.createKey === projectKey && submissionRejected(error)) {
        update(d => ({ ...d, pendingSubmit: null }));
        await flushLocal();
      }
      if (error.code === "PRICE_CHANGED") {
        await api(`/api/studio/capabilities?imageProvider=${encodeURIComponent(modelProvider)}`).then(setCapabilities).catch(() => {});
      }
      if (draftRef.current.createKey === projectKey) setPendingTask({ ...temporary, status: "failed", errorCode: error.code || error.message }); throw error; }
  }
  async function recoverImageSubmission() {
    const pending = draftRef.current.pendingSubmit, projectKey = draftRef.current.createKey;
    if (!pending || submission.current) return;
    submission.current = true; setBusy(true);
    try {
      const job = await api("/api/studio/jobs", { method: "POST", key: pending.key, body: pending.body, timeoutMs: 45000 });
      if (!job?.id) throw new Error("IMAGE_SUBMISSION_UNCONFIRMED");
      if (draftRef.current.createKey !== projectKey) return;
      update(d => confirmedImageSubmission(d, pending, job));
      await flushLocal();
      setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setProjectLoad(value => value + 1); setPendingTask(null);
    } catch (error) {
      if (draftRef.current.createKey === projectKey) {
        if (submissionRejected(error)) { update(d => ({ ...d, pendingSubmit: null })); await flushLocal(); }
        notify(error);
      }
    } finally { submission.current = false; setBusy(false); }
  }
  async function runTool() {
    if (!pricesReady || submission.current || (toolId === "move" && !objectSelection)) return;
    if (toolId === "move" && moveUnchanged) return;
    submission.current = true; setBusy(true);
    try {
      const mask = tool?.mask && !objectSelection?.region && !objectSelection?.maskId ? await canvas.current.maskBlob() : null;
      const target = selected;
      nameFromFirstPrompt(prompt);
      const options = { ...params, focusPoints: toolId === "focus" ? params.focusPoints?.map(({ id, x, y, label }) => ({ id, x, y, label })) : undefined, selectionMode: objectSelection?.region ? "region" : objectSelection ? "object" : "mask" };
      await submit(toolId, target, prompt, options, mask, requestKey(), objectSelection, ["merge", "inpaint"].includes(toolId) ? toolReferences : []);
      setPanning(false); setTool(null); setMode("select"); setPrompt(""); setObjectSelection(null); canvas.current?.clearMask();
      await save();
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  async function send(planned = false) {
    if (!ready || submission.current || !prompt.trim()) return;
    if (session?.user && !pricesReady) return;
    if (!session?.user) { notify("UNAUTHORIZED"); return; }
    if (draftRef.current.pendingSubmit) { notify(t("请先恢复上次提交，再开始新创作。", "Recover the previous submission before starting another.")); return; }
    const text = [fixedPrompt, prompt].filter(Boolean).join("\n"), target = references[0] || null, extraReferences = references.slice(1).map(layer => layer.assetId);
    const projectKey = draftRef.current.createKey;
    let composerCleared = false;
    submission.current = true; setBusy(true);
    try {
      if (text.length > 4000) throw new Error(t("固定提示词与描述合计不能超过 4000 字。", "The fixed prompt and description must total at most 4,000 characters."));
      if (text.includes(REMOVED_REFERENCE)) throw new Error(t("提示词引用的图片已移除，请修改标记后再生成。", "A referenced image was removed. Update the marked reference before generating."));
      if (references.length > referenceLimit) throw new Error(t(`当前模型最多支持 ${referenceLimit} 张参考图，请更换模型或移除部分引用。`, `This model supports ${referenceLimit} reference images. Change model or remove references.`));
      nameFromFirstPrompt(prompt);
      const signature = JSON.stringify({ text, size: params.size, target: target?.id, extraReferences, referenceRoles: draft.composer?.referenceRoles, modelProvider, tab, planned, outputCount });
      const messageId = draftRef.current.pendingMessage?.signature === signature ? draftRef.current.pendingMessage.id : requestKey();
      update(d => ({ ...d, pendingMessage: { signature, id: messageId } }));
      message("user", prompt, target?.assetId, messageId);
      // The sent message owns this text now. Clear before network work, and do
      // not clear again when a response arrives: the user may be writing next.
      setPrompt("");
      composerCleared = true;
      if (!planned) {
        const previous = draftRef.current.pendingBatch;
        const batch = previous?.signature === signature ? previous : { signature, keys: Array.from({ length: outputCount }, () => requestKey()), index: 0 };
        update(d => ({ ...d, pendingBatch: batch }));
        for (let i = batch.index; i < batch.keys.length; i++) {
          const previousText = tab === "chat" ? draftRef.current.messages.filter(m => m.role === "user" && m.id !== messageId).slice(-3).map(m => m.text).join("\n").slice(-Math.max(0, Math.min(1200, 3800 - text.length))) : "";
          const imagePrompt = previousText && text.length < 3800 ? `Conversation context (apply the latest request):\n${previousText}\nLatest request:\n${text}` : text;
          await submit(target ? "edit" : "generate", target, imagePrompt, { size: params.size, referenceRoles: references.map(layer => draft.composer?.referenceRoles?.[layer.id] || "subject") }, null, batch.keys[i], null, extraReferences, "chat");
          update(d => ({ ...d, pendingBatch: { ...batch, index: i + 1 } }));
        }
        update(d => ({ ...d, pendingBatch: null }));
      }
      else {
        const planned = await api("/api/studio/plan", { method: "POST", key: requestKey(), body: { size: params.size, ...(modelProvider ? { provider: modelProvider } : {}), prompt: text, referenceAssetIds: extraReferences, referenceRoles: references.map(layer => draft.composer?.referenceRoles?.[layer.id] || "subject"), ...(target ? { assetId: target.assetId } : {}), messages: draftRef.current.messages.slice(-6).map(m => ({ role: m.role, text: m.text.slice(0, 2000) })) } });
        update(d => ({ ...d, plan: { provider: planned.provider ?? modelProvider ?? null, ...(planned.expectedCosts ? { expectedCosts: planned.expectedCosts } : {}), referenceAssetIds: extraReferences, referenceRoles: references.map(layer => draft.composer?.referenceRoles?.[layer.id] || "subject"), summary: planned.summary, steps: planned.steps, credits: planned.credits, id: requestKey(), index: 0, targetId: target?.id || null, status: "ready", activeJob: null } }));
      }
      update(d => ({ ...d, pendingMessage: null }));
      api("/api/usage").then(setUsage).catch(() => {});
    } catch (e) {
      if (composerCleared && draftRef.current.createKey === projectKey) {
        update(d => d.composer?.text ? d : { ...d, composer: { ...d.composer, text: prompt } });
      }
      notify(e);
    } finally { submission.current = false; setBusy(false); }
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
    if (!pricesReady || submission.current || planExecution.current) return;
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
        try { job = p.activeJob ? { id: p.activeJob } : await submit(step.tool, target, step.params.prompt || "", { ...step.params, ...(getTool(step.tool).dependency === "image" && p.referenceRoles?.length ? { referenceRoles: p.referenceRoles } : {}) }, null, `${planId}-${index}-${p.attempt || 0}`, null, getTool(step.tool).dependency === "image" ? p.referenceAssetIds || [] : [], "chat", p.expectedCosts ? { provider: p.provider, cost: p.expectedCosts[index] } : null); }
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
  async function refreshPlanQuote() {
    const plan = draftRef.current.plan, projectKey = draftRef.current.createKey;
    if (!plan || plan.serverRunId || planRunning || busy || plan.activeJob) return;
    setBusy(true);
    try {
      const provider = plan.expectedCosts ? plan.provider : modelProvider;
      const current = await api(`/api/studio/capabilities${provider ? `?imageProvider=${encodeURIComponent(provider)}` : ""}`);
      const expectedCosts = plan.steps.map(step => {
        const offer = current.tools.find(tool => tool.id === step.tool);
        if (!offer?.available) throw new Error(offer?.reason || "TOOL_UNAVAILABLE");
        return imageCreditCost(offer, step.params.size, 0);
      });
      if (draftRef.current.createKey === projectKey) update(d => d.plan?.id === plan.id ? { ...d, pendingCreation: null, plan: { ...d.plan, provider: current.imageProvider || null, expectedCosts, credits: expectedCosts.reduce((sum, cost) => sum + cost, 0) } } : d);
    } catch (error) { notify(error); } finally { setBusy(false); }
  }
  function textLayer(text = t("双击创意，开始表达", "Make room for an idea"), placement) {
    const id = requestKey(); commitLayers([...draftRef.current.layers, { id, name: t("文字", "Text"), type: "text", x: 150, y: 180, width: 400, height: textLayerHeight(text, 400, 36), rotation: 0, visible: true, opacity: 1, text, fontSize: 36, ...placement }]); setSelected(id); setPanning(false); setTool(null); setMode("select");
  }
  async function openProject(id) {
    try {
      if (id === draftRef.current.id && saveState !== "conflict") { setProjects(null); return; }
      setProjects(null);
      await loadProject(id); setOcr(null);
      history.current = { past: [], future: [] }; setHistoryCount({ past: 0, future: 0 }); setSelected(null); setTool(null); setProjects(null); setJobs([]); setPendingTask(null);
      setMode("select"); setObjectSelection(null); canvas.current?.clearMask(); setProjectLoad(value => value + 1);
    } catch (e) { notify(e); }
  }
  async function newProject() {
    try {
      setProjects(null);
      await createProject(); setOcr(null);
      setSelected(null); setJobs([]); setPendingTask(null); setResultStates({}); setTool(null); setObjectSelection(null); setMode("select");
      setPrompt(""); setProjects(null); canvas.current?.clearMask();
      history.current = { past: [], future: [] }; setHistoryCount({ past: 0, future: 0 });
      scheduleFit();
    } catch (error) { notify(error); }
  }
  const closeOcr = useCallback(() => setOcr(null), [setOcr]);
  async function openOcr(value) {
    const projectKey = draftRef.current.createKey;
    let job = typeof value === "string" ? jobs.find(row => row.id === value && row.resultData?.ocr) : value;
    try { if (!job) job = await api(`/api/studio/jobs/${encodeURIComponent(value)}`); }
    catch (error) { notify(error); return; }
    if (!job.resultData?.ocr || draftRef.current.createKey !== projectKey) return;
    setSelected(job.targetId); setTool(null); setShowLayers(false); setMobileChat(false);
    setPanning(false); setMode("select"); setObjectSelection(null); canvas.current?.clearMask();
    setOcr({ ...job.resultData.ocr, targetId: job.targetId });
  }
  async function replaceText(box) {
    const source = draftRef.current.layers.find(layer => layer.id === ocr?.targetId);
    if (!source || !box.rect || submission.current) return;
    submission.current = true; setBusy(true);
    try {
      const mask = await canvas.current.maskBlob(box.rect);
      const job = await submit("erase", source, "Remove only the text in the mask. Preserve the background.", { size: params.size }, mask);
      const result = await waitJob(job.id);
      if (result.status !== "succeeded") throw new Error(result.errorCode || "EDIT_FAILED");
      const target = draftRef.current.layers.find(l => l.id === `${job.id}-0`), factor = target.width / source.pixelWidth;
      textLayer(box.text, { x: target.x + box.rect.left * factor, y: target.y + box.rect.top * factor, width: Math.max(40, box.rect.width * factor), height: Math.max(24, box.rect.height * factor), fontSize: Math.max(8, box.rect.height * factor * 0.8) });
      setOcr(null);
    } catch (e) { notify(e); } finally { submission.current = false; setBusy(false); }
  }
  const closeTool = () => {
    focusSession.current++; setCompareOriginal(false);
    setPanning(false); setTool(null); setMode("select"); setObjectSelection(null); canvas.current?.clearMask();
  };
  function useImageBaseline(layer) {
    setComposer({ referenceIds: [layer.id] }); setSelected(layer.id); setImagePreview(null); setMobileChat(true); setChatCollapsed(false);
  }
  async function reuseImageSettings(layer) {
    const projectKey = draftRef.current.createKey;
    try {
      const job = await api(`/api/studio/jobs/${layer.sourceJobId}?inputs=1`);
      if (projectKey !== draftRef.current.createKey) return;
      const input = job.input;
      if (!input || getTool(input.tool)?.dependency !== "image") throw new Error(t("这项工具没有可复用的生图参数。", "This operation has no image generation settings to reuse."));
      const ids = [input.assetId, ...(input.referenceAssetIds || [])].filter(Boolean);
      const next = [...draftRef.current.layers], references = [];
      for (const id of ids) {
        let reference = next.find(item => item.type === "image" && item.assetId === id);
        if (!reference) {
          const asset = input.referenceAssets?.find(item => item.id === id);
          if (!asset) throw new Error(t("原参考素材已不可用，请重新选择参考图。", "An original reference is unavailable. Choose references again."));
          reference = { id: requestKey(), assetId: id, type: "image", name: t("恢复的参考图", "Recovered reference"), ...scaleToFit(asset.width, asset.height, 480), pixelWidth: asset.width, pixelHeight: asset.height, x: Math.max(80, ...next.map(item => item.x + item.width)) + 50, y: layer.y, rotation: 0, visible: true, opacity: 1 };
          next.push(reference);
        }
        references.push(reference);
      }
      if (next.length !== draftRef.current.layers.length) commitLayers(next);
      setModelProvider(input.provider || "");
      setComposer({ text: input.params.prompt || "", size: input.params.size, referenceIds: references.map(item => item.id), referenceRoles: Object.fromEntries(references.map((item, index) => [item.id, input.params.referenceRoles?.[index] || "subject"])) });
      setSelected(references[0]?.id || null); setImagePreview(null); setMobileChat(true); setChatCollapsed(false);
    } catch (error) { notify(error); }
  }
  async function useCommerceBaseline(layer) {
    if (!session?.user?.id) { notify("UNAUTHORIZED"); return; }
    try {
      await save();
      const key = requestKey();
      sessionStorage.setItem(`commerce-start:${key}`, JSON.stringify({ owner: session.user.id, brief: { product: layer.name.slice(0, 80), description: "", language: zh ? "zh" : "en" }, product: { assetId: layer.assetId, width: layer.pixelWidth, height: layer.pixelHeight }, reference: null, message: "" }));
      router.push(`/commerce?draft=${key}`);
    } catch (error) { notify(error); }
  }
  function useTextPrompt(layer) {
    const text = [draftRef.current.composer?.text?.trim(), layer.text].filter(Boolean).join("\n");
    if (text.length > 4000) { notify(t("合并后超过 4000 字，请先精简画布文字或输入框内容。", "The combined prompt exceeds 4,000 characters. Shorten the canvas text or current prompt first.")); return; }
    setPrompt(text); setMobileChat(true); setChatCollapsed(false);
    requestAnimationFrame(() => document.querySelector(".ms-composer > textarea:not(.ms-fixed-prompt)")?.focus());
  }
  const openMessageImage = useCallback(assetId => {
    const layer = draftRef.current.layers.find(item => item.assetId === assetId);
    if (!layer) return;
    setSelected(layer.id);
    setMobileChat(false);
    setTimeout(() => canvas.current?.fit(), 100);
  }, [draftRef, setMobileChat]);
  const showMessageImage = useCallback(assetId => setImagePreview(assetId), [setImagePreview]);
  const ocrEntries = useMemo(() => draft.layers.filter(layer => layer.type === "image" && layer.visible).flatMap(layer => {
    const jobId = layer.ocrJobId || ocrJobsByTargetId.get(layer.id);
    return jobId ? [{ layerId: layer.id, jobId }] : [];
  }), [draft.layers, ocrJobsByTargetId]);
  const canvasMoveRegions = useMemo(() => toolId === "move" && objectSelection?.region ? { source: toolParams.moveSource, target: toolParams.moveTarget } : null, [toolId, objectSelection?.region, toolParams.moveSource, toolParams.moveTarget]);
  const canvasMoveOffset = useMemo(() => ({ dx: toolParams.dx, dy: toolParams.dy }), [toolParams.dx, toolParams.dy]);
  const canvasAdjustmentPreview = useMemo(() => toolId === "adjust" ? compareOriginal ? EMPTY_CANVAS_OBJECT : adjustments : null, [toolId, compareOriginal, adjustments]);
  // Refresh this latest-handler bridge on every commit while keeping the
  // functions passed into the memoized canvas stable between unrelated renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    canvasCallbacks.current = {
      onOpenOcr: openOcr,
      onUsePrompt: useTextPrompt,
      onSelect: selectLayer,
      onChange: commitLayers,
      onFocusPoint: addFocus,
      onViewport: canvasViewStore.setViewport,
      onCamera,
      onPreview: (assetId, image, type) => { if (type === "video") { setPreview(assetId); return; } setPreviewSeed({ assetId, image }); setImagePreview(assetId); },
      onMoveRegions: patch => setParams(current => ({ ...current, ...patch })),
      onMoveOffset: offset => setParams(current => ({ ...current, ...offset })),
      onMovePreparing: () => { setObjectSelection(null); setMode("object-preparing"); },
      onMoveReady: value => { setObjectSelection(value); setParams(current => ({ ...current, dx: 0, dy: 0, ...(value.region ? { moveSource: { ...value.bounds, rotation: 0 }, moveTarget: { ...value.bounds, rotation: 0 } } : {}) })); setMode(toolId === "inpaint" ? "object-edit" : "move"); },
      onMoveFailed: () => { setObjectSelection(null); setMode("object-select-rect"); },
      onCrop: rect => setParams(current => ({ ...current, rect })),
      onCropGrid: cropGrid => setParams(current => ({ ...current, cropGrid })),
      onMaskChange: setHasMask,
      onExpandPadding: padding => setParams(current => ({ ...current, padding })),
      onZoom: canvasViewStore.setZoom,
      onUpload: upload,
      onError: notify,
      onChooseTool: chooseTool,
      onCanvasChat: () => { if (!selected) return; setMobileChat(true); setChatCollapsed(false); setComposer({ referenceIds: [selected.id], text: prompt }); },
      onSaveToLibrary: () => selected?.type === "image" ? api("/api/library", { method: "POST", body: { assetId: selected.assetId, name: selected.name } }).then(() => setNotice(t("已保存到素材库", "Saved to asset library"))).catch(notify) : undefined,
    };
  });
  const ActiveToolIcon = toolId ? (ICONS[toolId] || Sparkles) : Sparkles;
  return <div className="ms-studio" data-history={historyCount.past}>
    <header className="ms-topbar">
      <Link href="/" className="ms-brand" aria-label="来塔绘梦"><BrandLogo /></Link>
      <span className="ms-top-divider" />
      <button className="ms-project-trigger" disabled={busy || !ready} onClick={() => setProjects(true)}><FolderOpen size={17} /><span>{draft.name === "Untitled" ? t("新建项目", "New project") : draft.name}<small>{saveState === "saving" ? t("正在保存…", "Saving…") : saveState === "retrying" ? t("连接波动，正在重试保存…", "Reconnecting, retrying save…") : saveState === "saved" ? t("已保存到云端", "Saved to cloud") : saveState === "error" ? (typeof navigator !== "undefined" && !navigator.onLine ? t("离线，修改已保存在此设备", "Offline — saved on this device") : t("保存失败，点击保存重试", "Save failed — retry")) : saveState === "conflict" ? t("版本冲突，本地修改已保留", "Conflict — local edits preserved") : saveState === "loading" ? t("正在打开…", "Opening…") : t("待同步到云端", "Waiting to sync")}</small></span><ChevronDown size={14} /></button>
      <RecentProjects zh={zh} onChoose={openProject} disabled={busy || !ready} userId={session?.user?.id} />
      <button className="ms-icon ms-new" title={t("新建项目", "New project")} disabled={busy || !ready} onClick={newProject}><Plus size={19} /></button>
      <div className="ms-top-actions">
        <button className="ms-button ms-save" data-action="save-studio" onClick={() => save().catch(notify)} disabled={busy || !ready}><Save size={15} />{t("保存", "Save")}</button>
        <button className="ms-button ms-export" onClick={() => setExportOpen(true)}><Download size={15} />{t("导出", "Export")}</button>
        <button onClick={recharge.open} className="ms-credit"><CreditIcon />{usage?.credits ?? "—"}<span>{t("积分", "credits")}</span></button>
        {session?.user ? <UserMenu user={session.user} /> : <Link href="/login" className="ms-button ms-primary">{t("登录", "Sign in")}</Link>}
      </div>
    </header>
    <div className={`ms-body ${chatCollapsed ? "chat-collapsed" : ""} ${mobileChat ? "show-chat" : "show-canvas"}`}>
      <aside className="ms-chat">
        <div className="ms-chat-heading"><span>{t("创作对话", "Creative chat")}</span><button type="button" className="ms-text-button" onClick={() => { setChatCollapsed(true); setMobileChat(false); }}>{t("展开画布", "Show canvas")}</button></div>
        <UploadFeedback items={uploadFeedback.items} onDismiss={uploadFeedback.dismiss} zh={zh} />
        <div className="ms-conversation">
          <StudioMessageHistory key={draft.id || draft.createKey} documentId={draft.id} messages={draft.messages} zh={zh} onError={notify} onImage={showMessageImage} />
          {!draft.messages.length && !jobs.some(job => job.origin === "chat") && pendingTask?.origin !== "chat" && <div className="ms-welcome">
            <div className="ms-orb"><BrandMark size={31} /></div><h1>{t("想象一下，然后实现它。", "Imagine it. Make it real.")}</h1>
            <p>{t("描述画面，上传灵感。和 AI 一起，让每个想法变成作品。", "Describe a scene. Bring a reference. Give your next idea a place to grow.")}</p>
            <div className="ms-suggestions">{[t("为我的商品设计一张自然光海报", "Create a natural-light product poster"), t("把这张图片变成电影感的画面", "Give this image a cinematic look"), t("帮我拆分主体和背景", "Separate the subject and background")].map((text, i) => <button key={text} onClick={() => { setPrompt(text); if (i === 2 && selected) chooseTool("split"); }}><span>{text}</span><ArrowUpRight size={15} /></button>)}</div>
            <span className="ms-model-note"><span className="ms-status-dot" />{t("每一步编辑，都保留原图", "Every edit keeps your original")}</span>
          </div>}
          <StudioMessageList messages={draft.messages} jobsById={ocrJobIds} zh={zh} onOpenOcr={canvasHandlers.onOpenOcr} onImage={openMessageImage} />
          {draft.plan && !draft.plan.serverRunId && <div className="ms-plan"><small>{t("计划固定使用模型：", "Plan model: ")}{draft.plan.provider || t("默认通道", "Default channel")}{t("；当前草稿切换模型不会改变此计划。价格变化时刷新报价，再确认执行。", "; changing the draft model will not change this plan. Refresh a changed quote before confirming.")}</small><button type="button" disabled={busy || planRunning || Boolean(draft.plan.activeJob) || Boolean(draft.pendingCreation)} onClick={refreshPlanQuote}>{t("刷新计划报价", "Refresh plan quote")}</button></div>}
          {draft.plan && (draft.plan.serverRunId || capabilities?.creationRunsAvailable && !draft.plan.index && !draft.plan.activeJob && draft.plan.status !== "complete") && <DurablePlanPanel key={`${draft.id || draft.createKey}:${draft.plan.id}`} plan={draft.plan} draftRef={draftRef} save={save} update={update} flushLocal={flushLocal} provider={draft.plan.provider ?? modelProvider} estimatedCost={remainingPlanCost} pricesReady={Boolean(draft.plan.expectedCosts) || pricesReady} disabled={busy || !ready} onJobsChanged={refreshCreationJobs} onError={notify} zh={zh} />}
          {draft.plan && !(draft.plan.serverRunId || capabilities?.creationRunsAvailable && !draft.plan.index && !draft.plan.activeJob && draft.plan.status !== "complete") && <div className="ms-plan"><span className="ms-eyebrow"><Sparkles size={13} />{t("创作计划", "CREATIVE PLAN")}</span><p>{draft.plan.summary}</p>{draft.plan.steps.map((step, i) => <div className="ms-plan-step" key={i}><span>{i < draft.plan.index ? <Check size={13} /> : i + 1}</span><div>{zh ? getTool(step.tool)?.zh : getTool(step.tool)?.en}<small>{step.explanation}</small></div></div>)}<button className="ms-button ms-primary" disabled={busy || planRunning || !pricesReady || draft.plan.status === "complete"} onClick={runPlan}>{draft.plan.status === "complete" ? t("已完成", "Complete") : draft.plan.index ? t("继续执行", "Continue") : t("确认并执行", "Run plan")}<span>{t("剩余预计", "Remaining")} {remainingPlanCost ?? "—"} {t("积分", "credits")}</span></button><button className="ms-text-button" disabled={busy || planRunning} onClick={() => update(d => ({ ...d, plan: null }))}>{t("移除计划", "Dismiss plan")}</button></div>}
        </div>
        <div className="ms-composer">
          {(prompt + fixedPrompt).includes(REMOVED_REFERENCE) && <p role="alert">{t("素材编号已同步；已移除的图片用 [removed-reference] 标出，请修改后生成。", "Reference numbers were updated. Replace [removed-reference] before generating.")}</p>}
          {outputCount > 1 && <small>{t("多张为独立变体。连贯套图请选定满意图片作为基准后继续创作。", "Multiple outputs are independent variants. Choose a favorite as the reference for a consistent series.")}</small>}
          {draft.pendingSubmit && <div role="status" className="ms-plan"><p>{t("上次提交结果尚未确认。先恢复原请求，再开始新的生成；当前草稿会保留。", "The last submission is unconfirmed. Recover it before generating again; your current draft is preserved.")}</p><button type="button" className="ms-button" disabled={busy || !ready} onClick={recoverImageSubmission}>{t("恢复原提交", "Recover submission")}</button></div>}
          {references.length > 0 && <div className="ms-reference-list">{references.map((layer, index) => <div key={layer.id} className="ms-reference"><Image unoptimized width={64} height={64} src={previewUrl(layer.assetId, 320)} alt="" /><span>{index + 1} · {layer.name}</span><select aria-label={t(`参考图 ${index + 1} 的用途`, `Role of reference ${index + 1}`)} value={draft.composer?.referenceRoles?.[layer.id] || "subject"} onChange={event => setComposer({ referenceRoles: Object.fromEntries(references.map(item => [item.id, item.id === layer.id ? event.target.value : draft.composer?.referenceRoles?.[item.id] || "subject"])) })}>{IMAGE_REFERENCE_ROLES.map(role => <option key={role} value={role}>{IMAGE_REFERENCE_LABELS[role][zh ? 0 : 1]}</option>)}</select><button className="ms-icon" title={t("取消引用", "Clear reference")} onClick={() => { setComposer({ referenceIds: references.filter(item => item.id !== layer.id).map(item => item.id) }); if (layer.id === selectedId) setSelected(null); }}><X size={13} /></button></div>)}</div>}
          {referencePicker && <div className="ms-reference-picker"><header>{t("引用项目图片", "Reference project images")}<button className="ms-icon" aria-label={t("关闭图片选择", "Close image picker")} onClick={() => setReferencePicker(false)}><X size={14} /></button></header><div>{draft.layers.filter(layer => layer.type === "image").map(layer => <button key={layer.id} title={layer.name} disabled={references.length >= referenceLimit && !references.some(item => item.id === layer.id)} onClick={() => { setComposer({ referenceIds: [...new Set([...references.map(item => item.id), layer.id])], text: prompt.replace(/@$/, "") }); setReferencePicker(false); }}><Image unoptimized width={70} height={70} src={previewUrl(layer.assetId, 320)} alt={layer.name} /></button>)}</div><button className="ms-text-button" disabled={busy || !ready || references.length >= referenceLimit} onClick={() => { setReferencePicker(false); chooseLocalFiles("reference"); }}>{t("从电脑上传", "Upload from computer")}</button><button className="ms-text-button" onClick={() => { setReferencePicker(false); setLibraryOpen("reference"); }}>{t("从素材库选择", "Choose from asset library")}</button></div>}
          {fixedOpen && <textarea className="ms-fixed-prompt" aria-label={t("固定提示词", "Fixed prompt")} placeholder={t("每次生成都会附加这段要求…", "Include these instructions with each generation…")} value={fixedPrompt} maxLength={2000} onChange={e => setComposer({ fixedPrompt: e.target.value })} />}
          <AutoGrowTextarea disabled={!ready} data-image-paste="reference" aria-label={t("创作描述", "Creative prompt")} value={prompt} onChange={e => { setPrompt(e.target.value); if (e.target.value.endsWith("@")) setReferencePicker(true); if (e.target.value.endsWith("*")) setLibraryOpen("reference"); }} placeholder={t("描述你想要的画面，或选择图片继续修改…", "Describe an image, or select one to keep editing…")} maxLength={4000} onKeyDown={e => { if (!e.nativeEvent.isComposing && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
          <div className="ms-composer-tools"><button className="ms-icon" title={t("添加参考图", "Add reference")} disabled={busy} onClick={() => setReferencePicker(value => !value)}><ImagePlus size={19} /></button><button className={`ms-icon ${fixedPrompt ? "active" : ""}`} title={t("固定提示词", "Fixed prompt")} aria-pressed={fixedOpen} onClick={() => setFixedOpen(value => !value)}><Type size={16} /></button><ModelPicker size={params.size} models={capabilities?.imageModels || []} value={modelProvider} onChange={setModelProvider} zh={zh} disabled={busy} emptyLabel={t("暂无可用生图模型", "No image model configured")} /><ImageSizePicker value={params.size} onChange={size => { setParams(p => ({ ...p, size })); setComposer({ size }); }} zh={zh} disabled={busy} source={references[0] ? { width: references[0].pixelWidth, height: references[0].pixelHeight } : null} /><CountPicker label={t("生成张数", "Output count")} value={outputCount} onChange={value => setComposer({ outputCount: value })} unitCost={quickCost} zh={zh} disabled={busy} /></div>
          <div className="ms-composer-footer"><small className="ms-composer-hint"><PromptOptimizer compact key={draft.createKey} prompt={prompt} disabled={busy || !ready} available={capabilities?.planningAvailable} cost={capabilities?.planningCost ?? 1} zh={zh} onApply={setPrompt} onCharged={() => api("/api/usage").then(setUsage).catch(() => {})} />{tab === "chat" && <button className="ms-text-button" disabled={busy || !ready || !prompt.trim() || !capabilities?.planningAvailable} onClick={() => send(true)} aria-label={t(`生成计划 · ${capabilities?.planningCost ?? 1} 积分`, `Create plan · ${capabilities?.planningCost ?? 1} credits`)} title={t("将复杂需求拆成多个步骤，先查看计划和费用", "Plan a multi-step task and review its cost first")}>{t(`计划 · ${capabilities?.planningCost ?? 1}`, `Plan · ${capabilities?.planningCost ?? 1}`)}</button>}</small><button className="ms-send" disabled={busy || !ready || (Boolean(session?.user) && !pricesReady) || !prompt.trim()} onClick={() => send()} aria-label={t(`生成 · ${quickCost * outputCount} 积分`, `Generate · ${quickCost * outputCount} credits`)} title={t(`生成 · ${quickCost * outputCount} 积分`, `Generate · ${quickCost * outputCount} credits`)}>{busy ? <LoaderCircle className="ms-spin" size={18} /> : <ArrowUp size={18} />}<span className="generation-price" aria-label={t(`${quickCost * outputCount} 积分`, `${quickCost * outputCount} credits`)}><CreditIcon size={13} />{quickCost * outputCount}</span></button></div>
        </div>
      </aside>
      <main className="ms-canvas-space">
        <UploadFeedback items={uploadFeedback.items} onDismiss={uploadFeedback.dismiss} zh={zh} floating />
        {!ready && (switching || saveState === "loading") && <div className="ms-project-loading" role="status"><span><LoaderCircle className="ms-spin" size={16} />{switching && saveState !== "loading" ? t("正在保存当前修改，随后切换项目…", "Saving changes before switching projects…") : t("正在打开项目…", "Opening project…")}</span></div>}
        {saveState === "load-error" && <div className="ms-save-conflict" role="alert"><span>{t("项目暂时无法打开，已有草稿仍保留在此设备", "The project could not be opened. Existing drafts remain on this device.")}</span><button onClick={retryLoad}>{t("重试打开", "Retry opening")}</button></div>}
        <div className="ms-canvas-import"><button type="button" className="ms-button" disabled={busy || !ready} onClick={() => chooseLocalFiles()}><ImagePlus size={17} />{t("本地上传", "Upload from computer")}</button><button type="button" className="ms-button" disabled={busy || !ready} onClick={() => setLibraryOpen(true)}><FolderOpen size={17} />{t("素材库", "Asset library")}</button></div>
        {saveState === "conflict" && <div className="ms-save-conflict" role="alert"><span>{t("云端项目已更新，本地修改已保留", "The cloud project changed. Your local edits are preserved.")}</span><button onClick={() => save(true).catch(notify)}>{t("另存为新项目", "Save as new project")}</button><button onClick={() => reloadCloud().catch(notify)}>{t("打开云端版本", "Open cloud version")}</button></div>}
        <StudioActivity key={draft.createKey} jobs={jobs} pending={pendingTask} appliedJobs={draft.appliedJobs} resultStates={resultStates} zh={zh}
          onRetry={retryResult} onCancel={cancelJob} />
        <StudioTaskPopover key={`${draft.createKey}:${draft.id || "new"}`} documentId={draft.id} jobs={jobs} pending={pendingTask} appliedJobs={draft.appliedJobs} resultStates={resultStates} zh={zh}
          onRetry={retryResult} onCancel={cancelJob} onViewText={openOcr} onLocate={job => {
            const layer = draft.layers.find(item => item.sourceJobId === job.id && item.visible);
            if (layer) { selectLayer(layer.id); setMobileChat(false); canvas.current?.focusLayer(layer.id); }
          }} />
        {chatCollapsed && <button className="ms-icon ms-chat-restore" title={t("展开聊天", "Open chat")} onClick={() => { setChatCollapsed(false); setMobileChat(true); }}><PanelLeftOpen size={18} /></button>}
        <Canvas ref={canvas} taskPositions={draft.taskPositions} jobs={canvasJobs} appliedJobs={draft.appliedJobs} projectKey={draft.createKey} readOnly={!ready} ocrEntries={ocrEntries} onOpenOcr={canvasHandlers.onOpenOcr} onUsePrompt={canvasHandlers.onUsePrompt} layers={draft.layers} selectedId={selectedId} selectedIds={effectiveSelection} onSelect={canvasHandlers.onSelect} onChange={canvasHandlers.onChange} mode={mode} brushSize={brush}
          selectionTool={toolId} editPadding={params.editPadding} focusPoints={params.focusPoints || EMPTY_CANVAS_ARRAY} onFocusPoint={canvasHandlers.onFocusPoint} adjustmentPreview={canvasAdjustmentPreview}
          zh={zh} onViewport={canvasHandlers.onViewport} onCamera={canvasHandlers.onCamera} onPreview={canvasHandlers.onPreview}
          moveRegions={canvasMoveRegions} onMoveRegions={canvasHandlers.onMoveRegions}
          cropRect={params.rect} cropShape={params.cropShape} cropGrid={params.cropGrid} onCropGrid={canvasHandlers.onCropGrid} onMaskChange={canvasHandlers.onMaskChange} panning={panning || spaceHeld} moveOffset={canvasMoveOffset} onMoveOffset={canvasHandlers.onMoveOffset} onMovePreparing={canvasHandlers.onMovePreparing} onMoveReady={canvasHandlers.onMoveReady} onMoveFailed={canvasHandlers.onMoveFailed}
          onCrop={canvasHandlers.onCrop} expandPadding={params.padding} onExpandPadding={canvasHandlers.onExpandPadding}
          onZoom={canvasHandlers.onZoom} onUpload={canvasHandlers.onUpload} onError={canvasHandlers.onError} label={t("图片编辑画布", "Image editing canvas")} />
        {effectiveSelection.length > 0 && (showLayers || effectiveSelection.length > 1) && !toolId && <LayerSelectionTools layers={draft.layers} ids={effectiveSelection} onChange={commitLayers} zh={zh} disabled={busy} />}
        <div className="ms-canvas-label"><span className="ms-status-dot" />{t("自由画布", "FREE CANVAS")}<span> / </span>{draft.layers.length} {t("个图层", "layers")}</div>
        {!draft.layers.length && <div className="ms-empty-canvas"><div className="ms-empty-art"><div className="ms-art-frame back"><Image unoptimized width={480} height={480} loading="eager" src="/inspiration/thumbs/cocoa-splash.8fe5e3931d67-480.webp" alt="" /></div><div className="ms-art-frame front"><Image unoptimized width={480} height={480} loading="eager" src="/inspiration/thumbs/sneaker-chrome.209c06fb2093-480.webp" alt="" /><span><Sparkles size={12} />{t("AI 生成", "Made with AI")}</span></div><span className="ms-art-cross one">+</span><span className="ms-art-cross two">+</span></div><h2>{t("你的下一幅作品，从这里开始", "A blank canvas. Endless possibilities.")}</h2><p>{t("在左侧描述画面直接生成，或上传、拖入、Ctrl / ⌘ + V 粘贴一张图开始编辑", "Describe a scene on the left to generate, or upload, drop or paste an image to edit")}</p><button className="ms-button ms-primary" disabled={busy || !ready} onClick={() => chooseLocalFiles()}><Plus size={17} />{t("上传第一张图片", "Upload your first image")}</button><small>PNG · JPG · WEBP · 50 MB</small></div>}
        <div className="ms-canvas-top-right">{effectiveSelection.length > 1 && effectiveSelection.every(id => draft.layers.find(layer => layer.id === id)?.type === "image") && <button className="ms-button" disabled={busy || !ready} onClick={() => chooseTool("video")}><Video size={16} />{t("生成视频", "Create video")}</button>}<button className={`ms-icon ${showLayers ? "active" : ""}`} title={t("图层", "Layers")} onClick={() => setShowLayers(!showLayers)}><Layers3 size={18} /></button></div>
        <StudioCanvasOverlays store={canvasViewStore} selected={selected} zh={zh} toolId={toolId} showLayers={showLayers} ocr={ocr} size={params.size} capabilities={capabilities} singleSelection={effectiveSelection.length === 1} onChoose={canvasHandlers.onChooseTool} onChat={canvasHandlers.onCanvasChat} onSave={canvasHandlers.onSaveToLibrary} />
        {toolId === "adjust" && selected && <AdjustmentPanel value={adjustments} onChange={setAdjustments} zh={zh} onApply={applyAdjustments} onClose={closeTool} onCompare={setCompareOriginal} busy={busy} />}
        {toolId === "video" && canvasVideo && <CanvasVideoPanel key={canvasVideo.id} documentId={canvasVideo.id} userId={session?.user?.id} zh={zh} onClose={closeTool} onSubmitted={refreshCreationJobs} />}
        {toolId && !["adjust", "video"].includes(toolId) && selected && <ToolPanel tool={tool} Icon={ActiveToolIcon} status={toolStatus} selected={selected} params={params} onParams={patch => { setParams(p => ({ ...p, ...patch })); if (patch.size) setComposer({ size: patch.size }); }}
          prompt={prompt} onPrompt={setPrompt} brush={brush} onBrush={setBrush} hasMask={hasMask} selection={objectSelection} busy={busy || !pricesReady} moveUnchanged={moveUnchanged} cost={toolCost} zh={zh}
          referenceLayers={draft.layers.filter(l => l.type === "image" && l.assetId !== selected.assetId)} selectedReferences={toolReferences} onReferences={setToolReferences} onAddReferences={() => setLibraryOpen("tool")} onIdentify={identifyFocus} identifyCost={capabilities?.planningCost ?? 1} canIdentify={capabilities?.planningAvailable}
          onClose={closeTool} onRun={runTool} onReset={() => {
            if (toolId === "move") { canvas.current.clearMovePreview(); setObjectSelection(null); setMode("object-select-rect"); }
            else if (["inpaint", "erase", "text-edit"].includes(toolId)) canvas.current.clearMask();
            else if (toolId === "crop") setParams(p => ({ ...p, rect: { left: 0, top: 0, width: selected.pixelWidth, height: selected.pixelHeight }, cropShape: "rectangle", cropGrid: undefined }));
            else if (toolId === "expand") setParams(p => ({ ...p, padding: { left: 256, right: 256, top: 256, bottom: 256 } }));
          }} />}
        {selected?.type === "video" && <div className="ms-tool-panel"><div className="ms-panel-title">{t("视频作品", "Video result")}</div>{selected.videoDocumentId && <Link className="ms-button" href={`/video?document=${selected.videoDocumentId}`}>{t("继续制作视频", "Continue in video workspace")}</Link>}<button className="ms-button ms-primary" onClick={() => setPreview(selected.assetId)}><Play size={15} />{t("播放视频", "Play video")}</button><a className="ms-button" href={imageUrl(selected.assetId)} download="letai-video.mp4"><Download size={15} />{t("下载 MP4", "Download MP4")}</a><VideoResultActions key={selected.assetId} result={selected} zh={zh} onMedia={media => update(current => ({ ...current, layers: current.layers.map(layer => layer.assetId === media.id ? { ...layer, posterAssetId: media.posterAssetId, duration: media.duration, pixelWidth: media.width, pixelHeight: media.height } : layer) }))} /></div>}
        {ocr && <OcrResultPanel result={ocr} zh={zh} cost={imageCreditCost(capabilities?.tools.find(c => c.id === "erase"), params.size)} canReplace={!busy && selected?.id === ocr.targetId && !!capabilities?.tools.find(c => c.id === "erase")?.available} onChange={setOcr} onReplace={replaceText} onClose={closeOcr} onError={notify} />}
        {showLayers && <div className="ms-layers"><div className="ms-panel-title">{t("图层", "Layers")}<span>{draft.layers.length}</span></div>{draft.layers.toReversed().map(layer => <div className={`ms-layer ${selectedId === layer.id ? "selected" : ""}`} key={layer.id}><button className="ms-layer-select" onClick={e => selectLayer(layer.id, e.shiftKey)}>{layer.type === "image" ? <Image unoptimized width={480} height={480} src={previewUrl(layer.assetId, 320)} alt="" /> : layer.type === "text" ? <Type size={18} /> : <Video size={18} />}<span>{layer.locked ? "▣ " : ""}{layer.name}</span></button><button className="ms-icon" title={t("显示/隐藏", "Show/hide")} onClick={() => commitLayers(draft.layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l))}>{layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button></div>)}{selected && <div className="ms-layer-actions"><button className="ms-icon" title={t("上移一层", "Raise layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i < list.length - 1) { [list[i], list[i + 1]] = [list[i + 1], list[i]]; commitLayers(list); } }}><ArrowUp size={15} /></button><button className="ms-icon" title={t("下移一层", "Lower layer")} onClick={() => { const list = [...draft.layers], i = list.findIndex(l => l.id === selectedId); if (i > 0) { [list[i], list[i - 1]] = [list[i - 1], list[i]]; commitLayers(list); } }}><ArrowDown size={15} /></button><button className="ms-icon" title={t("复制图层", "Duplicate layer")} onClick={() => commitLayers([...draft.layers, { ...selected, id: requestKey(), x: selected.x + 24, y: selected.y + 24 }])}><Copy size={15} /></button><button className="ms-icon" title={t("删除图层", "Delete layer")} disabled={selected.locked} onClick={() => { commitLayers(draft.layers.filter(l => l.id !== selectedId)); setSelected(null); }}><Trash2 size={15} /></button></div>}</div>}
        <div className="ms-bottom-toolbar">{[["select", MousePointer2, t("选择", "Select")], ["hand", Hand, t("平移", "Pan")]].map(([id, Icon, title]) => <button key={id} className={`ms-icon ${(id === "hand" ? panning : !panning) ? "active" : ""}`} title={title} aria-pressed={id === "hand" ? panning : !panning} onClick={() => setPanning(id === "hand")}><Icon size={20} /></button>)}<span /><button className="ms-icon" title={t("上传图片", "Upload image")} disabled={busy || !ready} onClick={() => chooseLocalFiles()}><ImagePlus size={20} /></button><button type="button" className="ms-icon" title={t("添加文字", "Add text")} disabled={busy || !ready} onClick={() => textLayer()}><Type size={20} /></button><span /><button className="ms-icon" data-action="undo" title={t("撤销", "Undo")} disabled={!historyCount.past} onClick={() => undo()}><Undo2 size={19} /></button><button className="ms-icon" data-action="redo" title={t("重做", "Redo")} disabled={!historyCount.future} onClick={() => undo(true)}><Redo2 size={19} /></button></div>
        <StudioZoomControls store={canvasViewStore} canvas={canvas} zh={zh} previewEnabled={selected?.type === "image"} onPreview={() => { if (selected?.type === "image") setImagePreview(selected.assetId); }} />
      </main>
    </div>
    <button className="ms-mobile-toggle" onClick={() => { setChatCollapsed(false); setMobileChat(!mobileChat); }}>{mobileChat ? <Layers3 size={17} /> : <PanelLeftOpen size={17} />}{mobileChat ? t("画布", "Canvas") : t("对话", "Chat")}</button>
    <input className="ms-file-input" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label={t("上传图片文件", "Upload image files")} onChange={e => upload(e.target.files, uploadDestination.current)} />
    {notice && <div className="ms-notice" role="alert"><span>{notice}</span><button className="ms-icon" title={t("关闭提示", "Dismiss")} onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {exportOpen && <DeferredTool label={t("导出作品", "Export artwork")} onClose={() => setExportOpen(false)}><StudioExportDialog zh={zh} selected={selected && selected.type !== "video"} onClose={() => setExportOpen(false)} onExport={options => canvas.current.exportImage({ ...options, name: draft.name })} /></DeferredTool>}
    {projects && <ProjectManager key={session?.user?.id || "guest"} userId={session?.user?.id} locale={locale} kinds={["canvas"]} currentId={draft.id} ready={ready} editor={{ draft, update, save, onError: notify }} creates={[{ label: t("新建画布", "New canvas"), onClick: newProject }]} onChoose={row => openProject(row.id)} onClose={() => setProjects(null)} />}
    {videoSources && <CanvasVideoSourceDialog sources={videoSources} zh={zh} busy={busy} onClose={() => setVideoSources(null)} onConfirm={openVideoSources} />}
    {libraryOpen && <Modal label={t("选择素材", "Choose assets")} className="ml-picker-dialog" onClose={() => setLibraryOpen(false)}><button className="ms-icon" title={t("关闭", "Close")} onClick={() => setLibraryOpen(false)}><X size={18} /></button><AssetLibrary maxSelection={libraryOpen === "tool" ? Math.max(0, 2 - toolReferences.length) : libraryOpen === "reference" ? Math.max(0, referenceLimit - references.length) : 10} onSelect={importLibrary} /></Modal>}
    {imagePreview && <DeferredTool label={t("图片预览", "Image preview")} onClose={() => setImagePreview(null)}><StudioImageViewer assetId={imagePreview} initialImage={previewSeed?.assetId === imagePreview ? previewSeed.image : null} layers={draft.layers.filter(layer => layer.type === "image")} zh={zh} onCommerce={useCommerceBaseline} onReuse={reuseImageSettings} onVariation={useImageBaseline} onSelect={setImagePreview} onClose={() => setImagePreview(null)} /></DeferredTool>}
    {preview && <Modal className="ms-video-modal" label={t("视频预览", "Video preview")} onClose={() => setPreview(null)}><header className="ms-video-head"><strong>{draft.layers.find(layer => layer.assetId === preview)?.name || t("视频预览", "Video preview")}</strong><button className="ms-icon" title={t("关闭视频", "Close video")} onClick={() => setPreview(null)}><X size={18} /></button></header><VideoPlayer key={preview} src={imageUrl(preview)} poster={draft.layers.find(layer => layer.assetId === preview)?.posterAssetId ? previewUrl(draft.layers.find(layer => layer.assetId === preview).posterAssetId, 1280) : undefined} downloadHref={`${imageUrl(preview)}?download=1`} autoPlay zh={zh} /></Modal>}
  </div>;
}
