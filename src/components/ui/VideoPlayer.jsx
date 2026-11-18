"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, Maximize2, Minimize2, Pause, PictureInPicture2, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import "./video-player.css";

const SPEEDS = [1, 1.25, 1.5, 2, .5];
const subscribeNothing = () => () => {};
const pipSupported = () => Boolean(document.pictureInPictureEnabled);
const clock = value => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}` : "0:00";

// 站内统一的视频播放器：自定义控制条（播放、进度、音量、倍速、画中画、下载、全屏），
// 下载走站内资源地址而不是浏览器菜单。空格 / K 播放暂停，← → 快退快进 5 秒，M 静音，F 全屏。
export default function VideoPlayer({ src, poster, downloadHref, downloadName, autoPlay = false, zh = true, className = "" }) {
  const root = useRef(null), video = useRef(null), idle = useRef(0);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [speed, setSpeed] = useState(1), [full, setFull] = useState(false), [chrome, setChrome] = useState(true), [ended, setEnded] = useState(false);
  const text = (cn, en) => zh ? cn : en;
  const canPip = useSyncExternalStore(subscribeNothing, pipSupported, () => false);
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", change);
    return () => { document.removeEventListener("fullscreenchange", change); clearTimeout(idle.current); };
  }, []);
  const wake = () => { setChrome(true); clearTimeout(idle.current); idle.current = setTimeout(() => { if (!video.current?.paused) setChrome(false); }, 2200); };
  const toggle = () => { const element = video.current; if (!element) return; if (element.paused || element.ended) void element.play().catch(() => {}); else element.pause(); wake(); };
  const seek = value => { const element = video.current; if (element && Number.isFinite(element.duration)) { element.currentTime = Math.max(0, Math.min(element.duration, value)); setTime(element.currentTime); } };
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen?.(); else void root.current?.requestFullscreen?.().catch(() => {}); };
  const pip = () => { const element = video.current; if (!element) return; if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void element.requestPictureInPicture?.().catch(() => {}); };
  const nextSpeed = () => { const value = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(value); if (video.current) video.current.playbackRate = value; };
  const setLevel = value => { const element = video.current; if (!element) return; element.volume = value; element.muted = value === 0; setVolume(value); setMuted(value === 0); };
  function keys(event) {
    if (event.target.closest("input")) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k") { event.preventDefault(); toggle(); }
    else if (key === "arrowright") { event.preventDefault(); seek(time + 5); wake(); }
    else if (key === "arrowleft") { event.preventDefault(); seek(time - 5); wake(); }
    else if (key === "m") { const element = video.current; if (element) { element.muted = !element.muted; setMuted(element.muted); } }
    else if (key === "f") fullscreen();
  }
  const progress = duration ? time / duration * 100 : 0, loaded = duration ? buffered / duration * 100 : 0;
  return <div ref={root} className={`vp-player${chrome || !playing ? " is-chrome" : ""}${full ? " is-full" : ""} ${className}`.trim()} tabIndex={0} role="group" aria-label={text("视频播放器", "Video player")}
    onMouseMove={wake} onMouseLeave={() => { if (playing) setChrome(false); }} onKeyDown={keys}>
    {/* 用媒体片段请求第 1 帧：没有封面图时浏览器也能解出一帧，而不是在暂停状态下留一个黑框。 */}
    <video ref={video} src={src.includes("#") ? src : `${src}#t=0.1`} poster={poster} autoPlay={autoPlay} playsInline preload="metadata" onClick={toggle} onDoubleClick={fullscreen}
      onPlay={() => { setPlaying(true); setEnded(false); wake(); }} onPause={() => { setPlaying(false); setChrome(true); }} onEnded={() => { setEnded(true); setPlaying(false); setChrome(true); }}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(event.currentTarget.duration)} onDurationChange={event => setDuration(event.currentTarget.duration)}
      onProgress={event => { const ranges = event.currentTarget.buffered; if (ranges.length) setBuffered(ranges.end(ranges.length - 1)); }}
      onVolumeChange={event => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); }} />
    {!playing && <button type="button" className="vp-center" aria-label={ended ? text("重新播放", "Replay") : text("播放", "Play")} onClick={toggle}>{ended ? <RotateCcw size={26} /> : <Play size={28} fill="currentColor" />}</button>}
    <div className="vp-bar">
      <div className="vp-track" style={{ "--vp-progress": `${progress}%`, "--vp-loaded": `${loaded}%` }}>
        <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(time, duration || 0)} aria-label={text("播放进度", "Seek")} onChange={event => seek(Number(event.target.value))} />
      </div>
      <div className="vp-controls">
        <button type="button" aria-label={playing ? text("暂停", "Pause") : text("播放", "Play")} onClick={toggle}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <div className="vp-volume">
          <button type="button" aria-label={muted ? text("取消静音", "Unmute") : text("静音", "Mute")} onClick={() => { const element = video.current; if (element) { element.muted = !element.muted; if (!element.muted && element.volume === 0) element.volume = .8; } }}>{muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label={text("音量", "Volume")} style={{ "--vp-level": `${(muted ? 0 : volume) * 100}%` }} onChange={event => setLevel(Number(event.target.value))} />
        </div>
        <span className="vp-time">{clock(time)} <i>/</i> {clock(duration)}</span>
        <span className="vp-spacer" />
        <button type="button" className="vp-speed" aria-label={text(`播放速度 ${speed} 倍`, `Speed ${speed}×`)} onClick={nextSpeed}>{speed}×</button>
        {canPip && <button type="button" aria-label={text("画中画", "Picture in picture")} onClick={pip}><PictureInPicture2 size={16} /></button>}
        {downloadHref && <a href={downloadHref} download={downloadName || true} aria-label={text("下载视频", "Download video")} title={text("下载视频", "Download video")}><Download size={16} /></a>}
        <button type="button" aria-label={full ? text("退出全屏", "Exit fullscreen") : text("全屏", "Fullscreen")} onClick={fullscreen}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </div>
  </div>;
}
