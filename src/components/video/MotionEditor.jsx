"use client";
import { useRef } from "react";
import { ArrowLeft, ArrowRight, Copy, Plus, Trash2 } from "lucide-react";
import { requestKey } from "@/lib/client-api";
import { emptyScene, moveScene, timelineDuration } from "@/lib/video/timeline";

export default function MotionEditor({ composition, media, selected, onSelect, onChange, onTime, zh, disabled }) {
  const drag = useRef(null), scene = composition.scenes.find(item => item.id === selected) || composition.scenes[0];
  const patch = values => onChange({ ...composition, scenes: composition.scenes.map(item => item.id === scene.id ? { ...item, ...values } : item) });
  const select = item => { onSelect(item.id); let time = 0; for (const row of composition.scenes) { if (row.id === item.id) break; time += row.duration; } onTime(time + Math.min(.7, item.duration / 2)); };
  const move = (from, to) => { const next = moveScene(composition, from, to); onChange(next); onTime(0); };
  const add = duplicate => { if (composition.scenes.length >= 40 || timelineDuration(composition) + (duplicate ? scene.duration : 3) > 180) return; const value = duplicate ? { ...scene, id: requestKey() } : emptyScene(requestKey()); onChange({ ...composition, scenes: [...composition.scenes, value] }); onSelect(value.id); onTime(timelineDuration(composition) + .7); };
  const asset = media.find(item => item.id === scene.assetId);
  return <div className="vm-editor">
    <div className="vm-timeline-heading"><strong>{zh ? "场景时间轴" : "Scene timeline"}</strong><span>{zh ? "拖动调整顺序 · 点击编辑" : "Drag to reorder · click to edit"}</span><button type="button" disabled={disabled} onClick={() => add(false)}><Plus size={14} />{zh ? "添加场景" : "Add scene"}</button></div>
    <div className="vm-timeline" aria-label="场景列表">{composition.scenes.map((item, index) => <div key={item.id} className={`vm-scene ${item.id === scene.id ? "is-selected" : ""}`} draggable={!disabled} onDragStart={() => { drag.current = index; }} onDragEnd={() => { drag.current = null; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current !== null) move(drag.current, index); drag.current = null; }}>
      <button type="button" disabled={disabled} onClick={() => select(item)} style={{ background: item.background, color: item.color }}><small>{index + 1}</small><span>{item.title || item.name}</span><small>{item.duration}s</small></button>
      <div><button aria-label="前移场景" disabled={disabled || index === 0} onClick={() => move(index, index - 1)}><ArrowLeft size={12} /></button><button aria-label="后移场景" disabled={disabled || index === composition.scenes.length - 1} onClick={() => move(index, index + 1)}><ArrowRight size={12} /></button></div>
    </div>)}</div>
    <fieldset className="vm-inspector" disabled={disabled}>
      <label>{zh ? "标题" : "Title"}<textarea maxLength={160} value={scene.title} onChange={event => patch({ title: event.target.value })} /></label>
      <label>{zh ? "副标题" : "Subtitle"}<textarea maxLength={320} value={scene.subtitle} onChange={event => patch({ subtitle: event.target.value })} /></label>
      <label>{zh ? "时长（秒）" : "Duration (s)"}<input type="number" min={1} max={30} step={.5} value={scene.duration} onChange={event => { const value = Number(event.target.value); if (value >= 1 && value <= 30 && timelineDuration(composition) - scene.duration + value <= 180) patch({ duration: value }); }} /></label>
      <label>{zh ? "字号" : "Font size"}<input type="number" min={24} max={120} value={scene.fontSize} onChange={event => patch({ fontSize: Math.min(120, Math.max(24, Number(event.target.value))) })} /></label>
      <label>{zh ? "背景" : "Background"}<input type="color" value={scene.background} onChange={event => patch({ background: event.target.value })} /></label>
      <label>{zh ? "文字颜色" : "Text color"}<input type="color" value={scene.color} onChange={event => patch({ color: event.target.value })} /></label>
      <label>{zh ? "入场动效" : "Animation"}<select value={scene.animation} onChange={event => patch({ animation: event.target.value })}>{[["none", "无"], ["fade", "淡入"], ["rise", "上移淡入"], ["zoom", "缩放淡入"]].map(([id, title]) => <option key={id} value={id}>{zh ? title : id}</option>)}</select></label>
      <label>{zh ? "对齐" : "Alignment"}<select value={scene.align} onChange={event => patch({ align: event.target.value })}>{[["left", "左对齐"], ["center", "居中"], ["right", "右对齐"]].map(([id, label]) => <option key={id} value={id}>{zh ? label : id}</option>)}</select></label>
      <label>{zh ? "位置" : "Position"}<select value={scene.position} onChange={event => patch({ position: event.target.value })}>{[["top", "上方"], ["center", "中央"], ["bottom", "下方"]].map(([id, label]) => <option key={id} value={id}>{zh ? label : id}</option>)}</select></label>
      <label>{zh ? "画面素材" : "Scene media"}<select value={scene.assetId || ""} onChange={event => { const next = media.find(item => item.id === event.target.value); patch({ assetId: event.target.value || null, trimStart: 0, ...(next?.type === "video" ? { duration: Math.min(scene.duration, Math.max(1, next.duration)) } : {}) }); }}><option value="">{zh ? "纯色 / 文字" : "Text / color"}</option>{media.filter(item => item.type !== "audio").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {asset?.type === "video" && <><label>{zh ? "视频入点（秒）" : "Trim start (s)"}<input type="number" min={0} max={Math.max(0, asset.duration - scene.duration)} step={.1} value={scene.trimStart} onChange={event => patch({ trimStart: Math.max(0, Math.min(asset.duration - scene.duration, Number(event.target.value))) })} /></label><label>{zh ? "原声音量" : "Clip volume"}<input type="range" min={0} max={1} step={.05} value={scene.volume} onChange={event => patch({ volume: Number(event.target.value) })} /></label></>}
      <label>{zh ? "背景音频" : "Soundtrack"}<select value={composition.audio?.assetId || ""} onChange={event => onChange({ ...composition, audio: event.target.value ? { assetId: event.target.value, volume: .5, trimStart: 0 } : null })}><option value="">{zh ? "无配乐" : "No soundtrack"}</option>{media.filter(item => item.type === "audio").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {composition.audio && <label>{zh ? "配乐音量" : "Music volume"}<input type="range" min={0} max={1} step={.05} value={composition.audio.volume} onChange={event => onChange({ ...composition, audio: { ...composition.audio, volume: Number(event.target.value) } })} /></label>}
      <div className="vm-scene-actions"><button type="button" onClick={() => add(true)}><Copy size={14} />{zh ? "复制场景" : "Duplicate"}</button><button type="button" disabled={composition.scenes.length < 2} onClick={() => { const scenes = composition.scenes.filter(item => item.id !== scene.id); onChange({ ...composition, scenes }); onSelect(scenes[0].id); onTime(0); }}><Trash2 size={14} />{zh ? "删除场景" : "Delete"}</button></div>
    </fieldset>
  </div>;
}
