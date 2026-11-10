"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import Link from "@/components/ui/NavigationLink";
import { ArrowUp, Check, Clapperboard, Download, FileVideo, ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import useVideoProject from "./useVideoProject";
import VideoMediaHint, { VIDEO_MEDIA_ACCEPT } from "./VideoMediaHint";
import VideoSubmissionRecovery from "./VideoSubmissionRecovery";
import VideoReferenceEditor from "./VideoReferenceEditor";
import VideoParameterFields from "./VideoParameterFields";
import VideoResultActions from "./VideoResultActions";
import VideoShotPlan from "./VideoShotPlan";
import useVideoCapabilities from "./useVideoCapabilities";
import { videoMessage } from "@/lib/video/messages";
import { previewUrl } from "@/lib/studio/image-url";
import MotionPreview from "./MotionPreview";
import MotionEditor from "./MotionEditor";
import WorkspaceSplit from "@/components/creation/WorkspaceSplit";
import VideoWorkspaceHeader from "./VideoWorkspaceHeader";
import { emptyComposition, timelineDuration } from "@/lib/video/timeline";
import { videoModelOffer } from "@/lib/video/model-choice";
import "@/components/creation/workspace-density.css";
import "./video.css";

const errorCopy = {
  VIDEO_REFERENCE_ROLE_UNSUPPORTED: "素材用途与当前模型不一致，请重新分配用途或更换模型。",
  VIDEO_FRAME_ORDER_INVALID: "请先设置首帧，再设置尾帧。",
  VIDEO_FIELDS_REQUIRED: "请补全当前模型需要的模板、原任务信息或请管理员检查附加参数。",
  VIDEO_FIELDS_INVALID: "当前模型不支持这些附加信息，请重新选择模型。",
  VIDEO_SOURCE_NOT_FOUND: "找不到可用于此操作的原视频，请选择同一上游账号下的兼容作品。",
  VIDEO_REFERENCE_URL_REQUIRED: "参考素材需要可公开访问的 HTTPS 站点，请联系管理员检查站点地址。",
  VIDEO_MEDIA_CHANGED: "参考素材已变化，请刷新项目后重试。",
  VIDEO_AUDIO_DURATION_INVALID: "参考音频每段至少 1.8 秒，合计不能超过 30 秒。",
  VIDEO_DURATION_UNSUPPORTED: "当前模型不支持此时长，请重新选择视频时长。",
  VIDEO_RATIO_UNSUPPORTED: "当前模型不支持此比例，请重新选择画幅。",
  VIDEO_REFERENCE_REQUIRED: "当前模型是图生视频，请先上传首帧图片。",
  VIDEO_REFERENCE_UNSUPPORTED: "当前模型只支持文生视频，请移除参考图或更换模型。",
  PROVIDER_CAPABILITY_UNSUPPORTED: "所选视频模型已停用或不可用，请重新选择。",
  PROVIDER_CONFIGURATION_CHANGED: "视频模型配置已变化，任务未切换到其他模型，请检查配置。",
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
  const router = useNavigationRouter();
  const [redoBusy, setRedoBusy] = useState(false);
  const project = useVideoProject({ documentId, mode: initialMode, userId, guardNavigation: true });
  const { draft, change, jobs, loading, error, setError, active, working } = project;
  const video = draft.content.video, motion = video.mode === "motion";
  const prompt = video.prompt || "", setPrompt = prompt => change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, prompt } } }));
  const { data: caps, error: capsError, retry: retryCapabilities } = useVideoCapabilities(Boolean(userId));
  const [editing, setEditing] = useState(false), [treeOpen, setTreeOpen] = useState(false), [chatOpen, setChatOpen] = useState(true), [tab, setTab] = useState("chat");
  const [time, setTime] = useState(.7), [selected, setSelected] = useState(null), [resultId, setResultId] = useState(null), [drop, setDrop] = useState(false);
  const input = useRef(null), chatEnd = useRef(null), jsonInput = useRef(null);
  const tool = motion ? "motion-plan" : "video", offer = motion ? caps?.tools.find(row => row.id === tool) : videoModelOffer(caps, video.provider, video), renderOffer = caps?.tools.find(row => row.id === "motion-render");
  const hasPrompt = Boolean(prompt.trim() || !motion && offer?.promptOptional && video.media.length);
  const disabled = redoBusy || loading || project.loadFailed || project.jobsLoading || working || motion && active || project.applying;
  const [history, setHistory] = useState({ past: [], future: [] });
  const results = draft.content.layers.filter(layer => layer.type === "video");
  const result = results.find(layer => layer.assetId === resultId) || results.at(-1);
  const showMotion = motion && video.composition && video.confirmed && !resultId;
  const text = (cn, en) => zh ? cn : en;
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [draft.content.messages.length, jobs.length]);
  const patchVideo = values => change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, ...values } } }));
  async function redoScene(scene) {
    if (disabled) return;
    setRedoBusy(true);
    try {
      const saved = await project.save();
      const child = await api("/api/video/scenes", { method: "POST", body: { documentId: saved.id, sceneId: scene.id, assetId: scene.assetId }, timeoutMs: 20000 });
      router.push(`/video?document=${child.id}`);
    } catch (failure) { setError(videoMessage(failure.message, zh)); }
    finally { setRedoBusy(false); }
  }
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
    event?.preventDefault(); if (!hasPrompt || disabled || active || !offer?.available) return;
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
  const upload = files => { if (!disabled && files?.length) void project.upload(files, offer); };
  function toggleChat() {
    if (window.matchMedia("(max-width: 760px)").matches) {
      setChatOpen(true); setTab(current => !chatOpen || current === "preview" ? "chat" : "preview");
    } else setChatOpen(value => !value);
  }
  function toggleFiles() {
    setTreeOpen(value => !value); setTab("preview");
  }
  if (caps && !loading && !caps[video.mode]) return <div className="vm-empty" role="alert"><p>{text("此模块暂未向当前账号开放，请联系管理员。", "This module is not enabled for your account.")}</p><Link href="/">{text("返回首页", "Back home")}</Link></div>;
  return <section className={`vm-workspace ${chatOpen ? "" : "chat-closed"} tab-${tab}`} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDrop(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(false); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDrop(false); upload(event.dataTransfer.files); }}>
    <VideoWorkspaceHeader project={project} zh={zh} disabled={disabled} motion={motion} editing={editing} chatOpen={chatOpen} tab={tab} treeOpen={treeOpen} history={history} onTravel={travel} onChat={toggleChat} onFiles={toggleFiles} onEdit={() => { setEditing(value => !value); setResultId(null); setTab("preview"); }} onDownloadProject={downloadProject} onRender={async () => { if (await project.submit("motion-render", "", renderOffer)) setEditing(false); }} renderOffer={renderOffer} result={result} showMotion={showMotion} onImport={() => jsonInput.current?.click()} />

    {capsError && <div className="vm-error" role="alert"><span>{videoMessage(capsError, zh)}</span><button onClick={retryCapabilities}>{text("重试加载视频能力", "Retry video capabilities")}</button></div>}
    {video.canvasOrigin && <Link className="vm-source-link" href={`/studio-v2?document=${video.canvasOrigin.documentId}`}>{text("返回来源画布", "Return to source canvas")}</Link>}
    {video.sceneOrigin && <Link className="vm-source-link" href={`/video?document=${video.sceneOrigin.documentId}`}>{text("返回原分镜工程", "Return to original composition")}</Link>}
    {error && <div className="vm-error" role="alert"><span>{zh ? errorCopy[error] || `操作未完成：${error}` : `Operation failed: ${error}`}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={14} /></button></div>}
    {project.loadFailed && <div className="vm-error"><span>{text("项目未能载入，编辑已暂停。", "Project could not be loaded. Editing is paused.")}</span><button onClick={() => window.location.reload()}>{text("重新加载", "Reload")}</button></div>}
    <VideoSubmissionRecovery project={project} zh={zh} />
    {project.recovery && <div className="vm-recovery" role="status">{text("发现尚未保存的本机草稿。", "An unsaved local draft is available.")}<button disabled={loading || project.loadFailed} onClick={project.recover}>{text("恢复草稿", "Restore draft")}</button><button onClick={project.discardRecovery}>{text("使用服务器版本", "Use saved version")}</button></div>}
    <WorkspaceSplit userId={userId} zh={zh}>
      {chatOpen && <aside className="vm-chat" aria-label={text("创作对话", "Creation conversation")}><div className="vm-chat-scroll">
        {!draft.content.messages.length && <p className="vm-chat-hint">{motion ? text("描述创意，添加素材，生成可编辑的视频方案。", "Describe an idea and add media to create an editable video plan.") : text("描述画面，并按所选模型添加参考素材生成视频。", "Describe a scene or add a first-frame image to generate video.")}</p>}
        {draft.content.messages.map(message => <article key={message.id} className={`vm-message is-${message.role}`}><span>{message.role === "user" ? text("你", "You") : "来塔绘梦"}</span><p>{message.text}</p></article>)}
        {jobs.slice(0, 8).map(job => <article className={`vm-job is-${job.status}`} key={job.id} role="status">{!terminalStatus(job.status) ? <LoaderCircle size={15} className="vm-spin" /> : job.status === "succeeded" ? <Check size={15} /> : <X size={15} />}<div><strong>{job.tool === "motion-render" ? text("导出 MP4", "Export MP4") : job.tool === "motion-plan" ? text("制作动效工程", "Compose motion") : text("生成视频", "Generate video")} · {zh ? statusLabel[job.status] || job.status : job.status}</strong>{!terminalStatus(job.status) && <p>{job.cancelRequested ? text("正在取消，请稍候…", "Cancelling…") : text("任务在后台执行，完成后作品会自动显示。", "Running in the background. Results appear automatically.")}</p>}{job.status === "succeeded" && job.resultData?.assets?.[0] && <p><button onClick={() => { setResultId(job.resultData.assets[0].id); setEditing(false); setTab("preview"); }}>{text("查看视频", "View video")}</button><a href={`/api/assets/${job.resultData.assets[0].id}?download=1`} download>{text("下载 MP4", "Download MP4")}</a></p>}{job.status === "succeeded" && job.resultData?.providerTaskId && <details><summary>{text("任务信息", "Task details")}</summary><p>{text("任务 ID", "Task ID")}: <code>{job.resultData.providerTaskId}</code></p>{job.resultData.providerVideoId && <p>{text("视频 ID", "Video ID")}: <code>{job.resultData.providerVideoId}</code></p>}</details>}{job.errorCode && job.status === "failed" && <p>{zh ? errorCopy[job.errorCode] || job.errorCode : job.errorCode}</p>}</div>{!terminalStatus(job.status) && <button disabled={job.cancelRequested} onClick={() => project.cancel(job)}>{text("取消", "Cancel")}</button>}</article>)}<div ref={chatEnd} />
      </div><form className="vm-composer" onSubmit={send}>
        <VideoReferenceEditor onReplace={(files, id) => project.upload(files, offer, id)} media={video.media} offer={offer} motion={motion} zh={zh} disabled={disabled} onChange={media => patchVideo({ media })} onAdd={() => input.current?.click()} lockedIds={[...(video.composition?.scenes || []).map(scene => scene.assetId), video.composition?.audio?.assetId].filter(Boolean)} />
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} disabled={disabled} placeholder={motion ? text("描述视频创意，也可以继续说说想怎么修改…", "Describe your video or the changes you want…") : text("描述主体、动作、场景、镜头运动…", "Describe the subject, action, scene and camera…")} aria-label={text("视频创意", "Video prompt")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
        <div className="vm-composer-tools"><button type="button" disabled={disabled} onClick={() => input.current?.click()} aria-label={text("上传素材", "Upload media")}><ImagePlus size={18} /></button>{motion && <select value={video.ratio} disabled={disabled} aria-label="视频比例" onChange={event => patchVideo({ ratio: event.target.value, ...(video.composition ? { composition: { ...video.composition, ratio: event.target.value } } : {}) })}>{["16:9", "9:16", "1:1", "4:5"].map(ratio => <option key={ratio}>{ratio}</option>)}</select>}<button className="vm-send" type="submit" disabled={!hasPrompt || disabled || active || !offer?.available} aria-label={text("开始生成", "Generate")}>{working ? <LoaderCircle size={17} className="vm-spin" /> : <ArrowUp size={17} />}<span>{offer?.cost ?? "—"}</span></button></div>
        {!motion && <><VideoParameterFields caps={caps} video={video} offer={offer} onChange={patchVideo} disabled={disabled} zh={zh} /><VideoMediaHint offer={offer} zh={zh} /></>}
        <small>{project.uploadProgress || (!offer?.available ? (zh ? errorCopy[offer?.reason] || "生成服务未就绪；可继续查看和手动编辑作品。" : offer?.reason || "Generation is unavailable; viewing and manual edits remain available.") : `${offer.cost} ${text("积分 / 次 · 失败按任务结算规则退回", "credits per request")}`)}</small>
      </form></aside>}
      <main className="vm-output" aria-label={text("视频作品", "Video artwork")}>
        <div className="vm-output-body">{treeOpen && <aside className="vm-files"><strong>{text("文件", "Files")}</strong>{video.composition && <button className={!resultId ? "is-selected" : ""} onClick={() => setResultId(null)}><Clapperboard size={14} />{draft.name}.motion</button>}{results.map((item, index) => <button key={item.id} onClick={() => { setResultId(item.assetId); setEditing(false); }}><FileVideo size={14} />{index + 1}. {item.name}</button>)}<button disabled={disabled} onClick={() => input.current?.click()}><Upload size={14} />{text("上传素材", "Upload media")}</button>{motion && <button disabled={disabled} onClick={() => jsonInput.current?.click()}>{text("导入本账号工程 JSON", "Import project JSON")}</button>}</aside>}
          <div className={`vm-preview-column${editing && showMotion ? " is-editing" : ""}`}>{loading ? <div className="vm-empty" role="status"><LoaderCircle className="vm-spin" />{text("正在打开项目…", "Opening project…")}</div> : motion && video.composition && !video.confirmed ? <div className="vm-design-review"><span>DESIGN</span><h2>{text("确认视频设计方案", "Review your video plan")}</h2><p>{video.composition.ratio} · {timelineDuration(video.composition)}s · {text("确认后即可本地播放，无需额外模型调用。", "Confirm to play locally without another model request.")}</p>{video.composition.scenes.map((scene, index) => <article key={scene.id}><small>{index + 1} · {scene.duration}s</small><strong>{scene.title || scene.name}</strong>{scene.subtitle && <p>{scene.subtitle}</p>}<small>{scene.animation} · {video.media.find(media => media.id === scene.assetId)?.name || text("纯文字 / 色块", "Text / color")}</small></article>)}<div><button disabled={disabled} onClick={() => { patchVideo({ confirmed: true }); setResultId(null); }}>{text("确认，开始预览", "Confirm and preview")}</button><button disabled={disabled} onClick={() => { patchVideo({ confirmed: true }); setEditing(true); }}>{text("手动调整方案", "Edit storyboard")}</button></div></div> : showMotion ? <><MotionPreview composition={video.composition} media={video.media} time={time} onTime={setTime} selected={selected} onSelect={setSelected} editing={editing} generating={active} zh={zh} />{editing && <MotionEditor onRedo={redoScene} composition={video.composition} media={video.media} selected={selected} onSelect={setSelected} onChange={patchComposition} onTime={setTime} zh={zh} disabled={disabled} />}{editing && project.id && <VideoShotPlan onRefreshQuote={retryCapabilities} key={project.id} project={project} caps={caps} zh={zh} disabled={disabled} />}</> : result ? <div className="vm-video-result"><video key={result.assetId} src={`/api/assets/${result.assetId}`} poster={result.posterAssetId ? previewUrl(result.posterAssetId, 1280) : undefined} controls playsInline preload="metadata" onDoubleClick={event => { void event.currentTarget.requestFullscreen?.().catch(() => {}); }} /><VideoResultActions sceneOrigin={video.sceneOrigin} key={result.assetId} result={result} zh={zh} allowReference={!motion && Boolean(offer?.mediaLimits?.video)} onReuse={!motion ? input => { patchVideo({ provider: input.provider || undefined, prompt: input.params.prompt || "", ratio: input.params.ratio || "16:9", duration: input.params.duration || 5, videoVariant: input.params.videoVariant, media: input.params.media || (input.assetId ? [{ id: input.assetId, type: "image", name: "首帧", duration: 0 }] : []), videoFields: input.params.videoFields || {} }); } : undefined} onReference={!motion ? media => { if (!video.media.some(item => item.id === media.id)) patchVideo({ media: [...video.media, { ...media, role: "reference_video" }] }); } : undefined} onMedia={media => change(current => ({ ...current, content: { ...current.content, layers: current.content.layers.map(layer => layer.assetId === media.id ? { ...layer, posterAssetId: media.posterAssetId, duration: media.duration, pixelWidth: media.width, pixelHeight: media.height } : layer) } }))} /></div> : <div className="vm-empty"><h2>{active ? text("正在制作，请稍候", "Your video is being created") : text("作品将在这里呈现", "Your video appears here")}</h2><p>{text("支持拖入素材 · 双击预览可全屏", "Drop media here · Double-click preview for fullscreen")}</p>{motion && <button disabled={disabled} onClick={() => { patchComposition(emptyComposition(requestKey())); setEditing(true); }}>{text("新建空白动效工程", "Create blank composition")}</button>}</div>}</div>
        </div></main>
    </WorkspaceSplit>
    <input ref={input} hidden type="file" multiple={motion || Boolean(offer?.mediaLimits)} accept={motion || offer?.mediaLimits?.video || offer?.mediaLimits?.audio ? VIDEO_MEDIA_ACCEPT : "image/png,image/jpeg,image/webp"} onChange={event => { upload(event.target.files); event.target.value = ""; }} />
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
