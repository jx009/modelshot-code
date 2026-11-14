"use client";
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, RotateCcw, Square, Download, Table2, PlayCircle, Film } from "lucide-react";
import { api } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";
import { videoMessage } from "@/lib/video/messages";
import StoryboardTable from "./StoryboardTable";
import GenerationConfirm from "./GenerationConfirm";
import MotionPreview from "./MotionPreview";
import "./storyboard.css";

const RUN_COPY = { queued: ["排队中", "Queued"], running: ["正在生成", "Generating"], cancelling: ["正在停止", "Stopping"], awaiting_budget: ["积分预算不足，已暂停", "Paused: budget"], awaiting_input: ["已暂停", "Paused"], failed: ["部分镜头生成失败", "Some shots failed"], cancelled: ["已停止", "Stopped"], succeeded: ["已完成", "Done"] };

export default function StoryboardWorkspace({ video, caps, storyboard, result, disabled, onChange, onRefine, onUploadMusic, view, onView, time, onTime, selected, onSelect, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const composition = video.composition;
  const [tracks, setTracks] = useState([]);
  const [selection, setSelection] = useState(() => new Set(composition.scenes.slice(0, 12).map(scene => scene.id)));
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    api("/api/video/music", { signal: abort.signal }).then(data => setTracks(data.tracks || [])).catch(() => {});
    return () => abort.abort();
  }, []);
  // 镜头被删除后同步清理勾选。
  const sceneIds = useMemo(() => composition.scenes.map(scene => scene.id).filter(id => selection.has(id)), [composition.scenes, selection]);
  const { run, active, states } = storyboard;
  const done = run?.steps.filter(step => step.status === "succeeded").length || 0;
  const failed = run && ["failed", "awaiting_input", "awaiting_budget"].includes(run.status);
  const generated = composition.scenes.some(scene => scene.status === "ready");
  const tabs = [["table", text("分镜表", "Storyboard"), Table2], ["preview", text("预览", "Preview"), PlayCircle], ...(result ? [["result", text("成片", "Final video"), Film]] : [])];
  return <div className="sb-workspace">
    <div className="sb-tabs" role="tablist" aria-label={text("分镜视图", "Storyboard views")}>
      {tabs.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => onView(id)}><Icon size={15} />{label}</button>)}
      {run && run.status !== "succeeded" && <div className={`sb-run is-${run.status}`} role="status">
        {active ? <LoaderCircle size={14} className="vm-spin" /> : null}
        <span>{zh ? RUN_COPY[run.status]?.[0] : RUN_COPY[run.status]?.[1]}{active && ` · ${done}/${run.steps.length}`}{run.errorCode && !active ? ` · ${videoMessage(run.errorCode, zh)}` : ""}</span>
        {active && run.status !== "cancelling" && <button type="button" disabled={storyboard.busy} onClick={storyboard.cancel}><Square size={12} />{text("停止", "Stop")}</button>}
        {failed && <button type="button" disabled={storyboard.busy} onClick={storyboard.retry}><RotateCcw size={12} />{text("继续 / 重试失败的步骤", "Retry failed steps")}</button>}
      </div>}
    </div>
    {storyboard.error && <p className="sb-error" role="alert">{videoMessage(storyboard.error, zh)}<button type="button" onClick={() => storyboard.setError("")}>{text("知道了", "Dismiss")}</button></p>}
    {view === "result" && result ? <div className="sb-result">
      <video key={result.assetId} src={`/api/assets/${result.assetId}`} poster={result.posterAssetId ? previewUrl(result.posterAssetId, 1280) : undefined} controls playsInline preload="metadata" />
      <div className="sb-result-actions"><a className="sb-primary" href={`/api/assets/${result.assetId}?download=1`} download><Download size={16} />{text("下载 MP4", "Download MP4")}</a><button type="button" className="sb-ghost" onClick={() => onView("table")}><Table2 size={14} />{text("回到分镜继续修改", "Back to storyboard")}</button></div>
    </div> : view === "preview" ? <MotionPreview composition={composition} media={video.media} tracks={tracks} time={time} onTime={onTime} selected={selected} onSelect={onSelect} editing={false} generating={active} zh={zh} />
      : <StoryboardTable composition={composition} media={video.media} onChange={onChange} disabled={disabled || active} states={states} selection={selection} onSelection={setSelection}
        voiceModels={caps?.voiceModels || []} tracks={tracks} onUploadMusic={onUploadMusic} onRefine={onRefine} onGenerate={() => setConfirming(true)}
        generateLabel={generated ? text("重新生成选中镜头", "Regenerate selected") : text("生成视频", "Generate video")} zh={zh} />}
    <GenerationConfirm open={confirming} onClose={() => setConfirming(false)} sceneIds={sceneIds} quote={storyboard.quote} start={storyboard.start} busy={storyboard.busy}
      videoModels={caps?.videoModels || []} defaultProvider={caps?.videoProvider} zh={zh} />
  </div>;
}
