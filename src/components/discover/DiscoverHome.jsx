"use client";
import { uploadImage } from "@/lib/upload-image";
import { clipboardImageFiles, imagePasteDestination } from "@/lib/studio/image-paste";
import Image from "@/components/studio/AssetImage";
import CreditIcon from "@/components/ui/CreditIcon";
import "@/components/studio/generation-price.css";
import { imageCreditCost } from "@/lib/studio/image-pricing";
import { BrandMark } from "@/components/BrandLogo";
import { previewUrl } from "@/lib/studio/image-url";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { HomeGuestPromptContext } from "./home-guest-prompt";
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
import { ArrowUp, ArrowUpRight, ShoppingBag, ImagePlus, Image as ImageIcon, Presentation, Sparkles, X, Type, LoaderCircle, Video, ChevronDown } from "lucide-react";
import ModelPicker from "@/components/ui/ModelPicker";
import ImageSizePicker from "@/components/ui/ImageSizePicker";
import CreationLauncher from "./CreationLauncher";
import VideoLauncher from "@/components/video/VideoLauncher";
import dynamic from "next/dynamic";
import "./home-composer.css";
import "./home.css";
import "./home-launchers.css";
import { sceneImage } from "./hero-wall";
import HeroWall from "./HeroWall";
import { HOME_SCENES, HOME_CHIPS } from "./home-scenes";
import { useHeroPointer } from "./use-hero-pointer";
import BrandLoader from "@/components/ui/BrandLoader";
const CommerceLauncher = dynamic(() => import("./CommerceLauncher"));
const InspirationGallery = dynamic(() => import("./InspirationGallery"), {
  loading: () => <section id="inspiration" className="cr-inspiration ig-section" aria-hidden="true"><BrandLoader variant="panel" label="正在加载灵感作品" /></section>,
});

const HOME_KINDS = [
  ["image", ImageIcon, "图片", "Image"],
  ["video", Video, "视频", "Video"],
  ["slides", Presentation, "PPT", "Slides"],
];

