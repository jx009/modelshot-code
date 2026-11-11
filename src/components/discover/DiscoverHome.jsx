"use client";
import { uploadImage } from "@/lib/upload-image";
import { clipboardImageFiles, imagePasteDestination } from "@/lib/studio/image-paste";
import Image from "@/components/studio/AssetImage";
import CreditIcon from "@/components/ui/CreditIcon";
import "@/components/studio/generation-price.css";
import { imageCreditCost } from "@/lib/studio/image-pricing";
import { BrandMark } from "@/components/BrandLogo";
import { previewUrl } from "@/lib/studio/image-url";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useSession } from "next-auth/react";
import { api, requestKey } from "@/lib/client-api";
import { promptTitle } from "@/lib/studio/project-title";
import { scaleToFit } from "@/lib/studio/canvas-utils";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { useUploadFeedback } from "@/hooks/useUploadFeedback";
import UploadFeedback from "@/components/ui/UploadFeedback";
import { useLocale } from "next-intl";
import { usePageVisible } from "@/components/ui/LocalNavigation";
import { clearImageCapabilities, readImageCapabilities } from "@/lib/studio/image-capabilities-client";
import { useNavigationRouter as useRouter } from "@/hooks/useNavigationRouter";
import Link from "@/components/ui/NavigationLink";
import { ArrowUp, ArrowUpRight, MessageCircle, ShoppingBag, ImagePlus, Image as ImageIcon, PanelsTopLeft, Presentation, FileText, Table2, Globe2, WandSparkles, X, Type, LoaderCircle, Clapperboard, Video } from "lucide-react";
import ModelPicker from "@/components/ui/ModelPicker";
import ImageSizePicker from "@/components/ui/ImageSizePicker";
import CreationLauncher from "./CreationLauncher";
import VideoLauncher from "@/components/video/VideoLauncher";
import dynamic from "next/dynamic";
import "./home-composer.css";
const CommerceLauncher = dynamic(() => import("./CommerceLauncher"));
const InspirationGallery = dynamic(() => import("./InspirationGallery"), {
  loading: () => <section id="inspiration" className="cr-inspiration ig-section" aria-hidden="true"><p className="route-loading-text">正在加载灵感作品…</p></section>,
});

