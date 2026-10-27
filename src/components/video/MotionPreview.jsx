"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize2, RotateCcw } from "lucide-react";
import { sceneAt, timelineDuration, videoTime } from "@/lib/video/timeline";

function Media({ asset, time, playing, volume, trimStart = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current; if (!element || asset?.type === "image") return;
    const sync = () => { const target = time + trimStart; if (Number.isFinite(element.duration) && Math.abs(element.currentTime - target) > (playing ? .2 : .001)) element.currentTime = Math.min(target, element.duration); element.volume = volume; if (playing) void element.play().catch(() => {}); else element.pause(); };
    sync(); element.addEventListener("loadedmetadata", sync); return () => element.removeEventListener("loadedmetadata", sync);
  }, [asset, time, playing, volume, trimStart]);
  if (!asset) return null;
  const src = `/api/assets/${asset.id}`;
  if (asset.type === "image") return <img src={src} alt="" draggable={false} />; // eslint-disable-line @next/next/no-img-element
  return asset.type === "audio" ? <audio ref={ref} src={src} preload="metadata" /> : <video ref={ref} src={src} preload="metadata" playsInline muted={volume === 0} />;
}

export default function MotionPreview({ composition, media, time, onTime, selected, onSelect, editing, zh }) {
  const [playing, setPlaying] = useState(false), [clock, setClock] = useState(time), [stageSize, setStageSize] = useState(null), root = useRef(null), stageWrap = useRef(null), current = useRef(time);
  const duration = timelineDuration(composition);
  useEffect(() => { current.current = Math.min(time, duration); const frame = requestAnimationFrame(() => { setClock(current.current); setPlaying(false); }); return () => cancelAnimationFrame(frame); }, [time, duration, editing]);
  useEffect(() => {
    const fit = new ResizeObserver(([entry]) => {
      const [w, h] = composition.ratio.split(":").map(Number), ratio = w / h;
      const width = Math.min(entry.contentRect.width, entry.contentRect.height * ratio);
      setStageSize({ width, height: width / ratio });
    });
    if (stageWrap.current) fit.observe(stageWrap.current);
    return () => fit.disconnect();
  }, [composition.ratio]);
  useEffect(() => { const pause = () => { if (document.hidden) setPlaying(false); }; document.addEventListener("visibilitychange", pause); return () => document.removeEventListener("visibilitychange", pause); }, []);
  useEffect(() => {
    if (!playing) return;
    let frame; let previous = performance.now(), displayed = previous;
    const tick = now => { current.current = Math.min(duration, current.current + Math.min(.1, (now - previous) / 1000)); previous = now; if (now - displayed >= 1000 / 24 || current.current >= duration) { setClock(current.current); displayed = now; } if (current.current >= duration) setPlaying(false); else frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  const active = sceneAt(composition, clock);
  if (!active) return null;
  const { scene, local } = active, progress = Math.min(1, local / .5);
  const asset = media.find(item => item.id === scene.assetId), soundtrack = media.find(item => item.id === composition.audio?.assetId);
  const style = { opacity: scene.animation === "none" ? 1 : progress, transform: scene.animation === "rise" ? `translateY(${24 / (composition.ratio === "16:9" ? 1280 : 720) * 100 * (1 - progress)}cqw)` : scene.animation === "zoom" ? `scale(${.94 + .06 * progress})` : undefined };
  const seek = value => { setPlaying(false); current.current = value; setClock(value); onTime(value); };
  const full = () => { if (!document.fullscreenElement) void root.current?.requestFullscreen?.().catch(() => {}); else void document.exitFullscreen?.(); };
  return <div className="vm-player" ref={root}>
    <div className="vm-stage-wrap" ref={stageWrap} onDoubleClick={full}>
      <div className="vm-stage" style={{ ...stageSize, aspectRatio: composition.ratio.replace(":", " / "), background: scene.background }} onClick={() => editing && onSelect(scene.id)}>
        <Media key={scene.id} asset={asset} time={local} trimStart={scene.trimStart} playing={playing} volume={scene.volume} />
        {asset && <div className="vm-shade" />}
        <div className={`vm-copy vm-copy-${scene.position} ${editing && selected === scene.id ? "is-selected" : ""}`} style={{ color: scene.color, textAlign: scene.align, ...style }}>
          <div style={{ fontSize: `${scene.fontSize / (composition.ratio === "16:9" ? 1280 : 720) * 100}cqw` }}>{scene.title}</div>
          {scene.subtitle && <p style={{ fontSize: `${scene.fontSize * .42 / (composition.ratio === "16:9" ? 1280 : 720) * 100}cqw` }}>{scene.subtitle}</p>}
        </div>
      </div>
    </div>
    {soundtrack && <Media asset={soundtrack} time={clock} trimStart={composition.audio.trimStart} playing={playing} volume={composition.audio.volume} />}
    <div className="vm-playback">
      <button type="button" aria-label={playing ? "暂停" : "播放"} onClick={() => { if (clock >= duration) { current.current = 0; setClock(0); } setPlaying(value => !value); }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
      <button type="button" aria-label="重新播放" onClick={() => seek(0)}><RotateCcw size={15} /></button>
      <span>{videoTime(clock)} / {videoTime(duration)}</span>
      <input type="range" min={0} max={duration} step={1 / 24} value={Math.min(clock, duration)} aria-label={zh ? "播放位置" : "Playback position"} onChange={event => seek(Number(event.target.value))} />
      <button type="button" aria-label={zh ? "全屏预览" : "Fullscreen"} onClick={full}><Maximize2 size={16} /></button>
    </div>
  </div>;
}
