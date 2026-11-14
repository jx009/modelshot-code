"use client";
import { ArrowDown, ArrowUp, Copy, Film, ImageIcon, Plus, Trash2, Type, Upload, Wand2, Clapperboard, LoaderCircle, Check, AlertTriangle, Music4, Mic, Captions } from "lucide-react";
import { requestKey } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";
import { emptyScene, moveScene, timelineDuration } from "@/lib/video/timeline";

export const SOURCE_OPTIONS = [
  ["ai-image-video", "AI 首帧 + 视频", "AI frame + video"],
  ["ai-video", "AI 文生视频", "AI text-to-video"],
  ["ai-image", "AI 图片 + 推拉", "AI image + camera move"],
  ["media", "我的素材", "My media"],
  ["text", "纯文字卡片", "Text card"],
];
const SOURCE_ICON = { "ai-image-video": Clapperboard, "ai-video": Film, "ai-image": ImageIcon, media: Upload, text: Type };
const STATE_COPY = { waiting: ["排队中", "Queued"], frame: ["生成首帧", "Frame"], clip: ["生成视频", "Video"], voice: ["生成配音", "Voice"], partial: ["生成中", "Working"], done: ["已完成", "Done"], failed: ["失败", "Failed"] };
const RATIOS = ["16:9", "9:16", "1:1", "4:5"];
const MAX_SELECTED = 12;

const WORKING = new Set(["frame", "clip", "voice", "partial"]);

function Thumb({ scene, media, state, zh }) {
  const asset = media.find(item => item.id === scene.assetId), frame = scene.frameAssetId || (asset?.type === "image" ? asset.id : null);
  const Icon = SOURCE_ICON[scene.source] || Clapperboard;
  // 生成中：缩略图上一道光扫过，并显示当前步骤，避免看起来像卡住。
  if (state && WORKING.has(state.state)) return <span className="sb-thumb is-working">{frame && <img src={previewUrl(frame, 320)} alt="" />}<span className="sb-thumb-scan" /><span className="sb-thumb-step"><LoaderCircle size={14} className="vm-spin" />{zh ? STATE_COPY[state.state][0] : STATE_COPY[state.state][1]}</span></span>; // eslint-disable-line @next/next/no-img-element
  if (frame) return <span className="sb-thumb"><img src={previewUrl(frame, 320)} alt="" />{asset?.type === "video" && <Film size={13} className="sb-thumb-badge" />}</span>; // eslint-disable-line @next/next/no-img-element
  if (asset?.type === "video") return <span className="sb-thumb is-video"><Film size={18} /><small>{zh ? "视频片段" : "Clip"}</small></span>;
  return <span className="sb-thumb is-empty" style={scene.source === "text" ? { background: scene.background } : undefined}><Icon size={18} /><small>{scene.source === "text" ? (zh ? "文字卡片" : "Text") : (zh ? "待生成" : "Pending")}</small></span>;
}

function StateChip({ state, zh }) {
  if (!state) return null;
  const [cn, en] = STATE_COPY[state.state] || STATE_COPY.waiting;
  if (state.state === "waiting") return <span className="sb-state is-waiting">{zh ? cn : en}<span className="sb-wait-dots" aria-hidden="true"><i /><i /><i /></span></span>;
  const Icon = state.state === "done" ? Check : state.state === "failed" ? AlertTriangle : LoaderCircle;
  return <span className={`sb-state is-${state.state}`}><Icon size={12} className={["done", "failed"].includes(state.state) ? "" : "vm-spin"} />{zh ? cn : en}</span>;
}