export default function DiscoverHome() {
  const auth = useAuth();
  const visible = usePageVisible();
  const activePage = useRef(visible);
  useEffect(() => { activePage.current = visible; return () => { activePage.current = false; }; }, [visible]);
  const zh = useLocale() === "zh", router = useRouter();
  const [mode, setMode] = useState("chat"), [prompt, setPrompt] = useState("");
  const [creationTypeState, setCreationType] = useState("image");
  const [creationDrafts, setCreationDrafts] = useState({});
  const { status, data: session } = useSession(), uploadInput = useRef(null);
  const { items: uploads, start: startUploads, dismiss: dismissUpload } = useUploadFeedback(session?.user?.id || status);
  const composer = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsError, setModelsError] = useState(false), [modelsRevision, setModelsRevision] = useState(0);
  const [commerceOpened, setCommerceOpened] = useState(false);
  const [attachments, setAttachments] = useState([]), [size, setSize] = useState("1024x1024"), [count, setCount] = useState(1), [fixed, setFixed] = useState(""), [fixedOpen, setFixedOpen] = useState(false);
  const pending = useRef(null), operation = useRef(false);
  const [resumeDocument, setResumeDocument] = useState(null);
  const [modelCaps, setModelCaps] = useState(null);
  const [creationCaps, setCreationCaps] = useState(null);
  const [models, setModels] = useState([]), [provider, setProvider] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const launcherVisibility = creationCaps?.launcherVisibility;
  const creationType = launcherVisibility?.[creationTypeState] === false
    ? ["image", "motion", "video", "poster", "slides", "document", "sheet", "web"].find(kind => launcherVisibility[kind] !== false) || "image"
    : creationTypeState;
  useEffect(() => {
    if (!session?.user?.id || !visible) return;
    let active = true;
    readImageCapabilities(session.user.id, provider).then(caps => {
      if (!active) return;
      setModelCaps(caps); setModels(caps.imageModels); setModelsError(false);
      setProvider(current => current || caps.imageProvider || caps.imageModels[0]?.id || "");
    }).catch(failure => {
      if (!active) return;
      setModelsError(true);
      if ([401, 403].includes(failure.status)) { setModelCaps(null); setModels([]); }
    }).finally(() => { if (active) setModelsReady(true); });
    return () => { active = false; };
  }, [session?.user?.id, provider, visible, modelsRevision]);
  useEffect(() => {
    if (!session?.user?.id || !visible) return;
    const abort = new AbortController();
    api("/api/creation/capabilities", { signal: abort.signal }).then(setCreationCaps).catch(() => {
      if (!abort.signal.aborted) setCreationCaps({});
    });
    return () => abort.abort();
  }, [session?.user?.id, visible]);
  const upload = useCallback(async files => {
    if (!files.length) return;
    if (operation.current) { setError(zh ? "正在处理，请稍后再添加图片。" : "Please wait before adding more images."); return; }
    if (status !== "authenticated") { auth.open(); return; }
    if (attachments.length >= 3) { setError(zh ? "最多添加 3 张参考图，请先移除一张。" : "You can add up to 3 reference images. Remove one first."); return; }
    operation.current = true; setBusy(true); setError("");
    try {
      const selectedFiles = Array.from(files).slice(0, 3 - attachments.length);
      const feedback = startUploads(selectedFiles);
      const results = await mapWithConcurrency(selectedFiles, 2, async (file, index) => {
        if (!feedback.isCurrent()) return;
        feedback.update(index, "uploading");
        try {
          const asset = await uploadImage(file);
          if (!feedback.isCurrent()) return;
          const size = scaleToFit(asset.width, asset.height, 480);
          const layer = { id: requestKey(), assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x: (attachments.length + index) * 530 + 90, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, visible: true, opacity: 1 };
          setAttachments(current => [...current, layer].sort((left, right) => left.x - right.x));
          feedback.update(index, "done");
        } catch (error) {
          feedback.update(index, "error", error.message);
          throw error;
        }
      });
      if (!feedback.isCurrent()) return;
      const failed = results.find(result => result.status === "rejected");
      if (failed) throw failed.reason;
    } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  }, [attachments, auth, status, zh, startUploads]);
  useEffect(() => {
    if (mode === "commerce" || creationType !== "image" || !visible) return;
    const paste = event => {
      if (event.defaultPrevented || !composer.current || composer.current.closest('[hidden], [inert]')) return;
      if (document.querySelector('dialog[open], [role="dialog"]') || !imagePasteDestination(event.target)) return;
      const files = clipboardImageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void upload(files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [mode, creationType, upload, visible]);
  function handlePromptKeyDown(event) {
    // IME confirmation is not submission (229 also covers WebKit composition).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!event.repeat) void start();
  }
  async function start() {
    if (operation.current || status === "loading") return;
    if (mode === "commerce") { router.push(`/commerce?brief=${encodeURIComponent(prompt)}`); return; }
    if (creationType !== "image") return;
    if (status !== "authenticated") { router.push(`/studio-v2?mode=${mode}&prompt=${encodeURIComponent(prompt)}&size=${size}&count=${count}&fixed=${encodeURIComponent(fixed)}`); return; }
    if (!prompt.trim() && !attachments.length) return;
    operation.current = true; setBusy(true); setError("");
    try {
      const text = [fixed, prompt].filter(Boolean).join("\n");
      if (text.length > 4000) throw new Error(zh ? "固定提示词与描述合计不能超过 4000 字" : "Combined prompt exceeds 4,000 characters");
      let selectedProvider = provider;
      let model = models.find(m => m.id === selectedProvider);
      let caps = modelCaps?.imageProvider === selectedProvider ? modelCaps : null;
      // Continue the same Enter submission after a slow capabilities request.
      // Never quote or submit a fallback price before the model is known.
      if (!model || !caps) {
        caps = await readImageCapabilities(session?.user?.id, selectedProvider);
        setModelCaps(caps); setModels(caps.imageModels); setModelsReady(true);
        selectedProvider ||= caps.imageProvider || caps.imageModels[0]?.id || "";
        setProvider(selectedProvider);
        model = caps.imageModels.find(m => m.id === selectedProvider);
        if (!model) throw new Error(zh ? "暂无可用生图模型，请联系管理员配置。" : "No image model is configured. Contact the administrator.");
      }
      const offer = caps.tools?.find(tool => tool.id === (attachments.length ? "edit" : "generate")) || model;
      if (attachments.length > (model?.maxReferenceImages ?? 3)) throw new Error(zh ? "此模型不支持这些参考图，请更换模型" : "Choose a model supporting these references");
      const fingerprint = JSON.stringify({ text, size, count, provider: selectedProvider, attachments });
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, createKey: requestKey(), messageId: requestKey(), keys: Array.from({ length: count }, () => requestKey()), index: 0 };
      const batch = pending.current;
      // Persist the sent message before submitting, just like the canvas sender.
      // Refreshing the destination must not restore it as an unsent prompt.
      if (!batch.document) batch.document = await api("/api/studio/documents", { method: "POST", body: { createKey: batch.createKey, name: promptTitle(prompt || attachments[0]?.name || "Untitled"), nameSource: prompt.trim() ? "prompt" : "upload", content: { schemaVersion: 1, layers: attachments, messages: prompt.trim() ? [{ id: batch.messageId, role: "user", text: prompt, ...(attachments[0] ? { assetId: attachments[0].assetId } : {}) }] : [], jobs: [], composer: { text: "", fixedPrompt: fixed, outputCount: count, size, referenceIds: attachments.map(l => l.id) } } } });
      setResumeDocument(batch.document.id);
      if (prompt.trim()) for (; batch.index < count; batch.index++) {
        const source = attachments[0];
        await api("/api/studio/jobs", { method: "POST", key: batch.keys[batch.index], body: { origin: "chat", expectedCost: imageCreditCost(offer, size), tool: source ? "edit" : "generate", documentId: batch.document.id, documentVersion: batch.document.version, provider: selectedProvider, ...(source ? { assetId: source.assetId, targetId: source.id, referenceAssetIds: attachments.slice(1).map(l => l.assetId) } : {}), params: { prompt: text, size } } });
      }
      if (activePage.current) router.push(`/studio-v2?document=${batch.document.id}&mode=${mode}&provider=${encodeURIComponent(selectedProvider)}`);
    } catch (err) {
      if (err.code === "PRICE_CHANGED") {
        clearImageCapabilities();
        await readImageCapabilities(session?.user?.id, provider).then(caps => { setModelCaps(caps); setModels(caps.imageModels); }).catch(() => {});
        setError(zh ? "积分价格已更新，请查看最新费用后重新提交；已提交的任务会保留。" : "Pricing changed. Review the new cost and submit again; existing jobs are preserved.");
      } else setError(err.message === "IMAGE_SIZE_UNSUPPORTED" ? zh ? "当前模型不支持所选比例或分辨率，请更换模型或尺寸。" : "This model does not support the selected dimensions. Change the model or size." : err.message === "IMAGE_RESOLUTION_UNSUPPORTED" ? zh ? "当前模型不支持此分辨率，请选择 2K 或 4K。" : "This model requires a larger resolution. Choose 2K or 4K." : err.message); } finally { operation.current = false; setBusy(false); }
  }
  const selectedModel = models.find(m => m.id === provider);
  const selectedOffer = modelCaps?.imageProvider === provider ? modelCaps.tools?.find(tool => tool.id === (attachments.length ? "edit" : "generate")) || selectedModel : null;
  const estimatedCost = selectedOffer ? imageCreditCost(selectedOffer, size) * count : "—";
  return <><section className="cr-hero cr-creation-hero"><div className="cr-hero-content"><h1 className="cr-hero-brand"><BrandMark size={76} /><span className="cr-hero-brand-copy">来塔绘梦<small>letaidraw</small></span></h1><p className="cr-hero-subtitle">{zh ? "让想象，一键成真" : "Bring imagination to life in one click"}</p><div ref={composer} className="cr-home-composer cr-launch-card"><div className="cr-mode-tabs" role="tablist" aria-label={zh ? "创作模式" : "Creative mode"}>{[["chat", MessageCircle, "AI 创作", "AI creation"], ["commerce", ShoppingBag, "电商套图 Agent", "Commerce Agent"]].map(([id, Icon, cn, en]) => <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); if (id === "commerce") setCommerceOpened(true); }}><Icon size={15} />{zh ? cn : en}{id === "commerce" && <span>NEW</span>}</button>)}</div><div className="cr-composer-surface">{commerceOpened && <div hidden={mode !== "commerce"}><CommerceLauncher initialDescription={prompt} /></div>}{mode === "chat" && ["video", "motion"].includes(creationType) && <VideoLauncher key={`${session?.user?.id}:${creationType}`} mode={creationType} userId={session?.user?.id} zh={zh} visible={visible} initialDraft={creationDrafts[creationType]} onDraft={draft => setCreationDrafts(current => ({ ...current, [creationType]: draft }))} />}{mode === "chat" && !["image", "video", "motion"].includes(creationType) && <CreationLauncher key={`${session?.user?.id}:${creationType}`} userId={session?.user?.id} kind={creationType} zh={zh} visible={visible} initialDraft={creationDrafts[creationType]} initialCaps={creationCaps} onDraft={draft => setCreationDrafts(current => ({ ...current, [creationType]: draft }))} attachmentIds={attachments.map(item => item.assetId)} />}{mode === "chat" && creationType === "image" && <><UploadFeedback items={uploads} onDismiss={dismissUpload} zh={zh} />{attachments.length > 0 && <div className="cr-attachments">{attachments.map((layer, i) => <div key={layer.id}><Image src={previewUrl(layer.assetId, 320)} unoptimized width={64} height={64} alt={layer.name} /><span>{i + 1} · {layer.name}</span><button disabled={busy} aria-label={`${zh ? "移除参考图" : "Remove reference "}${i + 1}`} onClick={() => setAttachments(rows => rows.filter(l => l.id !== layer.id))}><X size={14} /></button></div>)}</div>}{fixedOpen && <textarea className="cr-fixed-prompt" aria-label={zh ? "固定提示词" : "Set fixed prompt"} value={fixed} maxLength={1600} onChange={e => setFixed(e.target.value)} placeholder={zh ? "每次创作都要保持的风格、品牌或要求…" : "Consistent style, brand and instructions…"} />}<textarea data-image-paste="reference" aria-label={zh ? "描述你的创意" : "Describe your idea"} value={prompt} disabled={status === "loading"} maxLength={2400} onChange={e => setPrompt(e.target.value)} onKeyDown={handlePromptKeyDown} placeholder={mode === "commerce" ? zh ? "描述产品、卖点和想要的风格，下一步上传产品图与参考图…" : "Describe your product and art direction. Add product and style references next…" : zh ? "说说你的想法吧：一张有呼吸感的产品海报，一组电影感的画面…" : "An airy product poster, a cinematic scene… What will you create?"} /><div className="cr-composer-bottom"><button disabled={busy || attachments.length >= 3} onClick={() => uploadInput.current.click()} className="cr-upload-shortcut"><ImagePlus size={17} /><span>{zh ? "添加图片" : "Add image"}</span></button><ModelPicker key={visible ? "visible-models" : "hidden-models"} size={size} models={models} value={provider} onChange={setProvider} zh={zh} disabled={busy} emptyLabel={status !== "authenticated" ? zh ? "登录后选择模型" : "Sign in to choose a model" : !modelsReady ? zh ? "正在加载模型…" : "Loading models…" : zh ? "暂无可用生图模型" : "No image model configured"} /><button className="cr-parameter" aria-label={zh ? "设置固定提示词" : "Set fixed prompt"} aria-pressed={fixedOpen} onClick={() => setFixedOpen(v => !v)}><Type size={16} /></button><ImageSizePicker key={visible ? "visible-size" : "hidden-size"} value={size} onChange={setSize} zh={zh} disabled={busy} source={attachments[0] ? { width: attachments[0].pixelWidth, height: attachments[0].pixelHeight } : null} /><select className="cr-parameter" aria-label={zh ? "生成张数" : "Image count"} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}{zh ? "张" : "×"}</option>)}</select><input hidden ref={uploadInput} aria-label={zh ? "上传参考图片" : "Upload reference images"} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files)} /><button disabled={busy} className="cr-send" aria-label={zh ? "开始创作" : "Start creating"} onClick={start} title={`${estimatedCost} ${zh ? "积分" : "credits"}`}>{busy ? <LoaderCircle size={18} className="ca-spin" /> : <ArrowUp size={18} />}<span className="generation-price" aria-label={`${estimatedCost} ${zh ? "积分" : "credits"}`}><CreditIcon size={13} />{estimatedCost}</span></button></div><div className="cr-generation-note">{zh ? `一次生成 ${count} 张 · ${estimatedCost} 积分 · 原图与结果分别保存` : `${count} images · ${estimatedCost} credits · Originals preserved`}</div>{error && <p role="alert">{error}{resumeDocument && <Link href={`/studio-v2?document=${resumeDocument}`}>{zh ? "打开项目，查看已提交的任务" : "Open project to recover submitted tasks"}</Link>}</p>}</>}</div></div>{mode === "chat" && <div className="cr-creation-types" role="group" aria-label={zh ? "创作类型" : "Creation type"}>{[
    ["image", ImageIcon, "图片创作", "Image creation"], ["motion", Clapperboard, "视频制作", "Video production"], ["video", Video, "视频生成", "Video generation"], ["poster", PanelsTopLeft, "海报设计", "Poster design"], ["slides", Presentation, "演示文稿", "Presentation"], ["document", FileText, "文档", "Document"], ["sheet", Table2, "表格", "Spreadsheet"], ["web", Globe2, "网页", "Website"],
  ].filter(([kind]) => creationCaps?.launcherVisibility?.[kind] !== false).map(([kind, Icon, cn, en]) => {
    const available = kind === "image" || Boolean(creationCaps?.[kind]);
    return <button key={kind} disabled={busy || !available} aria-pressed={creationType === kind} title={!available ? (zh ? "创作服务尚未就绪" : "Creation service is not ready") : undefined} onClick={() => setCreationType(kind)}><Icon size={17} aria-hidden="true" /><span>{zh ? cn : en}</span></button>;
  })}</div>}<div className="cr-quick-links">{[["commerce", "产品广告", "Product campaigns"], ["manga", "漫画叙事", "Comics"], ["poster", "创意海报", "Creative posters"]].map(([id, cn, en]) => <Link href={`/?category=${id}#inspiration`} key={id}><WandSparkles size={13} />{zh ? cn : en}<ArrowUpRight size={12} /></Link>)}</div></div></section>
    {modelsError && <p role="alert">{zh ? "模型列表刷新失败，页面仍可使用。" : "Could not refresh models. You can still use this page."}<button type="button" onClick={() => { clearImageCapabilities(); setModelsRevision(value => value + 1); }}>{zh ? "重试加载模型" : "Retry models"}</button></p>}
    <InspirationGallery zh={zh} /></>;
}
