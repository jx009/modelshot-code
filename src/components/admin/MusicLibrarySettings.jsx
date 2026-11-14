"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Music4, Upload, Trash2, ArrowUp, ArrowDown, LoaderCircle } from "lucide-react";
import { useAdminReason } from "@/hooks/useAdminReason";

const EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg"];
const errorCopy = {
  VIDEO_MEDIA_FORMAT_INVALID: "仅支持 MP3、WAV、M4A、AAC、FLAC、OGG 音频。",
  VIDEO_MEDIA_INVALID: "音频无法读取，请换一个文件。",
  MOTION_RENDER_UNAVAILABLE: "音视频工具服务未就绪，暂时无法读取音频时长。",
  PAYLOAD_TOO_LARGE: "单首音乐不能超过 32 MB。",
};
async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorCopy[data.code] || data.error || data.code || "操作失败，请重试。");
  return data;
}
const minutes = seconds => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

// 分镜成片的平台曲库：上传可商用背景音乐，用户在分镜表中选择。
export default function MusicLibrarySettings() {
  const reason = useAdminReason();
  const [tracks, setTracks] = useState(null), [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [name, setName] = useState(""), [mood, setMood] = useState("");
  const input = useRef(null);
  const apply = useCallback(data => { setTracks(data.tracks); setCanManage(data.canManage); }, []);
  const load = useCallback(async () => apply(await read(await fetch("/api/admin/music", { cache: "no-store" }))), [apply]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/music", { cache: "no-store", signal: controller.signal }).then(read).then(apply).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [apply]);

  async function upload(file) {
    if (!file) return;
    const extension = file.name.split(".").at(-1).toLowerCase();
    if (!EXTENSIONS.includes(extension)) { setError(errorCopy.VIDEO_MEDIA_FORMAT_INVALID); return; }
    const operation = await reason.ask();
    if (!operation) return;
    setBusy("upload"); setError("");
    try {
      const query = new URLSearchParams({ name: name.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 60), mood: mood.trim(), extension, reason: operation.reason });
      await read(await fetch(`/api/admin/music?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "Idempotency-Key": operation.key }, body: file }));
      setName(""); setMood(""); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }
  async function change(track, values, method = "PATCH") {
    const operation = await reason.ask();
    if (!operation) return;
    setBusy(track.id); setError("");
    try {
      await read(await fetch("/api/admin/music", { method, headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: JSON.stringify({ id: track.id, ...values, reason: operation.reason }) }));
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }
  const move = (index, offset) => {
    const other = tracks[index + offset];
    if (other) void change(tracks[index], { sortOrder: other.sortOrder + (offset < 0 ? -1 : 1) });
  };

  return <div className="max-w-4xl space-y-6">
    {reason.dialog}
    <div><h1 className="flex items-center gap-3 text-xl font-semibold"><Music4 size={23} />曲库管理</h1><p className="mt-2 text-sm text-secondary-text">上传可商用的背景音乐，用户在「分镜成片」中选用。请只上传已取得授权或免版权的音乐。</p></div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {canManage && <div className="rounded-2xl border border-divider bg-bg-card p-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end">
        <label className="block space-y-1 text-xs text-secondary-text"><span>曲目名称（留空使用文件名）</span><input value={name} maxLength={60} onChange={event => setName(event.target.value)} className="w-full rounded-[10px] border border-divider bg-bg-page px-3 py-2 text-sm text-primary-text" placeholder="例如：轻快清晨" /></label>
        <label className="block space-y-1 text-xs text-secondary-text"><span>风格标签（可选）</span><input value={mood} maxLength={20} onChange={event => setMood(event.target.value)} className="w-full rounded-[10px] border border-divider bg-bg-page px-3 py-2 text-sm text-primary-text" placeholder="欢快 / 温暖 / 科技" /></label>
        <button type="button" disabled={Boolean(busy)} onClick={() => input.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-btn-text disabled:opacity-50">{busy === "upload" ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />}上传音乐</button>
      </div>
      <p className="text-xs text-secondary-text">支持 MP3、WAV、M4A、AAC、FLAC、OGG，单首不超过 32 MB。上传后自动读取时长。</p>
      <input ref={input} hidden type="file" accept=".mp3,.wav,.m4a,.aac,.flac,.ogg,audio/*" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    </div>}
    {!tracks ? <p className="text-secondary-text" role="status">正在加载曲库…</p> : !tracks.length ? <p className="text-sm text-secondary-text">曲库还是空的，上传第一首背景音乐吧。</p> : <ul className="space-y-2" aria-label="曲目列表">{tracks.map((track, index) => <li key={track.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-divider bg-bg-card p-3 ${track.isActive ? "" : "opacity-60"}`}>
      <div className="min-w-[180px] flex-1"><p className="text-sm font-medium text-primary-text">{track.name}{track.mood && <span className="ml-2 rounded-full border border-divider px-2 py-0.5 text-xs text-secondary-text">{track.mood}</span>}</p><p className="mt-1 text-xs text-secondary-text">{minutes(track.duration)}{track.isActive ? "" : " · 已下架"}</p></div>
      <audio controls preload="none" src={track.previewUrl} className="h-8 max-w-[260px]" />
      {canManage && <div className="flex items-center gap-1">
        <button type="button" aria-label="上移" disabled={Boolean(busy) || index === 0} onClick={() => move(index, -1)} className="rounded-lg border border-divider p-1.5 disabled:opacity-40"><ArrowUp size={14} /></button>
        <button type="button" aria-label="下移" disabled={Boolean(busy) || index === tracks.length - 1} onClick={() => move(index, 1)} className="rounded-lg border border-divider p-1.5 disabled:opacity-40"><ArrowDown size={14} /></button>
        <button type="button" disabled={Boolean(busy)} onClick={() => change(track, { isActive: !track.isActive })} className="rounded-lg border border-divider px-3 py-1.5 text-xs">{track.isActive ? "下架" : "上架"}</button>
        <button type="button" aria-label="删除曲目" disabled={Boolean(busy)} onClick={() => change(track, {}, "DELETE")} className="rounded-lg border border-divider p-1.5 text-error"><Trash2 size={14} /></button>
      </div>}
    </li>)}</ul>}
  </div>;
}
