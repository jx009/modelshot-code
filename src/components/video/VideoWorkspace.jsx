"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import Link from "@/components/ui/NavigationLink";
import { ArrowUp, Check, ChevronLeft, Clapperboard, Download, FileVideo, FolderOpen, ImagePlus, LoaderCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Play, Save, Upload, Undo2, Redo2, X } from "lucide-react";
import useVideoProject from "./useVideoProject";
import MotionPreview from "./MotionPreview";
import MotionEditor from "./MotionEditor";
import { VIDEO_TEMPLATES, emptyComposition, timelineDuration } from "@/lib/video/timeline";
import "@/components/creation/workspace-density.css";
import "./video.css";

const errorCopy = {
  CREATION_NOT_ENABLED: "此模块暂未向当前账号开放，请联系管理员。",
  SERVICE_NOT_CONFIGURED: "视频通道未配置，请联系管理员配置视频模型。",
  WORKER_UNAVAILABLE: "视频任务服务暂未就绪，已有作品仍可查看。",
  MOTION_CONFIRM_REQUIRED: "请先确认设计方案再导出视频。",
  MOTION_RENDER_UNAVAILABLE: "视频导出服务未就绪，请更新 tools 镜像。",
  MOTION_RENDER_BUSY: "视频合成服务正在处理其他作品，请稍后重试。",
  VIDEO_PROVIDER_REJECTED: "上游视频模型拒绝了请求，请检查模型配置或稍后重试。",
  VIDEO_MEDIA_FORMAT_INVALID: "不支持此素材格式，请使用 MP4、MOV 或常见音频文件。",
  MOTION_RESULT_INVALID: "模型未返回有效的视频工程，本次未完成。可简化描述后重试。",
  MOTION_MEDIA_INVALID: "视频工程引用了不可用素材，请重新选择素材。",
  MOTION_TRIM_INVALID: "场景时长超出了素材长度，请缩短时长或调整入点。",
  VIDEO_MEDIA_INVALID: "素材无法读取。请使用 MP4 / MOV 视频或 MP3 / WAV / M4A 音频。",
  VIDEO_MEDIA_TOO_LARGE: "单个视频或音频不能超过 64 MB。",
  VIDEO_MEDIA_LIMIT: "素材数量已达到上限，请先移除一个。",
  VIDEO_REFERENCE_IMAGE_ONLY: "视频生成目前支持一张首帧图片；剪辑视频素材请使用视频制作。",
  DOCUMENT_NOT_LOADED: "项目尚未载入，请重新加载。",
  DOCUMENT_BUSY: "当前项目已有任务运行，请等待完成或先取消。",
  MOTION_RENDER_FAILED: "视频导出失败，工程仍已保存。请检查素材或稍后重试。",
  MOTION_MEDIA_TOO_LARGE: "本次导出素材总量超过 256 MB，请减少素材。",
  DOCUMENT_VERSION_CONFLICT: "另一窗口已经保存了更新。当前修改保留在本机，请刷新后选择恢复草稿。",
  PRICE_CHANGED: "积分价格已更新，请刷新费用后重新提交。",
  VIDEO_PROVIDER_FAILED: "视频模型生成失败，任务已结束，请调整提示词后重试。",
  PROVIDER_RESULT_UNAVAILABLE: "模型未返回结果，本次任务未完成。",
  VIDEO_POLL_EXPIRED: "视频模型处理超时，本次任务已结束。",
};
const statusLabel = { queued: "等待开始", running: "正在生成", reconciling: "模型处理中", succeeded: "已完成", failed: "执行失败", cancelled: "已取消", partial_success: "部分完成" };

