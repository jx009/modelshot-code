"use client";

import GenerationModelSelect from "@/components/creation/GenerationModelSelect";
import { videoModelChange } from "@/lib/video/model-choice";
import VideoModelFields from "./VideoModelFields";
import "./video-controls.css";

export default function VideoParameterFields({ caps, video, offer, onChange, disabled, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const ratios = offer?.ratios || [], durations = offer?.durations || [];
  return <div className="vg-parameters">
    <GenerationModelSelect video zh={zh} models={caps?.videoModels} value={video.provider || caps?.videoProvider} disabled={disabled} onChange={provider => onChange(videoModelChange(caps, provider, video))} />
    {offer?.variants?.length > 0 && <label>{text("清晰度与声音", "Quality and sound")}<select value={video.videoVariant || ""} disabled={disabled} onChange={event => onChange({ videoVariant: event.target.value || undefined })}><option value="" disabled>{text("选择已支持的组合", "Choose a supported combination")}</option>{video.videoVariant && !offer.variants.some(row => row.id === video.videoVariant) && <option value={video.videoVariant} disabled>{text("上一模型的组合不适用", "Previous combination unavailable")}</option>}{offer.variants.map(row => <option key={row.id} value={row.id}>{row.label}{row.resolution ? ` · ${row.resolution}` : ""}{row.audio !== undefined ? row.audio ? text(" · 有声", " · Audio") : text(" · 无声", " · Silent") : ""} · {row.creditCost} {text("积分", "credits")}</option>)}</select></label>}
    {video.videoVariant && !offer?.variants?.length && <p role="status">{text("当前模型不支持上一清晰度与声音组合。", "This model does not support the previous quality settings.")}<button type="button" disabled={disabled} onClick={() => onChange({ videoVariant: undefined })}>{text("使用当前模型默认规格", "Use current model defaults")}</button></p>}
    <div className="vg-parameter-row">
      <label>{text("画幅", "Aspect ratio")}<select value={video.ratio} disabled={disabled || !ratios.length} onChange={event => onChange({ ratio: event.target.value })}>
        {!ratios.includes(video.ratio) && <option value={video.ratio} disabled>{video.ratio} · {text("不可用", "Unavailable")}</option>}
        {ratios.map(ratio => <option key={ratio}>{ratio}</option>)}
      </select></label>
      <label>{text("时长", "Duration")}<select value={video.duration} disabled={disabled || !durations.length} onChange={event => onChange({ duration: Number(event.target.value) })}>
        {!durations.includes(video.duration) && <option value={video.duration} disabled>{video.duration}s · {text("不可用", "Unavailable")}</option>}
        {durations.map(duration => <option value={duration} key={duration}>{duration}s</option>)}
      </select></label>
    </div>
    <VideoModelFields offer={offer} value={video.videoFields} onChange={videoFields => onChange({ videoFields })} disabled={disabled} zh={zh} />
    {Object.keys(video.videoFields || {}).some(key => !(offer?.fields || []).some(field => field.key === key)) && <div role="status"><small>{text("已保留上一模型的附加参数，当前模型不支持。", "Previous extra settings are preserved but unsupported by this model.")}</small><button type="button" disabled={disabled} onClick={() => onChange({ videoFields: {} })}>{text("清除不适用的附加参数", "Clear incompatible extra settings")}</button></div>}
  </div>;
}
