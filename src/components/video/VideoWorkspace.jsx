"use client";
import { BrandMark } from "@/components/BrandLogo";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import { useNavigationRouter } from "@/hooks/useNavigationRouter";
import Link from "@/components/ui/NavigationLink";
import GuestGate from "@/components/ui/GuestGate";
import { ArrowUp, Check, Clapperboard, Download, FileVideo, ImagePlus, LoaderCircle, Upload, X, ArrowUpRight } from "lucide-react";
import useVideoProject from "./useVideoProject";
import VideoMediaHint, { VIDEO_MEDIA_ACCEPT } from "./VideoMediaHint";
import VideoSubmissionRecovery from "./VideoSubmissionRecovery";
import VideoReferenceEditor from "./VideoReferenceEditor";
import VideoParameterFields from "./VideoParameterFields";
import VideoResultActions from "./VideoResultActions";
import useVideoCapabilities from "./useVideoCapabilities";
import { videoMessage } from "@/lib/video/messages";
import { previewUrl } from "@/lib/studio/image-url";
import MotionPreview from "./MotionPreview";
import StoryboardWorkspace from "./StoryboardWorkspace";
import useStoryboardRun from "./useStoryboardRun";
import { FrameCandidates, JobElapsed, VersionStrip } from "./VideoShotTools";
import PromptOptimizer from "@/components/studio/PromptOptimizer";
import { appendVideoReference, referenceRole } from "@/lib/video/references";
import { MOTION_SCENARIO_PRESETS } from "@/lib/video/scenarios";
import WorkspaceSplit from "@/components/creation/WorkspaceSplit";
import VideoWorkspaceHeader from "./VideoWorkspaceHeader";
import { emptyComposition } from "@/lib/video/timeline";
import { videoModelOffer } from "@/lib/video/model-choice";
import "@/components/creation/workspace-density.css";
import "./video.css";
import BrandLoader from "@/components/ui/BrandLoader";
import VideoPlayer from "@/components/ui/VideoPlayer";
import ProjectManager from "@/components/studio/ProjectManager";

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
  VIDEO_REFERENCE_IMAGE_ONLY: "单镜头目前支持一张首帧图片；剪辑多段视频素材请使用分镜成片。",
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

const VIDEO_IDEAS = [
  ["清晨的海边小镇，镜头缓慢推进，海鸥掠过", "A seaside town at dawn, slow push-in, gulls flying past"],
  ["运动鞋在雨夜街头溅起水花，慢动作特写", "Sneakers splashing on a rainy street, slow-motion close-up"],
  ["一杯咖啡升起热气，暖色逆光，微距镜头", "Steam rising from coffee, warm backlight, macro shot"],
];
const MOTION_IDEAS = [
  ["新品咖啡 15 秒宣传短片，节奏明快，结尾出现品牌标语", "A 15s upbeat coffee promo ending with the brand line"],
  ["把三张商品图做成带字幕的种草视频", "Turn three product shots into a captioned showcase video"],
  ["城市夜景延时风格的品牌开场动画", "A city-night timelapse style brand intro"],
];