function Workspace({ documentId, initialMode, userId, zh }) {
  const project = useVideoProject({ documentId, mode: initialMode, userId, guardNavigation: true });
  const { draft, change, jobs, loading, error, setError, active, working } = project;
  const video = draft.content.video, motion = video.mode === "motion";
  const [caps, setCaps] = useState(null), [prompt, setPrompt] = useState(""), [editing, setEditing] = useState(false), [treeOpen, setTreeOpen] = useState(false), [chatOpen, setChatOpen] = useState(true), [tab, setTab] = useState("chat");
  const [time, setTime] = useState(.7), [selected, setSelected] = useState(null), [resultId, setResultId] = useState(null), [drop, setDrop] = useState(false);
  const input = useRef(null), chatEnd = useRef(null), jsonInput = useRef(null);
  const tool = motion ? "motion-plan" : "video", offer = caps?.tools.find(row => row.id === tool), renderOffer = caps?.tools.find(row => row.id === "motion-render");
  const disabled = loading || project.loadFailed || project.jobsLoading || working || active || project.applying;
  const [history, setHistory] = useState({ past: [], future: [] });
  const results = draft.content.layers.filter(layer => layer.type === "video");
  const result = results.find(layer => layer.assetId === resultId) || results.at(-1);
  const showMotion = motion && video.composition && video.confirmed && !resultId;
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => { const abort = new AbortController(); api("/api/video/capabilities", { signal: abort.signal }).then(setCaps).catch(failure => { if (!abort.signal.aborted) setError(failure.message); }); return () => abort.abort(); }, [setError]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [draft.content.messages.length, jobs.length]);
  const patchVideo = values => change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  const patchComposition = composition => {
    if (video.composition) setHistory(current => ({ past: [...current.past, video.composition].slice(-50), future: [] }));
    patchVideo({ composition, ratio: composition.ratio, confirmed: true }); setResultId(null);
  };
  const travel = direction => {
    const list = history[direction]; if (!list.length || disabled) return;
    const next = list.at(-1);
    setHistory(direction === "past" ? { past: list.slice(0, -1), future: [...history.future, video.composition] } : { past: [...history.past, video.composition], future: list.slice(0, -1) });
    patchVideo({ composition: next, ratio: next.ratio }); setResultId(null);
  };
  useEffect(() => {
    if (!documentId && project.id && !project.dirty && !working && !project.saving) {
      const url = new URL(window.location.href); url.searchParams.set("document", project.id); url.searchParams.delete("mode");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [documentId, project.id, project.dirty, project.saving, working]);
  async function send(event) {
    event?.preventDefault(); if (!prompt.trim() || disabled || !offer?.available) return;
    const job = await project.submit(tool, prompt.trim(), offer);
    if (job) { setPrompt(""); setResultId(null); setEditing(false); setHistory({ past: [], future: [] }); }
  }
  function downloadProject() {
    const data = new Blob([JSON.stringify(video, null, 2)], { type: "application/json" }), url = URL.createObjectURL(data), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${draft.name}.motion.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importProject(file) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("VIDEO_MEDIA_TOO_LARGE");
      const { videoDocumentSchema } = await import("@/lib/video/schema");
      const parsed = videoDocumentSchema.parse(JSON.parse(await file.text()));
      if (parsed.mode !== "motion") throw new Error("MOTION_RESULT_INVALID");
      patchVideo(parsed); setEditing(true); setResultId(null); await project.save();
    } catch (failure) { setError(failure.code || failure.message || "MOTION_RESULT_INVALID"); }
  }
  const upload = files => { if (!disabled && files?.length) void project.upload(files); };
  if (caps && !loading && !caps[video.mode]) return <div className="vm-empty" role="alert"><p>{text("此模块暂未向当前账号开放，请联系管理员。", "This module is not enabled for your account.")}</p><Link href="/">{text("返回首页", "Back home")}</Link></div>;
  return <section className={`vm-workspace ${chatOpen ? "" : "chat-closed"} tab-${tab}`} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDrop(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(false); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDrop(false); upload(event.dataTransfer.files); }}>
    <header className="vm-project-header"><Link href="/" aria-label={text("返回首页", "Back home")}><ChevronLeft size={18} /></Link><Clapperboard size={18} /><input value={draft.name} aria-label={text("项目名称", "Project name")} maxLength={100} disabled={disabled} onChange={event => change(current => ({ ...current, name: event.target.value }))} /><span className="vm-save-status" role="status">{project.saving ? text("保存中", "Saving") : project.dirty ? text("待保存", "Unsaved") : project.id ? text("已保存", "Saved") : text("新项目", "New project")}</span><button type="button" onClick={() => { setError(""); void project.save().catch(() => {}); }} disabled={disabled || project.saving} title={text("保存项目", "Save project")}><Save size={15} /></button><button type="button" onClick={() => setChatOpen(value => !value)} aria-label={text("切换对话栏", "Toggle conversation")}><MessageSquare size={16} /></button></header>
    <nav className="vm-mobile-tabs"><button onClick={() => { setChatOpen(true); setTab("chat"); }} aria-pressed={tab === "chat"}>{text("对话", "Chat")}</button><button onClick={() => setTab("preview")} aria-pressed={tab === "preview"}>{text("作品", "Preview")}</button></nav>
    {error && <div className="vm-error" role="alert"><span>{zh ? errorCopy[error] || `操作未完成：${error}` : `Operation failed: ${error}`}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={14} /></button></div>}
    {project.loadFailed && <div className="vm-error"><span>{text("项目未能载入，编辑已暂停。", "Project could not be loaded. Editing is paused.")}</span><button onClick={() => window.location.reload()}>{text("重新加载", "Reload")}</button></div>}
    {project.recovery && <div className="vm-recovery" role="status">{text("发现尚未保存的本机草稿。", "An unsaved local draft is available.")}<button disabled={loading || project.loadFailed} onClick={project.recover}>{text("恢复草稿", "Restore draft")}</button><button onClick={project.discardRecovery}>{text("使用服务器版本", "Use saved version")}</button></div>}
    <div className="vm-workspace-body">
      {chatOpen && <aside className="vm-chat"><div className="vm-pane-title"><strong>{motion ? text("视频制作", "Video production") : text("视频生成", "Video generation")}</strong><button aria-label="收起对话" onClick={() => setChatOpen(false)}><PanelLeftClose size={15} /></button></div><div className="vm-chat-scroll">
        {!draft.content.messages.length && <div className="vm-intro"><Clapperboard size={30} /><h2>{motion ? text("让创意流动起来", "Bring your story to life") : text("把想象变成画面", "Turn ideas into video")}</h2><p>{motion ? text("描述创意，上传图片、视频或配乐，生成可编辑的动效工程。", "Describe a story and add media to compose an editable video.") : text("描述画面，或上传首帧图片，生成短视频。", "Describe a scene or add a first-frame image to generate a clip.")}</p>{motion && <div className="vm-templates">{VIDEO_TEMPLATES.map(([name, ratio], index) => <button key={index} disabled={disabled} onClick={() => { patchVideo({ ratio }); setPrompt(`制作一个 ${name} 的 ${ratio} 比例视频，内容是：`); }}>{name}<small>{ratio}</small></button>)}</div>}</div>}
        {draft.content.messages.map(message => <article key={message.id} className={`vm-message is-${message.role}`}><span>{message.role === "user" ? text("你", "You") : "来塔绘梦"}</span><p>{message.text}</p></article>)}
        {jobs.slice(0, 8).map(job => <article className={`vm-job is-${job.status}`} key={job.id} role="status">{!terminalStatus(job.status) ? <LoaderCircle size={15} className="vm-spin" /> : job.status === "succeeded" ? <Check size={15} /> : <X size={15} />}<div><strong>{job.tool === "motion-render" ? text("导出 MP4", "Export MP4") : job.tool === "motion-plan" ? text("制作动效工程", "Compose motion") : text("生成视频", "Generate video")} · {zh ? statusLabel[job.status] || job.status : job.status}</strong>{!terminalStatus(job.status) && <p>{job.cancelRequested ? text("正在取消，请稍候…", "Cancelling…") : text("任务在后台执行，完成后作品会自动显示。", "Running in the background. Results appear automatically.")}</p>}{job.status === "succeeded" && job.resultData?.assets?.[0] && <p><button onClick={() => { setResultId(job.resultData.assets[0].id); setEditing(false); setTab("preview"); }}>{text("查看视频", "View video")}</button><a href={`/api/assets/${job.resultData.assets[0].id}?download=1`} download>{text("下载 MP4", "Download MP4")}</a></p>}{job.errorCode && job.status === "failed" && <p>{zh ? errorCopy[job.errorCode] || job.errorCode : job.errorCode}</p>}</div>{!terminalStatus(job.status) && <button disabled={job.cancelRequested} onClick={() => project.cancel(job)}>{text("取消", "Cancel")}</button>}</article>)}<div ref={chatEnd} />
      </div><form className="vm-composer" onSubmit={send}>
        {video.media.length > 0 && <div className="vm-attachments">{video.media.map(media => <div key={media.id}><FileVideo size={13} /><span title={media.name}>{media.name}</span><button type="button" disabled={disabled || video.composition?.scenes.some(scene => scene.assetId === media.id) || video.composition?.audio?.assetId === media.id} aria-label={`移除 ${media.name}`} onClick={() => patchVideo({ media: video.media.filter(item => item.id !== media.id) })}><X size={12} /></button></div>)}</div>}
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} disabled={disabled} placeholder={motion ? text("描述视频创意，也可以继续说说想怎么修改…", "Describe your video or the changes you want…") : text("描述主体、动作、场景、镜头运动…", "Describe the subject, action, scene and camera…")} aria-label={text("视频创意", "Video prompt")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
        <div className="vm-composer-tools"><button type="button" disabled={disabled} onClick={() => input.current?.click()} aria-label={text("上传素材", "Upload media")}><ImagePlus size={18} /></button><select value={video.ratio} disabled={disabled} aria-label="视频比例" onChange={event => patchVideo({ ratio: event.target.value, ...(video.composition ? { composition: { ...video.composition, ratio: event.target.value } } : {}) })}>{["16:9", "9:16", "1:1", "4:5"].map(ratio => <option key={ratio}>{ratio}</option>)}</select>{!motion && <select aria-label="视频时长" disabled={disabled} value={video.duration} onChange={event => patchVideo({ duration: Number(event.target.value) })}><option value={5}>5s</option><option value={10}>10s</option></select>}<button className="vm-send" type="submit" disabled={!prompt.trim() || disabled || !offer?.available} aria-label={text("开始生成", "Generate")}>{working ? <LoaderCircle size={17} className="vm-spin" /> : <ArrowUp size={17} />}<span>{offer?.cost ?? "—"}</span></button></div>
        <small>{project.uploadProgress || (!offer?.available ? (zh ? errorCopy[offer?.reason] || "生成服务未就绪；可继续查看和手动编辑作品。" : offer?.reason || "Generation is unavailable; viewing and manual edits remain available.") : `${offer.cost} ${text("积分 / 次 · 失败按任务结算规则退回", "credits per request")}`)}</small>
      </form></aside>}
      <main className="vm-output"><div className="vm-output-toolbar"><button type="button" onClick={() => setTreeOpen(value => !value)} aria-label={text("展开文件栏", "Toggle files")}>{treeOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button><span className="vm-output-name">{showMotion ? `${draft.name}.motion` : result?.name || text("内容预览", "Preview")}</span>{motion && video.composition && video.confirmed && <><button type="button" onClick={() => { setEditing(value => !value); setResultId(null); }}>{editing ? <Check size={14} /> : <Pencil size={14} />}{editing ? text("完成编辑", "Done") : text("编辑", "Edit")}</button><button type="button" disabled={disabled || !history.past.length} onClick={() => travel("past")} aria-label="撤销"><Undo2 size={14} /></button><button type="button" disabled={disabled || !history.future.length} onClick={() => travel("future")} aria-label="重做"><Redo2 size={14} /></button><button type="button" onClick={downloadProject} title="下载可编辑工程"><FolderOpen size={15} /></button><button type="button" disabled={disabled || !renderOffer?.available || !video.confirmed} onClick={async () => { if (await project.submit("motion-render", "", renderOffer)) setEditing(false); }}><Download size={14} />MP4</button></>}{result && (!showMotion || !video.composition) && <a href={`/api/assets/${result.assetId}?download=1`} download><Download size={15} />MP4</a>}</div>
        <div className="vm-output-body">{treeOpen && <aside className="vm-files"><strong>{text("文件", "Files")}</strong>{video.composition && <button className={!resultId ? "is-selected" : ""} onClick={() => setResultId(null)}><Clapperboard size={14} />{draft.name}.motion</button>}{results.map((item, index) => <button key={item.id} onClick={() => { setResultId(item.assetId); setEditing(false); }}><FileVideo size={14} />{index + 1}. {item.name}</button>)}<button disabled={disabled} onClick={() => input.current?.click()}><Upload size={14} />{text("上传素材", "Upload media")}</button>{motion && <button disabled={disabled} onClick={() => jsonInput.current?.click()}>{text("导入本账号工程 JSON", "Import project JSON")}</button>}</aside>}
          <div className="vm-preview-column">{loading ? <div className="vm-empty" role="status"><LoaderCircle className="vm-spin" />{text("正在打开项目…", "Opening project…")}</div> : motion && video.composition && !video.confirmed ? <div className="vm-design-review"><span>DESIGN</span><h2>{text("确认视频设计方案", "Review your video plan")}</h2><p>{video.composition.ratio} · {timelineDuration(video.composition)}s · {text("确认后即可本地播放，无需额外模型调用。", "Confirm to play locally without another model request.")}</p>{video.composition.scenes.map((scene, index) => <article key={scene.id}><small>{index + 1} · {scene.duration}s</small><strong>{scene.title || scene.name}</strong>{scene.subtitle && <p>{scene.subtitle}</p>}<small>{scene.animation} · {video.media.find(media => media.id === scene.assetId)?.name || text("纯文字 / 色块", "Text / color")}</small></article>)}<div><button disabled={disabled} onClick={() => { patchVideo({ confirmed: true }); setResultId(null); }}>{text("确认，开始预览", "Confirm and preview")}</button><button disabled={disabled} onClick={() => { patchVideo({ confirmed: true }); setEditing(true); }}>{text("手动调整方案", "Edit storyboard")}</button></div></div> : showMotion ? <><MotionPreview composition={video.composition} media={video.media} time={time} onTime={setTime} selected={selected} onSelect={setSelected} editing={editing} zh={zh} /><div className="vm-preview-meta">{video.composition.scenes.length} {text("个场景", "scenes")} · {timelineDuration(video.composition)}s · {video.composition.ratio} · 24fps{active && <span>{text("正在生成新版本，当前版本仍可预览", "A new version is running")}</span>}</div>{editing && <MotionEditor composition={video.composition} media={video.media} selected={selected} onSelect={setSelected} onChange={patchComposition} onTime={setTime} zh={zh} disabled={disabled} />}</> : result ? <div className="vm-video-result"><video key={result.assetId} src={`/api/assets/${result.assetId}`} controls playsInline preload="metadata" onDoubleClick={event => { void event.currentTarget.requestFullscreen?.().catch(() => {}); }} /></div> : <div className="vm-empty"><Play size={38} strokeWidth={1} /><h2>{active ? text("正在制作，请稍候", "Your video is being created") : text("作品将在这里呈现", "Your video appears here")}</h2><p>{text("支持拖入素材 · 双击预览可全屏", "Drop media here · Double-click preview for fullscreen")}</p>{motion && <button disabled={disabled} onClick={() => { patchComposition(emptyComposition(requestKey())); setEditing(true); }}>{text("新建空白动效工程", "Create blank composition")}</button>}</div>}</div>
        </div></main>
    </div>
    <input ref={input} hidden type="file" multiple={motion} accept={motion ? "image/png,image/jpeg,image/webp,.mp4,.mov,.mp3,.wav,.m4a,.aac,.flac,.ogg" : "image/png,image/jpeg,image/webp"} onChange={event => { upload(event.target.files); event.target.value = ""; }} />
    <input ref={jsonInput} hidden type="file" accept=".json" onChange={event => { void importProject(event.target.files?.[0]); event.target.value = ""; }} />
    {drop && <div className="vm-drop"><Upload size={32} />{text("松开即可上传素材", "Drop to upload media")}</div>}
  </section>;
}
function Page() {
  const query = useSearchParams(), { data: session, status } = useSession(), auth = useAuth(), zh = useLocale() === "zh";
  if (status === "loading") return <div className="vm-empty" role="status">正在打开视频工作台…</div>;
  if (!session?.user?.id) return <div className="vm-empty"><button onClick={() => auth.open()}>{zh ? "登录后开始视频创作" : "Sign in to create videos"}</button></div>;
  const id = query.get("document"), mode = query.get("mode") === "motion" ? "motion" : "video";
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return <div className="vm-empty">项目链接无效</div>;
  return <Workspace key={`${session.user.id}:${id || mode}`} userId={session.user.id} documentId={id} initialMode={mode} zh={zh} />;
}
export default function VideoWorkspace() { return <Suspense fallback={<div className="vm-empty">正在打开视频工作台…</div>}><Page /></Suspense>; }
