"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, Film, ImagePlus, X } from "lucide-react";
import CreationComposer from "@/components/discover/CreationComposer";
import GenerationModelSelect from "@/components/creation/GenerationModelSelect";
import { videoModelOffer, videoModelChange } from "@/lib/video/model-choice";
import Image from "@/components/studio/AssetImage";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import { api } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";
import { clipboardImageFiles } from "@/lib/studio/image-paste";
import { VIDEO_TEMPLATES } from "@/lib/video/timeline";
import useVideoProject from "./useVideoProject";
import "@/components/creation/reference-assets.css";

export default function VideoLauncher({ mode, userId, zh, visible = true, initialDraft, onDraft }) {
  const project = useVideoProject({ mode, userId, initialProvider: initialDraft?.provider }), router = useNavigationRouter(), input = useRef(null);
  const [prompt, setPrompt] = useState(initialDraft?.prompt || ""), [caps, setCaps] = useState(null);
  const [capsError, setCapsError] = useState(false), [attempt, setAttempt] = useState(0), [opening, setOpening] = useState(false);
  const draftCallback = useRef(onDraft), isVisible = useRef(visible);
  const video = project.draft.content.video, motion = mode === "motion", tool = motion ? "motion-plan" : "video";
  const offer = motion ? caps?.tools?.find(item => item.id === tool) : videoModelOffer(caps, video.provider, video);
  const busy = opening || project.working || project.active || project.applying || project.jobsLoading;
  const mediaLimit = motion ? 40 : 1;
  const text = (cn, en) => zh ? cn : en;
  const modelError = {
    VIDEO_DURATION_UNSUPPORTED: text("当前模型不支持此时长，请在参数中重新选择。", "Choose a duration supported by this model in Settings."),
    VIDEO_RATIO_UNSUPPORTED: text("当前模型不支持此比例，请在参数中重新选择。", "Choose an aspect ratio supported by this model in Settings."),
    VIDEO_REFERENCE_REQUIRED: text("当前模型是图生视频，请添加首帧图片。", "This model requires a first-frame image."),
    VIDEO_REFERENCE_UNSUPPORTED: text("当前模型仅支持文生视频，请移除图片或更换模型。", "This text-to-video model does not accept images. Remove the reference or change models."),
  }[offer?.reason];
  useEffect(() => { draftCallback.current = onDraft; }, [onDraft]);
  useEffect(() => { draftCallback.current?.({ prompt, ...(video.provider ? { provider: video.provider } : {}) }); }, [prompt, video.provider]);
  useEffect(() => { isVisible.current = visible; return () => { isVisible.current = false; }; }, [visible]);
  useEffect(() => {
    if (!userId || !visible) return;
    const abort = new AbortController();
    api("/api/video/capabilities", { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setCaps(value); setCapsError(false); }
    }).catch(() => {
      if (!abort.signal.aborted) setCapsError(true);
    });
    return () => abort.abort();
  }, [userId, visible, attempt]);
  const patch = values => project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  async function start(event) {
    event.preventDefault();
    if (!userId || !visible || !prompt.trim() || !offer?.available || busy) return;
    const result = await project.submit(tool, prompt.trim(), offer);
    if (result && isVisible.current) router.push(`/video?document=${result.documentId}`);
  }
  async function openWorkspace() {
    if (!userId || busy) return;
    setOpening(true);
    try {
      const saved = await project.save();
      if (isVisible.current) router.push(`/video?document=${saved.id}`);
    } catch {
      return;
    } finally {
      setOpening(false);
    }
  }
  function upload(files) {
    if (!userId || !visible || busy) return;
    void project.upload(files);
  }
  return <CreationComposer
    zh={zh} prompt={prompt} onPromptChange={setPrompt} onSubmit={start}
    promptLabel={text("视频创意", "Video prompt")}
    placeholder={motion ? text("描述视频创意，可添加图片、视频或音频素材…", "Describe a video idea and add images, clips or audio…") : text("描述主体、场景和镜头，或添加首帧图片…", "Describe the subject, scene and camera, or add a first-frame image…")}
    maxLength={4000} disabled={busy} busy={busy} cost={offer?.cost}
    submitDisabled={!userId || busy || !prompt.trim() || !offer?.available}
    submitLabel={motion ? text("生成视频方案", "Generate video plan") : text("生成视频", "Generate video")}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); upload(event.dataTransfer.files); } }}
    onPaste={event => { const files = clipboardImageFiles(event.clipboardData); if (files.length) { event.preventDefault(); upload(files); } }}
    attachments={<div className="cw-reference-assets">
      <div className="cw-reference-assets-list">{video.media.map(media => <div key={media.id} className="cw-reference-asset" title={media.name}>
        {media.type === "image" ? <Image src={previewUrl(media.id, 320)} unoptimized fill sizes="52px" loading="lazy" alt={media.name} /> : <div className="cr-creation-media-icon">{media.type === "audio" ? <FileAudio size={22} /> : <Film size={22} />}</div>}
        <span>{media.name}</span>
        <button type="button" disabled={busy || video.composition?.scenes.some(scene => scene.assetId === media.id) || video.composition?.audio?.assetId === media.id} aria-label={text(`移除 ${media.name}`, `Remove ${media.name}`)} onClick={() => patch({ media: video.media.filter(item => item.id !== media.id) })}><X size={12} /></button>
      </div>)}</div>
      <button type="button" className="cw-add-reference" disabled={!userId || busy || video.media.length >= mediaLimit} onClick={() => input.current?.click()}><ImagePlus size={16} />{motion ? text("添加素材", "Add media") : text("添加首帧", "Add first frame")}</button>
      <input ref={input} hidden aria-label={text("上传视频素材", "Upload video media")} type="file" multiple={motion} accept={motion ? "image/png,image/jpeg,image/webp,.mp4,.mov,.mp3,.wav,.m4a,.aac,.flac,.ogg" : "image/png,image/jpeg,image/webp"} onChange={event => { upload(event.target.files); event.target.value = ""; }} />
    </div>}
    settings={<>
      {!motion && <GenerationModelSelect video zh={zh} models={caps?.videoModels} value={video.provider || caps?.videoProvider} disabled={busy} onChange={provider => patch(videoModelChange(caps, provider, video))} />}
      <label>{text("比例", "Aspect ratio")}<select disabled={busy} value={video.ratio} onChange={event => patch({ ratio: event.target.value })}>{(motion ? ["16:9", "9:16", "1:1", "4:5"] : [...new Set([video.ratio, ...(offer?.ratios || ["16:9", "9:16", "1:1", "4:5"])])]).map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>
      {!motion && <label>{text("时长", "Duration")}<select disabled={busy} value={video.duration} onChange={event => patch({ duration: Number(event.target.value) })}>{[...new Set([video.duration, ...(offer?.durations || [5, 10])])].map(duration => <option key={duration} value={duration}>{duration}s</option>)}</select></label>}
      {motion && <label>{text("平台预设", "Platform preset")}<select disabled={busy} value="" onChange={event => { if (event.target.value !== "") patch({ ratio: VIDEO_TEMPLATES[Number(event.target.value)][1] }); }}><option value="">{text("选择画幅预设", "Choose an aspect preset")}</option>{VIDEO_TEMPLATES.map(([name, ratio], index) => <option key={index} value={index}>{name} · {ratio}</option>)}</select></label>}
      <button type="button" className="cr-creation-secondary" disabled={!userId || busy} onClick={openWorkspace}>{text("打开视频工作台", "Open video workspace")}</button>
    </>}
  >
    {project.recovery && <div className="cr-creation-note" role="status">{text("发现未保存的视频草稿", "An unsaved video draft is available")} <button type="button" disabled={busy} onClick={project.recover}>{text("恢复", "Restore")}</button> <button type="button" disabled={busy} onClick={project.discardRecovery}>{text("忽略", "Dismiss")}</button></div>}
    {project.uploadProgress && <p className="cr-creation-note" role="status">{project.uploadProgress}</p>}
    {!userId ? <p className="cr-creation-note">{text("登录后开始视频创作", "Sign in to create videos")}</p> : capsError ? <div className="cr-creation-error" role="alert">{text("视频能力加载失败", "Could not load video availability")}<button type="button" onClick={() => { setCapsError(false); setAttempt(value => value + 1); }}>{text("重试", "Retry")}</button></div> : !caps ? <p className="cr-creation-note" role="status">{text("正在加载视频能力…", "Loading video availability…")}</p> : !offer?.available && <p className="cr-creation-note">{modelError || text("生成服务未就绪，可在参数中打开工作台编辑素材。", "Generation is unavailable. Open the workspace from Settings to edit media.")}</p>}
    {project.error && <p role="alert" className="cr-creation-error">{text("操作未完成：", "Operation failed: ")}{project.error}</p>}
  </CreationComposer>;
}
