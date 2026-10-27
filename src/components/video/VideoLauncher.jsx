"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import { api } from "@/lib/client-api";
import useVideoProject from "./useVideoProject";
import { VIDEO_TEMPLATES } from "@/lib/video/timeline";
import "./video.css";

export default function VideoLauncher({ mode, userId, zh }) {
  const project = useVideoProject({ mode, userId }), router = useNavigationRouter(), input = useRef(null);
  const [prompt, setPrompt] = useState(""), [caps, setCaps] = useState(null);
  const video = project.draft.content.video, motion = mode === "motion", tool = motion ? "motion-plan" : "video";
  const offer = caps?.tools.find(item => item.id === tool);
  const busy = project.working || project.active || project.applying || project.jobsLoading;
  const setError = project.setError;
  useEffect(() => { const abort = new AbortController(); api("/api/video/capabilities", { signal: abort.signal }).then(setCaps).catch(error => { if (!abort.signal.aborted) setError(error.message); }); return () => abort.abort(); }, [setError]);
  const patch = values => project.change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  async function start(event) {
    event.preventDefault();
    if (!prompt.trim() || !offer?.available || busy) return;
    const result = await project.submit(tool, prompt.trim(), offer);
    if (result) router.push(`/video?document=${result.documentId}`);
  }
  return <form className="vm-launcher" onSubmit={start} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); void project.upload(event.dataTransfer.files); }}>
    {project.recovery && <div role="status">{zh ? "发现未保存的视频草稿" : "An unsaved video draft is available"}<button type="button" onClick={project.recover}>{zh ? "恢复" : "Restore"}</button><button type="button" onClick={project.discardRecovery}>{zh ? "忽略" : "Dismiss"}</button></div>}
    {video.media.length > 0 && <div className="vm-attachments">{video.media.map(media => <div key={media.id}><span>{media.name}</span><button type="button" disabled={busy || video.composition?.scenes.some(scene => scene.assetId === media.id) || video.composition?.audio?.assetId === media.id} aria-label={`移除 ${media.name}`} onClick={() => patch({ media: video.media.filter(item => item.id !== media.id) })}><X size={12} /></button></div>)}</div>}
    <textarea aria-label={zh ? "视频创意" : "Video prompt"} disabled={busy} value={prompt} maxLength={4000} onChange={event => setPrompt(event.target.value)} placeholder={motion ? zh ? "描述视频创意（可拖入图片 / 视频素材），智能生成并剪辑视频…" : "Describe a video idea; drop images or video clips to compose…" : zh ? "上传首帧图片，或描述主体、场景和镜头，让创意动起来…" : "Describe a scene or upload a first-frame image…"} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void start(event); } }} />
    <div className="vm-launcher-tools"><button type="button" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={16} />{zh ? "上传素材" : "Add media"}</button><select aria-label="视频比例" disabled={busy} value={video.ratio} onChange={event => patch({ ratio: event.target.value })}>{["16:9", "9:16", "1:1", "4:5"].map(ratio => <option key={ratio}>{ratio}</option>)}</select>{!motion && <select aria-label="视频时长" disabled={busy} value={video.duration} onChange={event => patch({ duration: Number(event.target.value) })}><option value={5}>5s</option><option value={10}>10s</option></select>}<button type="submit" disabled={busy || !prompt.trim() || !offer?.available}>{project.working ? <LoaderCircle size={16} /> : <ArrowUp size={16} />} {offer?.cost ?? "—"}</button></div>
    <small>{project.uploadProgress || (offer?.available ? `${offer.cost} ${zh ? "积分 / 次" : "credits / request"}` : zh ? "生成服务未就绪，可先打开工作台编辑素材。" : "Generation unavailable. You can open the editor.")}</small>
    {project.error && <p role="alert">{zh ? "操作未完成：" : "Operation failed: "}{project.error}</p>}
    <button type="button" disabled={busy} onClick={async () => { try { const saved = await project.save(); router.push(`/video?document=${saved.id}`); } catch { /* Error is shown above. */ } }}>{zh ? "打开视频工作台" : "Open video workspace"}</button>
    {motion && <div className="vm-launcher-templates">{VIDEO_TEMPLATES.map(([name, ratio], index) => <button type="button" key={index} disabled={busy} onClick={() => { patch({ ratio }); setPrompt(`制作一个 ${name} 的 ${ratio} 比例视频，内容是：`); }}>{name} · {ratio}</button>)}</div>}
    <input ref={input} hidden type="file" multiple={motion} accept={motion ? "image/png,image/jpeg,image/webp,.mp4,.mov,.mp3,.wav,.m4a,.aac,.flac,.ogg" : "image/png,image/jpeg,image/webp"} onChange={event => { void project.upload(event.target.files); event.target.value = ""; }} />
  </form>;
}