export default function DiscoverHome() {
  const auth = useAuth();
  const visible = usePageVisible();
  const activePage = useRef(visible);
  useEffect(() => { activePage.current = visible; return () => { activePage.current = false; }; }, [visible]);
  const zh = useLocale() === "zh", router = useRouter();
  const hero = useHeroPointer();
  const { status, data: session } = useSession(), uploadInput = useRef(null);
  const guestPrompt = useContext(HomeGuestPromptContext);
  const [mode, setMode] = useState("chat"), [prompt, setPrompt] = useState(() => session?.user?.id ? guestPrompt?.text || "" : "");
  const [creationTypeState, setCreationType] = useState("image"), [videoModeState, setVideoMode] = useState("video");
  const [creationDrafts, setCreationDrafts] = useState({});
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
  // “视频”标签合并了单镜头（video）与分镜成片（motion），任一可见即显示。
  const kindVisible = kind => kind === "video" ? launcherVisibility?.video !== false || launcherVisibility?.motion !== false : launcherVisibility?.[kind] !== false;
  const creationType = !kindVisible(creationTypeState)
    ? HOME_KINDS.map(([kind]) => kind).find(kindVisible) || "image"
    : creationTypeState;
  const videoModes = ["video", "motion"].filter(mode => launcherVisibility?.[mode] !== false && (!creationCaps || creationCaps[mode]));
  const videoMode = videoModes.includes(videoModeState) ? videoModeState : videoModes[0] || "video";
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
  const commerce = mode === "commerce";
  const activeKind = commerce ? "commerce" : creationType;
  const chooseKind = kind => {
    if (kind === "commerce") { setMode("commerce"); setCommerceOpened(true); return; }
    setMode("chat"); setCreationType(kind);
  };
  const applyIdea = text => {
    setPrompt(text);
    if (status === "unauthenticated") guestPrompt?.remember(text);
    composer.current?.querySelector("textarea.lh-prompt")?.focus();
  };
  const openScene = scene => {
    if (scene.kind === "image") { chooseKind("image"); applyIdea(scene.prompt); return; }
    chooseKind(scene.kind);
  };
  const kinds = [...HOME_KINDS.filter(([kind]) => kindVisible(kind)), ["commerce", ShoppingBag, "电商套图", "Commerce"]];
  return <>
  <section className="cr-creation-hero lh-hero" ref={hero.ref} onPointerMove={hero.onPointerMove} onPointerLeave={hero.onPointerLeave}>
    <HeroWall />
    <div className="lh-veil" aria-hidden="true" />
    <div className="lh-hero-inner">
      <p className="lh-eyebrow"><Sparkles size={13} />{zh ? "图像 · 视频 · 演示文稿 · 电商套图" : "Images · Video · Slides · Commerce"}</p>
      <h1 className="lh-title">
        <span>{zh ? "让想象，" : "Imagine it."}</span>
        <em>{zh ? "成为作品" : "See it made."}</em>
      </h1>
      <p className="lh-subtitle">{zh ? "写下一句话，或丢进一张图。剩下的交给 AI。" : "Write a sentence, or drop in an image. The rest is up to AI."}</p>
      <div ref={composer} className="cr-home-composer lh-composer" data-kind={activeKind}>
        <div className="lh-kinds" role="tablist" aria-label={zh ? "创作类型" : "Creation type"}>{kinds.map(([kind, Icon, cn, en]) => {
          const available = kind === "image" || kind === "commerce" || (kind === "video" ? Boolean(creationCaps?.video || creationCaps?.motion) : Boolean(creationCaps?.[kind]));
          return <button key={kind} role="tab" type="button" aria-selected={activeKind === kind} disabled={busy || !available} title={!available ? (zh ? "创作服务尚未就绪" : "Creation service is not ready") : undefined} onClick={() => chooseKind(kind)}><Icon size={15} />{zh ? cn : en}</button>;
        })}</div>
        <div className="cr-composer-surface lh-surface">
          {commerceOpened && <div hidden={!commerce}><CommerceLauncher initialDescription={prompt} /></div>}
          {!commerce && creationType === "video" && <VideoLauncher key={`${session?.user?.id}:${videoMode}`} mode={videoMode} modes={videoModes} onMode={setVideoMode} userId={session?.user?.id} zh={zh} visible={visible} initialDraft={creationDrafts[videoMode]} onDraft={draft => setCreationDrafts(current => ({ ...current, [videoMode]: draft }))} />}
          {!commerce && creationType === "slides" && <CreationLauncher key={`${session?.user?.id}:slides`} userId={session?.user?.id} kind="slides" zh={zh} visible={visible} initialDraft={creationDrafts.slides} initialCaps={creationCaps} onDraft={draft => setCreationDrafts(current => ({ ...current, slides: draft }))} attachmentIds={attachments.map(item => item.assetId)} />}
          {!commerce && creationType === "image" && <>
            <UploadFeedback items={uploads} onDismiss={dismissUpload} zh={zh} />
            {attachments.length > 0 && <div className="lh-attachments">{attachments.map((layer, i) => <figure key={layer.id}>
              <Image src={previewUrl(layer.assetId, 320)} unoptimized width={64} height={64} alt={layer.name} />
              <figcaption>{i + 1}</figcaption>
              <button type="button" disabled={busy} aria-label={`${zh ? "移除参考图" : "Remove reference "}${i + 1}`} onClick={() => setAttachments(rows => rows.filter(l => l.id !== layer.id))}><X size={12} /></button>
            </figure>)}</div>}
            {fixedOpen && <textarea className="lh-fixed" aria-label={zh ? "固定提示词" : "Set fixed prompt"} value={fixed} maxLength={1600} onChange={e => setFixed(e.target.value)} placeholder={zh ? "每次创作都要保持的风格、品牌或要求…" : "Consistent style, brand and instructions…"} />}
            <textarea className="lh-prompt" data-image-paste="reference" aria-label={zh ? "描述你的创意" : "Describe your idea"} value={prompt} disabled={status === "loading"} maxLength={2400} onChange={e => { setPrompt(e.target.value); if (status === "unauthenticated") guestPrompt?.remember(e.target.value); }} onKeyDown={handlePromptKeyDown} placeholder={zh ? "描述你想要的画面，例如：清晨薄雾中的玻璃温室，柔和自然光，胶片质感…" : "Describe what you want to see — a glass greenhouse in morning mist, soft light, film grain…"} />
            <div className="lh-toolbar">
              <button type="button" disabled={busy || attachments.length >= 3} onClick={() => uploadInput.current.click()} className="lh-tool" title={zh ? "添加参考图（最多 3 张）" : "Add reference images"}><ImagePlus size={17} /><span>{zh ? "参考图" : "Image"}</span></button>
              <ModelPicker key={visible ? "visible-models" : "hidden-models"} size={size} models={models} value={provider} onChange={setProvider} zh={zh} disabled={busy} emptyLabel={status !== "authenticated" ? zh ? "登录后选择模型" : "Sign in to choose a model" : !modelsReady ? zh ? "正在加载模型…" : "Loading models…" : zh ? "暂无可用生图模型" : "No image model configured"} />
              <ImageSizePicker key={visible ? "visible-size" : "hidden-size"} value={size} onChange={setSize} zh={zh} disabled={busy} source={attachments[0] ? { width: attachments[0].pixelWidth, height: attachments[0].pixelHeight } : null} />
              <label className="lh-tool lh-count"><select aria-label={zh ? "生成张数" : "Image count"} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}{zh ? " 张" : "×"}</option>)}</select><ChevronDown size={14} /></label>
              <button type="button" className="lh-tool lh-icon" aria-label={zh ? "设置固定提示词" : "Set fixed prompt"} title={zh ? "固定提示词" : "Fixed prompt"} aria-pressed={fixedOpen} onClick={() => setFixedOpen(v => !v)}><Type size={16} /></button>
              <input hidden ref={uploadInput} aria-label={zh ? "上传参考图片" : "Upload reference images"} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files)} />
              <button type="button" disabled={busy} className="lh-send" aria-label={zh ? "开始创作" : "Start creating"} onClick={start} title={`${estimatedCost} ${zh ? "积分" : "credits"}`}>
                <span className="lh-send-cost" aria-label={`${estimatedCost} ${zh ? "积分" : "credits"}`}><CreditIcon size={13} />{estimatedCost}</span>
                <span className="lh-send-icon">{busy ? <LoaderCircle size={18} className="ca-spin" /> : <ArrowUp size={18} strokeWidth={2.4} />}</span>
              </button>
            </div>
            {error && <p className="lh-error" role="alert">{error}{resumeDocument && <Link href={`/studio-v2?document=${resumeDocument}`}>{zh ? "打开项目，查看已提交的任务" : "Open project to recover submitted tasks"}</Link>}</p>}
          </>}
        </div>
      </div>
      {!commerce && creationType === "image" && <div className="lh-chips">{HOME_CHIPS.map(scene => <button type="button" key={scene.id} onClick={() => openScene(scene)}>
        <Image src={sceneImage(scene.image)} width={44} height={44} unoptimized alt="" aria-hidden />
        <span>{zh ? scene.label : scene.labelEn}</span>
        <ArrowUpRight size={13} />
      </button>)}</div>}
    </div>
    <div className="lh-scroll-hint" aria-hidden="true"><span>{zh ? "更多灵感" : "More inspiration"}</span><ChevronDown size={16} /></div>
  </section>
  <section className="lh-scenes" aria-labelledby="lh-scenes-title">
    <header>
      <div><p className="lh-kicker">{zh ? "快速上手" : "Start here"}</p><h2 id="lh-scenes-title">{zh ? "从这些场景开始" : "Pick a starting point"}</h2></div>
      <Link href="/#inspiration" className="lh-more">{zh ? "浏览全部作品" : "Browse all works"}<ArrowUpRight size={14} /></Link>
    </header>
    <div className="lh-scene-row">{HOME_SCENES.map((scene, index) => <button type="button" key={scene.id} className="lh-scene" onClick={() => openScene(scene)} style={{ "--i": index }}>
      <span className="lh-scene-art">
        <Image src={sceneImage(scene.image)} width={640} height={640} unoptimized alt={zh ? scene.label : scene.labelEn} sizes="(max-width: 700px) 72vw, 320px" />
        <span className="lh-scene-go">{zh ? "做同款" : "Remix"}<ArrowUpRight size={13} /></span>
      </span>
      <span className="lh-scene-label"><scene.Icon size={15} />{zh ? scene.label : scene.labelEn}</span>
    </button>)}</div>
  </section>
  <div className="lh-error-slot">{modelsError && <p className="lh-error" role="alert">{zh ? "模型列表刷新失败，页面仍可使用。" : "Could not refresh models. You can still use this page."}<button type="button" aria-label={zh ? "重试加载模型" : "Retry models"} onClick={() => { clearImageCapabilities(); setModelsRevision(value => value + 1); }}>{zh ? "重试" : "Retry"}</button></p>}</div>
    <InspirationGallery zh={zh} /></>;
}
