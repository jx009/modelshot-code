"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import CreationComposer from "@/components/discover/CreationComposer";
import { videoModelOffer } from "@/lib/video/model-choice";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import useVideoCapabilities from "./useVideoCapabilities";
import { videoMessage } from "@/lib/video/messages";
import { clipboardImageFiles } from "@/lib/studio/image-paste";
import { VIDEO_TEMPLATES } from "@/lib/video/timeline";
import useVideoProject from "./useVideoProject";
import VideoMediaHint, { VIDEO_MEDIA_ACCEPT } from "./VideoMediaHint";
import VideoSubmissionRecovery from "./VideoSubmissionRecovery";
import VideoReferenceEditor from "./VideoReferenceEditor";
import VideoParameterFields from "./VideoParameterFields";
import "@/components/creation/reference-assets.css";

export default function VideoLauncher({ mode, userId, zh, visible = true, initialDraft, onDraft }) {
  const project = useVideoProject({ mode, userId, initialProvider: initialDraft?.provider, initialVideo: initialDraft?.video, initialPrompt: initialDraft?.prompt }), router = useNavigationRouter(), input = useRef(null);
  const { data: caps, error: capsError, retry: retryCapabilities } = useVideoCapabilities(Boolean(userId && visible));
  const [opening, setOpening] = useState(false);
  const draftCallback = useRef(onDraft), isVisible = useRef(visible);
  const video = project.draft.content.video, motion = mode === "motion", tool = motion ? "motion-plan" : "video";
  const prompt = video.prompt || "", setPrompt = prompt => project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, prompt } } }));
  const offer = motion ? caps?.tools?.find(item => item.id === tool) : videoModelOffer(caps, video.provider, video);
  const hasPrompt = Boolean(prompt.trim() || !motion && offer?.promptOptional && video.media.length);
  const busy = opening || project.working || project.applying || project.jobsLoading;
  const submitBusy = busy || project.active || project.pendingSubmission;
  const mediaLimit = motion ? 40 : offer?.mediaLimits ? Object.values(offer.mediaLimits).reduce((sum, count) => sum + count, 0) : 1;
  const text = (cn, en) => zh ? cn : en;
  const modelError = {
    VIDEO_REFERENCE_ROLE_UNSUPPORTED: text("素材用途与当前模型不一致，请重新分配用途或更换模型。", "Assign reference roles for this model or choose another model."),
    VIDEO_FRAME_ORDER_INVALID: text("请先设置首帧，再设置尾帧。", "Set a first frame before the last frame."),
    VIDEO_FIELDS_REQUIRED: text("请填写当前模型所需的模板或原任务信息。", "Complete the required model fields."),
    VIDEO_MEDIA_LIMIT: text("参考素材超出当前模型限制，请移除部分素材或更换模型。", "References exceed this model’s limits."),
    VIDEO_AUDIO_DURATION_INVALID: text("参考音频每段至少 1.8 秒，合计不能超过 30 秒。", "Audio must be at least 1.8s per clip, 30s total."),
    VIDEO_DURATION_UNSUPPORTED: text("当前模型不支持此时长，请在参数中重新选择。", "Choose a duration supported by this model in Settings."),
    VIDEO_RATIO_UNSUPPORTED: text("当前模型不支持此比例，请在参数中重新选择。", "Choose an aspect ratio supported by this model in Settings."),
    VIDEO_REFERENCE_REQUIRED: text("当前模型是图生视频，请添加首帧图片。", "This model requires a first-frame image."),
    VIDEO_REFERENCE_UNSUPPORTED: text("当前模型仅支持文生视频，请移除图片或更换模型。", "This text-to-video model does not accept images. Remove the reference or change models."),
  }[offer?.reason];
  useEffect(() => { draftCallback.current = onDraft; }, [onDraft]);
  useEffect(() => { draftCallback.current?.({ prompt, video, ...(video.provider ? { provider: video.provider } : {}) }); }, [prompt, video]);
  useEffect(() => { isVisible.current = visible; return () => { isVisible.current = false; }; }, [visible]);
  const patch = values => project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  async function start(event) {
    event.preventDefault();
    if (!userId || !visible || !hasPrompt || !offer?.available || submitBusy) return;
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
    void project.upload(files, offer);
  }
  return <CreationComposer
    zh={zh} prompt={prompt} onPromptChange={setPrompt} onSubmit={start}
    promptLabel={text("视频创意", "Video prompt")}
    placeholder={motion ? text("描述视频创意，可添加图片、视频或音频素材…", "Describe a video idea and add images, clips or audio…") : text("描述主体、场景和镜头，或添加首帧图片…", "Describe the subject, scene and camera, or add a first-frame image…")}
    maxLength={4000} disabled={busy} busy={busy} cost={offer?.cost}
    submitDisabled={!userId || submitBusy || !hasPrompt || !offer?.available}
    submitLabel={motion ? text("生成视频方案", "Generate video plan") : text("生成视频", "Generate video")}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); upload(event.dataTransfer.files); } }}
    onPaste={event => { const files = clipboardImageFiles(event.clipboardData); if (files.length) { event.preventDefault(); upload(files); } }}
    attachments={<div className="cw-reference-assets">
      <VideoReferenceEditor onReplace={(files, id) => project.upload(files, offer, id)} media={video.media} offer={offer} motion={motion} zh={zh} disabled={busy} onChange={media => patch({ media })} onAdd={() => input.current?.click()} lockedIds={[...(video.composition?.scenes || []).map(scene => scene.assetId), video.composition?.audio?.assetId].filter(Boolean)} />
      <button type="button" className="cw-add-reference" disabled={!userId || busy || video.media.length >= mediaLimit} onClick={() => input.current?.click()}><ImagePlus size={16} />{motion ? text("添加素材", "Add media") : text("添加参考素材", "Add references")}</button>
      <input ref={input} hidden aria-label={text("上传视频素材", "Upload video media")} type="file" multiple={motion || Boolean(offer?.mediaLimits)} accept={motion || offer?.mediaLimits?.video || offer?.mediaLimits?.audio ? VIDEO_MEDIA_ACCEPT : "image/png,image/jpeg,image/webp"} onChange={event => { upload(event.target.files); event.target.value = ""; }} />
    </div>}
    settings={<>
      {!motion && <VideoParameterFields caps={caps} video={video} offer={offer} onChange={patch} disabled={busy} zh={zh} />}
      {motion && <label>{text("比例", "Aspect ratio")}<select disabled={busy} value={video.ratio} onChange={event => patch({ ratio: event.target.value })}>{["16:9", "9:16", "1:1", "4:5"].map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>}
      {motion && <label>{text("平台预设", "Platform preset")}<select disabled={busy} value="" onChange={event => { if (event.target.value !== "") patch({ ratio: VIDEO_TEMPLATES[Number(event.target.value)][1] }); }}><option value="">{text("选择画幅预设", "Choose an aspect preset")}</option>{VIDEO_TEMPLATES.map(([name, ratio], index) => <option key={index} value={index}>{name} · {ratio}</option>)}</select></label>}
      <button type="button" className="cr-creation-secondary" disabled={!userId || busy} onClick={openWorkspace}>{text("打开视频工作台", "Open video workspace")}</button>
    </>}
  >
    {project.recovery && <div className="cr-creation-note" role="status">{text("发现未保存的视频草稿", "An unsaved video draft is available")} <button type="button" disabled={busy} onClick={project.recover}>{text("恢复", "Restore")}</button> <button type="button" disabled={busy} onClick={project.discardRecovery}>{text("忽略", "Dismiss")}</button></div>}
    {!motion && <VideoMediaHint offer={offer} zh={zh} />}
    {project.uploadProgress && <p className="cr-creation-note" role="status">{project.uploadProgress}</p>}
    {!userId ? <p className="cr-creation-note">{text("登录后开始视频创作", "Sign in to create videos")}</p> : capsError ? <div className="cr-creation-error" role="alert">{text("视频能力加载失败", "Could not load video availability")}<button type="button" onClick={retryCapabilities}>{text("重试", "Retry")}</button></div> : !caps ? <p className="cr-creation-note" role="status">{text("正在加载视频能力…", "Loading video availability…")}</p> : !offer?.available && <p className="cr-creation-note">{modelError || videoMessage(offer?.reason, zh)}</p>}
    <VideoSubmissionRecovery project={project} zh={zh} onRecovered={job => { if (isVisible.current) router.push(`/video?document=${job.documentId}`); }} />
    {project.error && <p role="alert" className="cr-creation-error">{text("操作未完成：", "Operation failed: ")}{project.error}</p>}
  </CreationComposer>;
}