export default function StoryboardTable({ composition, media, onChange, disabled, states, selection, onSelection, voiceModels = [], tracks = [], onUploadMusic, onRefine, onGenerate, generateLabel, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const scenes = composition.scenes, total = timelineDuration(composition);
  const userMedia = media.filter(item => !/_studio_(?:\d+|video|voice)$/.test(item.id));
  const patch = (id, values) => onChange({ ...composition, scenes: scenes.map(scene => scene.id === id ? { ...scene, ...values, status: "draft" } : scene) });
  const add = (after, copy) => {
    if (scenes.length >= 40 || total + (copy?.duration || 5) > 180) return;
    const scene = copy ? { ...copy, id: requestKey(), assetId: copy.source === "media" ? copy.assetId : null, frameAssetId: null, narrationAssetId: null, status: "draft" } : emptyScene(requestKey());
    const next = [...scenes]; next.splice(after + 1, 0, scene);
    onChange({ ...composition, scenes: next });
  };
  const remove = id => { if (scenes.length > 1) { onChange({ ...composition, scenes: scenes.filter(scene => scene.id !== id) }); onSelection(new Set([...selection].filter(item => item !== id))); } };
  const toggle = id => { const next = new Set(selection); if (next.has(id)) next.delete(id); else if (next.size < MAX_SELECTED) next.add(id); onSelection(next); };
  const voiceValue = composition.voice ? `${composition.voice.provider}::${composition.voice.voice}` : "";
  const library = composition.audio?.libraryTrackId ? `library:${composition.audio.libraryTrackId}` : composition.audio ? `media:${composition.audio.assetId}` : "";
  const setMusic = value => {
    if (!value) return onChange({ ...composition, audio: null });
    const [kind, id] = value.split(":");
    if (kind === "library") { const track = tracks.find(item => item.id === id); if (track) onChange({ ...composition, audio: { assetId: track.assetId, libraryTrackId: track.id, volume: composition.audio?.volume ?? .6, trimStart: 0 } }); }
    else onChange({ ...composition, audio: { assetId: id, volume: composition.audio?.volume ?? .6, trimStart: 0 } });
  };
  const generatable = scenes.filter(scene => selection.has(scene.id));
  return <section className="sb-board" aria-label={text("分镜表", "Storyboard")}>
    <div className="sb-toolbar">
      <label className="sb-field"><span>{text("画幅", "Ratio")}</span><select value={composition.ratio} disabled={disabled} onChange={event => onChange({ ...composition, ratio: event.target.value })}>{RATIOS.map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>
      <label className="sb-toggle"><input type="checkbox" checked={composition.subtitles !== false} disabled={disabled} onChange={event => onChange({ ...composition, subtitles: event.target.checked })} /><Captions size={14} />{text("旁白字幕", "Captions")}</label>
      {voiceModels.length > 0 && <label className="sb-field"><Mic size={14} /><span className="sr-only">{text("旁白配音", "Voiceover")}</span><select aria-label={text("旁白配音", "Voiceover")} value={voiceValue} disabled={disabled} onChange={event => { const [provider, voice] = event.target.value.split("::"); onChange({ ...composition, voice: event.target.value ? { provider, voice } : null }); }}>
        <option value="">{text("不配音（仅字幕）", "No voiceover")}</option>
        {voiceModels.flatMap(model => model.voices.map(voice => <option key={`${model.id}::${voice.id}`} value={`${model.id}::${voice.id}`}>{model.voices.length > 1 || voiceModels.length > 1 ? `${voice.label} · ${model.label}` : voice.label}</option>))}
      </select></label>}
      <label className="sb-field"><Music4 size={14} /><span className="sr-only">{text("背景音乐", "Music")}</span><select aria-label={text("背景音乐", "Music")} value={library} disabled={disabled} onChange={event => setMusic(event.target.value)}>
        <option value="">{text("无背景音乐", "No music")}</option>
        {tracks.length > 0 && <optgroup label={text("曲库", "Library")}>{tracks.map(track => <option key={track.id} value={`library:${track.id}`}>{track.name}{track.mood ? ` · ${track.mood}` : ""}</option>)}</optgroup>}
        {userMedia.some(item => item.type === "audio") && <optgroup label={text("我的音频", "My audio")}>{userMedia.filter(item => item.type === "audio").map(item => <option key={item.id} value={`media:${item.id}`}>{item.name}</option>)}</optgroup>}
      </select></label>
      {onUploadMusic && <button type="button" className="sb-ghost" disabled={disabled} onClick={onUploadMusic}><Upload size={14} />{text("上传音乐", "Upload music")}</button>}
      <span className="sb-summary">{scenes.length} {text("个镜头", "shots")} · {Math.round(total)}s</span>
    </div>

    <ol className="sb-rows">{scenes.map((scene, index) => {
      const state = states[scene.id], chars = scene.narration.length, long = chars > scene.duration * 4.5;
      const lockedVisual = scene.source === "text";
      return <li key={scene.id} className={`sb-row${selection.has(scene.id) ? " is-selected" : ""}${state?.state === "failed" || scene.status === "failed" ? " is-failed" : ""}${state && WORKING.has(state.state) ? " is-working" : ""}${state?.state === "waiting" ? " is-queued" : ""}`}>
        <div className="sb-lead">
          <label className="sb-pick"><input type="checkbox" checked={selection.has(scene.id)} disabled={disabled || !selection.has(scene.id) && selection.size >= MAX_SELECTED} onChange={() => toggle(scene.id)} aria-label={text(`选择第 ${index + 1} 镜`, `Select shot ${index + 1}`)} /><b>{String(index + 1).padStart(2, "0")}</b></label>
          <Thumb scene={scene} media={media} state={state} zh={zh} />
          {state ? <StateChip state={state} zh={zh} /> : scene.status === "ready" && <span className="sb-state is-done"><Check size={12} />{text("已生成", "Ready")}</span>}
        </div>
        <div className="sb-main">
          {!lockedVisual && <label className="sb-cell sb-visual"><span>{text("画面描述", "Visual")}</span><textarea rows={2} maxLength={1000} value={scene.visual} disabled={disabled} placeholder={text("主体、动作、场景、光线、风格…", "Subject, action, setting, light, style…")} onChange={event => patch(scene.id, { visual: event.target.value })} /></label>}
          <div className="sb-cell-row">
            {!lockedVisual && <label className="sb-cell"><span>{text("运镜", "Camera")}</span><input maxLength={80} value={scene.camera} disabled={disabled} placeholder={text("缓慢推近 / 横移 / 固定", "Push in / pan / static")} onChange={event => patch(scene.id, { camera: event.target.value })} /></label>}
            <label className="sb-cell"><span>{text("屏上文字", "On-screen text")}</span><input maxLength={160} value={scene.title} disabled={disabled} placeholder={text("可留空", "Optional")} onChange={event => patch(scene.id, { title: event.target.value })} /></label>
          </div>
          <label className="sb-cell"><span>{text("旁白", "Narration")}<em className={long ? "is-warn" : ""}>{chars ? `${chars} ${text("字", "chars")}${long ? text(" · 偏长，建议精简或加长镜头", " · long for this shot") : ""}` : ""}</em></span><textarea rows={2} maxLength={400} value={scene.narration} disabled={disabled} placeholder={text("画外解说，可留空", "Voice-over line, optional")} onChange={event => patch(scene.id, { narration: event.target.value })} /></label>
        </div>
        <div className="sb-side">
          <label className="sb-field"><span>{text("来源", "Source")}</span><select value={scene.source} disabled={disabled} onChange={event => patch(scene.id, { source: event.target.value, ...(event.target.value !== "media" && media.find(item => item.id === scene.assetId && !/_studio_/.test(item.id)) ? { assetId: null } : {}) })}>{SOURCE_OPTIONS.map(([id, cn, en]) => <option key={id} value={id}>{zh ? cn : en}</option>)}</select></label>
          {scene.source === "media" && <label className="sb-field"><span>{text("素材", "Media")}</span><select value={scene.assetId || ""} disabled={disabled} onChange={event => patch(scene.id, { assetId: event.target.value || null, trimStart: 0 })}><option value="">{text("选择素材", "Choose")}</option>{userMedia.filter(item => item.type !== "audio").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <label className="sb-field"><span>{text("时长", "Length")}</span><input type="number" min={1} max={30} step={.5} value={scene.duration} disabled={disabled} onChange={event => { const value = Math.min(30, Math.max(1, Number(event.target.value) || 1)); if (total - scene.duration + value <= 180) patch(scene.id, { duration: value }); }} /><i>s</i></label>
          <label className="sb-field"><span>{text("转场", "Transition")}</span><select value={scene.transition} disabled={disabled || index === scenes.length - 1} onChange={event => patch(scene.id, { transition: event.target.value })}><option value="cut">{text("硬切", "Cut")}</option><option value="fade">{text("淡入淡出", "Fade")}</option></select></label>
          <div className="sb-actions">
            <button type="button" aria-label={text("上移", "Move up")} disabled={disabled || index === 0} onClick={() => onChange(moveScene(composition, index, index - 1))}><ArrowUp size={14} /></button>
            <button type="button" aria-label={text("下移", "Move down")} disabled={disabled || index === scenes.length - 1} onClick={() => onChange(moveScene(composition, index, index + 1))}><ArrowDown size={14} /></button>
            <button type="button" aria-label={text("复制镜头", "Duplicate shot")} disabled={disabled} onClick={() => add(index, scene)}><Copy size={14} /></button>
            {onRefine && media.find(item => item.id === scene.assetId)?.type === "video" && <button type="button" aria-label={text("在单镜头工作台精修", "Refine in single-shot workspace")} title={text("在单镜头工作台精修", "Refine in single-shot workspace")} disabled={disabled} onClick={() => onRefine(scene)}><Wand2 size={14} /></button>}
            <button type="button" aria-label={text("删除镜头", "Delete shot")} disabled={disabled || scenes.length === 1} onClick={() => remove(scene.id)}><Trash2 size={14} /></button>
          </div>
        </div>
      </li>;
    })}</ol>
    <div className="sb-footer">
      <button type="button" className="sb-ghost" disabled={disabled || scenes.length >= 40} onClick={() => add(scenes.length - 1)}><Plus size={14} />{text("加一个镜头", "Add shot")}</button>
      <span className="sb-selected">{text(`已选 ${generatable.length} / ${MAX_SELECTED} 个镜头`, `${generatable.length} / ${MAX_SELECTED} shots selected`)}</span>
      <button type="button" className="sb-primary" disabled={disabled || !generatable.length} onClick={onGenerate}><Clapperboard size={16} />{generateLabel}</button>
    </div>
  </section>;
}