function Workspace({ documentId, initialMode, userId, zh }) {
  const router = useNavigationRouter();
  const [redoBusy, setRedoBusy] = useState(false);
  const project = useVideoProject({ documentId, mode: initialMode, userId, guardNavigation: true });
  const { draft, change, jobs, loading, error, setError, active, working } = project;
  const video = draft.content.video, motion = video.mode === "motion";
  const prompt = video.prompt || "", setPrompt = prompt => change(current => ({ ...current, content: { ...current.content, video: { ...current.content.video, prompt } } }));
  const { data: caps, error: capsError, retry: retryCapabilities } = useVideoCapabilities(Boolean(userId));
  const locale = useLocale(), [projectsOpen, setProjectsOpen] = useState(false);
  const [view, setView] = useState("table"), [treeOpen, setTreeOpen] = useState(false), [chatOpen, setChatOpen] = useState(true), [tab, setTab] = useState("chat");
  const [time, setTime] = useState(.7), [selected, setSelected] = useState(null), [resultId, setResultId] = useState(null), [drop, setDrop] = useState(false);
  const input = useRef(null), chatEnd = useRef(null), jsonInput = useRef(null);
  const tool = motion ? "motion-plan" : "video", offer = motion ? caps?.tools.find(row => row.id === tool) : videoModelOffer(caps, video.provider, video), renderOffer = caps?.tools.find(row => row.id === "motion-render");
  const hasPrompt = Boolean(prompt.trim() || !motion && offer?.promptOptional && video.media.length);
  // 分镜运行进行中时锁定工程，结束后同步服务端写回的首帧、片段与成片。
  const storyboard = useStoryboardRun(project, { onFinished: run => { void project.refresh().catch(() => {}); if (run.status === "succeeded") setView("result"); } });
  const editing = view === "table";
  const disabled = redoBusy || loading || project.loadFailed || project.jobsLoading || working || motion && (active || storyboard.active) || project.applying;
  const [history, setHistory] = useState({ past: [], future: [] });
  const results = draft.content.layers.filter(layer => layer.type === "video");
  const result = results.find(layer => layer.assetId === resultId) || results.at(-1);
  const showMotion = motion && Boolean(video.composition);
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
    if (job) { setPrompt(""); setResultId(null); setView("table"); setHistory({ past: [], future: [] }); }
  }
  const frameOffer = caps?.tools.find(row => row.id === "generate");
  async function generateFrame() {
    if (disabled || active || !prompt.trim()) return;
    await project.submit("generate", `${prompt.trim()}。视频首帧画面，电影感构图，主体清晰，画面中不要出现文字或水印。`, frameOffer);
  }
  // 选中的候选图按当前视频模型的参考方式加入素材：首帧模型作为首帧，参考图模型作为参考图。
  function pickFrame(asset) {
    const layout = offer?.referenceLayout || "reference", item = { id: asset.id, name: "AI 首帧.png", type: "image", duration: 0 };
    // 首帧类模型：替换原首帧并放在最前；参考图模型：追加，达到图片上限时替换第一张。
    if (["frames", "first_frame"].includes(layout)) {
      const rest = video.media.filter((entry, index) => referenceRole(entry, index, video.media, layout) !== "first_frame");
      patchVideo({ media: [{ ...item, role: "first_frame" }, ...rest] });
      return;
    }
    const images = video.media.filter(entry => entry.type === "image"), full = images.length >= (offer?.mediaLimits?.image || 1);
    patchVideo({ media: appendVideoReference(full ? video.media.filter(entry => entry.id !== images[0].id) : video.media, item, layout) });
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
      patchVideo(parsed); setView("table"); setResultId(null); await project.save();
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
    <VideoWorkspaceHeader onProjects={() => setProjectsOpen(true)} project={project} zh={zh} disabled={disabled} motion={motion} editing={editing} chatOpen={chatOpen} tab={tab} treeOpen={treeOpen} history={history} onTravel={travel} onChat={toggleChat} onFiles={toggleFiles} onEdit={() => { setView(value => value === "table" ? "preview" : "table"); setResultId(null); setTab("preview"); }} onDownloadProject={downloadProject} onRender={async () => { if (await project.submit("motion-render", "", renderOffer)) setView("preview"); }} renderOffer={renderOffer} result={result} showMotion={showMotion} onImport={() => jsonInput.current?.click()} />

    {capsError && <div className="vm-error" role="alert"><span>{videoMessage(capsError, zh)}</span><button onClick={retryCapabilities}>{text("重试加载视频能力", "Retry video capabilities")}</button></div>}
    {video.canvasOrigin && <Link className="vm-source-link" href={`/studio-v2?document=${video.canvasOrigin.documentId}`}>{text("返回来源画布", "Return to source canvas")}</Link>}
    {video.sceneOrigin && <Link className="vm-source-link" href={`/video?document=${video.sceneOrigin.documentId}`}>{text("返回原分镜工程", "Return to original composition")}</Link>}
    {error && <div className="vm-error" role="alert"><span>{zh ? errorCopy[error] || videoMessage(error, zh) : videoMessage(error, zh)}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={14} /></button></div>}
    {project.loadFailed && <div className="vm-error"><span>{text("项目未能载入，编辑已暂停。", "Project could not be loaded. Editing is paused.")}</span><button onClick={() => window.location.reload()}>{text("重新加载", "Reload")}</button></div>}
    <VideoSubmissionRecovery project={project} zh={zh} />
    {project.recovery && <div className="vm-recovery" role="status">{text("发现尚未保存的本机草稿。", "An unsaved local draft is available.")}<button disabled={loading || project.loadFailed} onClick={project.recover}>{text("恢复草稿", "Restore draft")}</button><button onClick={project.discardRecovery}>{text("使用服务器版本", "Use saved version")}</button></div>}
    <WorkspaceSplit userId={userId} zh={zh}>
      {chatOpen && <aside className="vm-chat" aria-label={text("创作对话", "Creation conversation")}><div className="vm-chat-scroll">
        {!draft.content.messages.length && <div className="vm-chat-hint ws-welcome"><span className="ws-orb" aria-hidden="true"><BrandMark size={28} /></span><h2>{motion ? text("分镜成片：先写分镜，再出片", "Storyboard first, then the video") : text("一句话，生成一段视频", "One sentence, one video")}</h2><p>{motion ? text("说说主题和想要的效果，AI 写好每一镜的画面、旁白和时长；你在分镜表里改好后，逐镜生成并自动剪成完整视频。", "Describe your idea. AI writes each shot; edit the storyboard, then every shot is generated and edited into one video.") : text("描述主体、动作和镜头，或上传一张图片作为首帧，按所选模型生成视频。", "Describe the subject, action and camera, or upload a first frame.")}</p>
          {/* 新项目首次保存前可切换创作方式；保存后工程类型固定。 */}
          {!project.id && caps?.video && caps?.motion && <div className="vm-modes" role="radiogroup" aria-label={text("视频创作方式", "Video mode")}><Link role="radio" aria-checked={!motion} href="/video">{text("单镜头", "Single shot")}</Link><Link role="radio" aria-checked={motion} href="/video?mode=motion">{text("分镜成片", "Storyboard")}</Link></div>}
          {motion && <div className="vm-scenarios" role="group" aria-label={text("场景", "Scenario")}>{Object.entries(MOTION_SCENARIO_PRESETS).map(([id, preset]) => <button type="button" key={id} aria-pressed={video.scenario === id} disabled={disabled} onClick={() => patchVideo(video.scenario === id ? { scenario: null } : { scenario: id, ratio: preset.ratio })}><strong>{zh ? preset.zh : preset.en}</strong><small>{zh ? preset.hint[0] : preset.hint[1]}</small></button>)}</div>}
          <div className="ws-suggestions">{(motion ? MOTION_IDEAS : VIDEO_IDEAS).map(([cn, en]) => <button type="button" key={cn} disabled={disabled} onClick={() => setPrompt(zh ? cn : en)}><span>{zh ? cn : en}</span><ArrowUpRight size={14} /></button>)}</div></div>}
        {draft.content.messages.map(message => <article key={message.id} className={`vm-message is-${message.role}`}><span>{message.role === "user" ? text("你", "You") : "来塔绘梦"}</span><p>{message.text}</p></article>)}
        {jobs.slice(0, 8).map(job => <article className={`vm-job is-${job.status}`} key={job.id} role="status">{!terminalStatus(job.status) ? <LoaderCircle size={15} className="vm-spin" /> : job.status === "succeeded" ? <Check size={15} /> : <X size={15} />}<div><strong>{job.tool === "motion-render" ? text("导出成片", "Export video") : job.tool === "motion-plan" ? text("撰写分镜", "Write storyboard") : job.tool === "generate" ? text("生成首帧", "First frame") : text("生成视频", "Generate video")} · {zh ? statusLabel[job.status] || job.status : job.status}</strong>{!terminalStatus(job.status) && <p>{job.cancelRequested ? text("正在取消，请稍候…", "Cancelling…") : job.status === "queued" ? text("排队中，马上开始…", "Queued, starting soon…") : text("后台生成中，完成后自动显示，可以先离开页面。", "Running in the background; you can leave this page.")}</p>}{!terminalStatus(job.status) && <JobElapsed job={job} zh={zh} />}{job.status === "succeeded" && job.resultData?.assets?.[0] && <p><button onClick={() => { setResultId(job.resultData.assets[0].id); setView("result"); setTab("preview"); }}>{text("查看视频", "View video")}</button><a href={`/api/assets/${job.resultData.assets[0].id}?download=1`} download>{text("下载 MP4", "Download MP4")}</a></p>}{job.status === "succeeded" && job.resultData?.providerTaskId && <details><summary>{text("任务信息", "Task details")}</summary><p>{text("任务 ID", "Task ID")}: <code>{job.resultData.providerTaskId}</code></p>{job.resultData.providerVideoId && <p>{text("视频 ID", "Video ID")}: <code>{job.resultData.providerVideoId}</code></p>}</details>}{job.errorCode && job.status === "failed" && <p>{zh ? errorCopy[job.errorCode] || job.errorCode : job.errorCode}</p>}</div>{!terminalStatus(job.status) && <button disabled={job.cancelRequested} onClick={() => project.cancel(job)}>{text("取消", "Cancel")}</button>}</article>)}<div ref={chatEnd} />
      </div><form className="vm-composer" onSubmit={send}>
        <VideoReferenceEditor onReplace={(files, id) => project.upload(files, offer, id)} media={video.media} offer={offer} motion={motion} zh={zh} disabled={disabled} onChange={media => patchVideo({ media })} onAdd={() => input.current?.click()} lockedIds={[...(video.composition?.scenes || []).map(scene => scene.assetId), video.composition?.audio?.assetId].filter(Boolean)} />
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} disabled={disabled} placeholder={motion ? text("描述视频创意，也可以继续说说想怎么修改…", "Describe your video or the changes you want…") : text("描述主体、动作、场景、镜头运动…", "Describe the subject, action, scene and camera…")} aria-label={text("视频创意", "Video prompt")} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
        {!motion && <FrameCandidates jobs={jobs} media={video.media} offer={frameOffer} disabled={disabled || !prompt.trim()} busy={active} onGenerate={generateFrame} onPick={pickFrame} zh={zh} />}<div className="vm-composer-tools"><button type="button" disabled={disabled} onClick={() => input.current?.click()} aria-label={text("上传素材", "Upload media")}><ImagePlus size={18} /></button>{!motion && <PromptOptimizer compact purpose="video" className="vm-tool-pill" prompt={prompt} disabled={disabled} available={caps?.planningAvailable} cost={caps?.planningCost ?? 1} zh={zh} onApply={setPrompt} />}{motion && <select value={video.ratio} disabled={disabled} aria-label="视频比例" onChange={event => patchVideo({ ratio: event.target.value, ...(video.composition ? { composition: { ...video.composition, ratio: event.target.value } } : {}) })}>{["16:9", "9:16", "1:1", "4:5"].map(ratio => <option key={ratio}>{ratio}</option>)}</select>}<button className="vm-send" type="submit" disabled={!hasPrompt || disabled || active || !offer?.available} aria-label={text("开始生成", "Generate")}>{working ? <LoaderCircle size={17} className="vm-spin" /> : <ArrowUp size={17} />}<span>{offer?.cost ?? "—"}</span></button></div>
        {!motion && <><VideoParameterFields caps={caps} video={video} offer={offer} onChange={patchVideo} disabled={disabled} zh={zh} /><VideoMediaHint offer={offer} zh={zh} /></>}
        <small role="status">{project.uploadProgress || (!caps ? text("正在加载视频能力…", "Loading video capabilities…") : !offer?.available ? videoMessage(offer?.reason, zh) : `${offer.cost} ${text("积分", "credits")} · ${video.duration} ${text("秒", "s")}${offer.creditPerSecond ? ` · ${offer.resolution ? `${offer.resolution} · ` : ""}${offer.creditPerSecond} ${text("积分 / 秒", "credits per second")}` : ""} · ${text("失败按任务结算规则退回", "refunded if the task fails")}`)}{caps && !offer?.available && <button type="button" onClick={retryCapabilities}>{text("刷新状态", "Refresh status")}</button>}</small>
      </form></aside>}
      <main className="vm-output" aria-label={text("视频作品", "Video artwork")}>
        <div className="vm-output-body">{treeOpen && <aside className="vm-files"><strong>{text("文件", "Files")}</strong>{video.composition && <button className={!resultId ? "is-selected" : ""} onClick={() => setResultId(null)}><Clapperboard size={14} />{draft.name}.motion</button>}{results.map((item, index) => <button key={item.id} onClick={() => { setResultId(item.assetId); setEditing(false); }}><FileVideo size={14} />{index + 1}. {item.name}</button>)}<button disabled={disabled} onClick={() => input.current?.click()}><Upload size={14} />{text("上传素材", "Upload media")}</button>{motion && <button disabled={disabled} onClick={() => jsonInput.current?.click()}>{text("导入本账号工程 JSON", "Import project JSON")}</button>}</aside>}
          <div className="vm-preview-column">{loading ? <BrandLoader variant="panel" label={text("正在打开项目", "Opening project")} /> : showMotion ? <StoryboardWorkspace video={video} caps={caps} storyboard={storyboard} result={result} disabled={disabled} onChange={patchComposition} onRefine={redoScene} onUploadMusic={() => input.current?.click()} view={view === "result" && !result ? "table" : view} onView={setView} time={time} onTime={setTime} selected={selected} onSelect={setSelected} zh={zh} /> : result ? <div className="vm-video-result">{!motion && <VersionStrip results={results} current={result.assetId} onSelect={setResultId} zh={zh} />}<VideoPlayer key={result.assetId} src={`/api/assets/${result.assetId}`} poster={result.posterAssetId ? previewUrl(result.posterAssetId, 1280) : undefined} downloadHref={`/api/assets/${result.assetId}?download=1`} zh={zh} /><VideoResultActions sceneOrigin={video.sceneOrigin} key={`actions-${result.assetId}`} result={result} zh={zh} allowReference={!motion && Boolean(offer?.mediaLimits?.video)} onReuse={!motion ? input => { patchVideo({ provider: input.provider || undefined, prompt: input.params.prompt || "", ratio: input.params.ratio || "16:9", duration: input.params.duration || 5, videoVariant: input.params.videoVariant, media: input.params.media || (input.assetId ? [{ id: input.assetId, type: "image", name: "首帧", duration: 0 }] : []), videoFields: input.params.videoFields || {} }); } : undefined} onReference={!motion ? media => { if (!video.media.some(item => item.id === media.id)) patchVideo({ media: [...video.media, { ...media, role: "reference_video" }] }); } : undefined} onMedia={media => change(current => ({ ...current, content: { ...current.content, layers: current.content.layers.map(layer => layer.assetId === media.id ? { ...layer, posterAssetId: media.posterAssetId, duration: media.duration, pixelWidth: media.width, pixelHeight: media.height } : layer) } }))} /></div> : <div className="vm-empty"><h2>{active ? text("正在制作，请稍候", "Your video is being created") : text("作品将在这里呈现", "Your video appears here")}</h2><p>{text("支持拖入素材 · 双击预览可全屏", "Drop media here · Double-click preview for fullscreen")}</p>{motion && <button disabled={disabled} onClick={() => { patchComposition(emptyComposition(requestKey())); setView("table"); }}>{text("从空白分镜开始", "Start with a blank storyboard")}</button>}</div>}</div>
        </div></main>
    </WorkspaceSplit>
    <input ref={input} hidden type="file" multiple={motion || Boolean(offer?.mediaLimits)} accept={motion || offer?.mediaLimits?.video || offer?.mediaLimits?.audio ? VIDEO_MEDIA_ACCEPT : "image/png,image/jpeg,image/webp"} onChange={event => { upload(event.target.files); event.target.value = ""; }} />
    <input ref={jsonInput} hidden type="file" accept=".json" onChange={event => { void importProject(event.target.files?.[0]); event.target.value = ""; }} />
    {projectsOpen && <ProjectManager userId={userId} locale={locale} kinds={["video", "motion"]} currentId={project.id} ready={!project.saving} onClose={() => setProjectsOpen(false)}
      creates={[{ href: "/video", label: text("单镜头", "Single shot") }, { href: "/video?mode=motion", label: text("分镜成片", "Storyboard") }]}
      onChoose={row => { setProjectsOpen(false); router.push(`/video?document=${row.id}`); }} />}
    {drop && <div className="vm-drop"><Upload size={32} />{text("松开即可上传素材", "Drop to upload media")}</div>}
  </section>;
}
function Page() {
  const query = useSearchParams(), { data: session, status } = useSession(), auth = useAuth(), zh = useLocale() === "zh";
  if (status === "loading") return <BrandLoader label={zh ? "正在打开视频工作台" : "Opening video workspace"} />;
  if (!session?.user?.id) return <GuestGate images={["film-morning-market.4ce00a57e01e", "midnight-train.6fb4b8359f5b", "little-astronaut.9e7403880999"]}
    title={zh ? "一句话，生成一段视频" : "One sentence, one video"} description={zh ? "描述镜头、动作和氛围，或上传一张图片让它动起来。" : "Describe the shot, motion and mood, or upload an image to animate it."}
    action={zh ? "登录后开始视频创作" : "Sign in to create videos"} onAction={() => auth.open()} />;
  const id = query.get("document"), mode = query.get("mode") === "motion" ? "motion" : "video";
  if (id && !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return <div className="vm-empty">项目链接无效</div>;
  return <Workspace key={`${session.user.id}:${id || mode}`} userId={session.user.id} documentId={id} initialMode={mode} zh={zh} />;
}
export default function VideoWorkspace() { return <Suspense fallback={<BrandLoader label="正在打开视频工作台" />}><Page /></Suspense>; }
