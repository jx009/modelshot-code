"use client";

import { useRef } from "react";
import { ArrowUp, ExternalLink, ImagePlus, LoaderCircle, X } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import useVideoCapabilities from "./useVideoCapabilities";
import { videoMessage } from "@/lib/video/messages";
import { videoModelOffer } from "@/lib/video/model-choice";
import { clipboardImageFiles } from "@/lib/studio/image-paste";
import useVideoProject from "./useVideoProject";
import VideoSubmissionRecovery from "./VideoSubmissionRecovery";
import VideoReferenceEditor from "./VideoReferenceEditor";
import VideoParameterFields from "./VideoParameterFields";
import VideoMediaHint, { VIDEO_MEDIA_ACCEPT } from "./VideoMediaHint";

export default function CanvasVideoPanel({ documentId, userId, zh, onClose, onSubmitted }) {
  const project = useVideoProject({ documentId, mode: "video", userId, guardNavigation: true });
  const { data: caps, error: capsError, retry: retryCapabilities } = useVideoCapabilities(Boolean(userId));
  const input = useRef(null), video = project.draft.content.video, text = (cn, en) => zh ? cn : en;
  const prompt = video.prompt || "";
  const offer = videoModelOffer(caps, video.provider, video);
  const editingDisabled = project.loading || project.loadFailed || project.working || project.applying;
  const submitDisabled = editingDisabled || project.active || project.jobsLoading || !offer?.available || !(prompt.trim() || offer?.promptOptional && video.media.length);
  const patch = values => project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  const setPrompt = prompt => patch({ prompt });
  async function submit(event) {
    event.preventDefault(); if (submitDisabled) return;
    const job = await project.submit("video", prompt.trim(), offer);
    if (job) { setPrompt(""); onSubmitted(job); }
  }
  async function close() { try { if (project.dirty) await project.save(); onClose(); } catch { /* The hook displays the save error and preserves recovery. */ } }
  return <section className="ms-tool-panel vg-canvas-panel" aria-label={text("生成视频", "Generate video")}>
    <header className="ms-panel-title"><strong>{text("生成视频", "Generate video")}</strong><button type="button" className="ms-icon" onClick={close} aria-label={text("关闭视频面板", "Close video panel")}><X size={17} /></button></header>
    <form onSubmit={submit} onPaste={event => { const files = clipboardImageFiles(event.clipboardData); if (files.length && !editingDisabled) { event.preventDefault(); void project.upload(files, offer); } }}>
      <VideoReferenceEditor onReplace={(files, id) => project.upload(files, offer, id)} media={video.media} offer={offer} onChange={media => patch({ media })} onAdd={() => input.current?.click()} disabled={editingDisabled} zh={zh} />
      <button type="button" className="ms-button" disabled={editingDisabled} onClick={() => input.current?.click()}><ImagePlus size={15} />{text("添加参考素材", "Add references")}</button>
      <input type="file" ref={input} hidden multiple accept={offer?.mediaLimits?.video || offer?.mediaLimits?.audio ? VIDEO_MEDIA_ACCEPT : "image/png,image/jpeg,image/webp"} onChange={event => { if (event.target.files.length) void project.upload(event.target.files, offer); event.target.value = ""; }} />
      <textarea aria-label={text("视频描述", "Video prompt")} placeholder={text("描述动作、场景和镜头变化…", "Describe motion, scene and camera…")} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} disabled={editingDisabled} />
      <VideoParameterFields caps={caps} video={video} offer={offer} onChange={patch} disabled={editingDisabled} zh={zh} />
      <VideoMediaHint offer={offer} zh={zh} />
      {capsError ? <p role="alert">{text("视频能力加载失败", "Could not load video capabilities")}<button type="button" onClick={retryCapabilities}>{text("重试", "Retry")}</button></p> : !caps ? <p role="status">{text("正在加载视频能力…", "Loading video capabilities…")}</p> : !offer?.available && <p role="status">{videoMessage(offer?.reason, zh)}</p>}
      <VideoSubmissionRecovery project={project} zh={zh} onRecovered={onSubmitted} />
      {project.error && <p role="alert">{videoMessage(project.error, zh)}</p>}
      {project.uploadProgress && <p role="status">{project.uploadProgress}</p>}
      {project.recovery && <div role="status"><p>{text("发现尚未同步的草稿。", "An unsaved draft is available.")}</p><button type="button" disabled={editingDisabled} onClick={project.recover}>{text("恢复草稿", "Restore draft")}</button><button type="button" disabled={editingDisabled} onClick={project.discardRecovery}>{text("使用云端版本", "Use cloud version")}</button></div>}
      {project.active && <p role="status">{text("视频正在后台生成，可以继续准备下一版草稿。", "Generation is running. You can prepare your next draft.")}</p>}
      <footer><Link href={`/video?document=${documentId}`}><ExternalLink size={14} />{text("视频工作台", "Video workspace")}</Link><button type="submit" className="ms-button ms-primary" disabled={submitDisabled}>{project.working ? <LoaderCircle size={15} /> : <ArrowUp size={15} />}{offer?.cost ?? "—"} {text("积分", "credits")}</button></footer>
    </form>
  </section>;
}
