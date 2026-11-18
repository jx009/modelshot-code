"use client";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { previewUrl } from "@/lib/studio/image-url";

const frameAssets = jobs => jobs.filter(job => job.tool === "generate" && job.status === "succeeded").flatMap(job => job.resultData?.assets || []).slice(0, 8);

// 先生成首帧：用当前描述生成候选图，选中后作为视频的首帧参考；比直接生成视频更可控、更省积分。
// 按钮放在输入框的操作栏里，候选图单独排在素材下方（见 FrameCandidateList）。
export function FrameGenerateButton({ jobs, offer, disabled, busy, onGenerate, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const pending = jobs.some(job => job.tool === "generate" && !["succeeded", "failed", "cancelled"].includes(job.status));
  if (!offer) return null;
  const label = text("AI 生成首帧", "Generate a first frame"), credits = text(`${offer.cost} 积分`, `${offer.cost} credits`);
  return <button type="button" className="vm-frames-generate" disabled={disabled || busy || pending || !offer.available} onClick={onGenerate} aria-label={`${label} · ${credits}`} title={offer.available ? text(`用当前描述先生成一张首帧图（${credits}），比直接生成视频更可控`, `Generate a first frame from this description (${credits}) for more control`) : text("生图模型暂不可用", "Image model unavailable")}>
    {pending ? <LoaderCircle size={14} className="vm-spin" /> : <Sparkles size={14} />}<b>{frameAssets(jobs).length ? text("再来一张", "Another") : text("AI 生成", "Generate")}</b><span>{offer.cost}</span>
  </button>;
}

export function FrameCandidateList({ jobs, media, disabled, onPick, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const frames = frameAssets(jobs);
  if (!frames.length) return null;
  const chosen = new Set(media.map(item => item.id));
  return <div className="vm-frames">
    <small>{text("候选首帧", "Frame options")}</small>
    <div className="vm-frames-list" role="list" aria-label={text("首帧候选", "Frame candidates")}>{frames.map(asset => <button type="button" role="listitem" key={asset.id} className={chosen.has(asset.id) ? "is-chosen" : ""} disabled={disabled || chosen.has(asset.id)} onClick={() => onPick(asset)} aria-label={chosen.has(asset.id) ? text("已用作首帧", "Used as first frame") : text("用作首帧", "Use as first frame")}>
      <img src={previewUrl(asset.id, 320)} alt="" />{chosen.has(asset.id) && <Check size={14} />} {/* eslint-disable-line @next/next/no-img-element */}
    </button>)}</div>
  </div>;
}

const ESTIMATES = { video: ["通常 1–3 分钟", "Usually 1–3 min"], "motion-plan": ["约 20–60 秒", "About 20–60 s"], "motion-render": ["通常 1–2 分钟", "Usually 1–2 min"], generate: ["约 10–30 秒", "About 10–30 s"] };
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// 进行中的任务显示已用时间与常见耗时，让等待有预期。
export function JobElapsed({ job, zh }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const started = new Date(job.startedAt || job.createdAt).getTime();
  if (!Number.isFinite(started)) return null;
  const estimate = ESTIMATES[job.tool];
  return <small className="vm-elapsed">{zh ? "已用" : "Elapsed"} {clock(Math.max(0, (now - started) / 1000))}{estimate ? ` · ${zh ? estimate[0] : estimate[1]}` : ""}</small>;
}

// 版本条：同一工程的每次生成结果，点击切换播放。
export function VersionStrip({ results, current, onSelect, zh }) {
  if (results.length < 2) return null;
  return <div className="vm-versions" role="list" aria-label={zh ? "生成版本" : "Versions"}>{results.map((item, index) => <button type="button" role="listitem" key={item.id} className={item.assetId === current ? "is-current" : ""} onClick={() => onSelect(item.assetId)} aria-label={`${zh ? "版本" : "Version"} ${index + 1}`}>
    {item.posterAssetId ? <img src={previewUrl(item.posterAssetId, 320)} alt="" /> : <span>{index + 1}</span>} {/* eslint-disable-line @next/next/no-img-element */}
    <small>v{index + 1}</small>
  </button>)}</div>;
}
