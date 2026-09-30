"use client";

import Image from "next/image";
import { X, RotateCcw, Paintbrush, LoaderCircle, ImageIcon } from "lucide-react";
import CropControls from "./CropControls";
import { previewUrl } from "@/lib/studio/image-url";
import "./tool-panel.css";

/** Shared, stable editing surface. Tool state stays owned by the workbench. */
export default function ToolPanel({ tool, Icon, status, selected, params, onParams, prompt, onPrompt, brush, onBrush, hasMask, selection, busy, moveUnchanged, cost, zh, onClose, onReset, onRun }) {
  const t = (cn, en) => zh ? cn : en;
  const paint = ["inpaint", "erase"].includes(tool.id);
  const move = tool.id === "move";
  const crop = tool.id === "crop";
  const promptTool = paint || move || ["expand", "video", "describe"].includes(tool.id);
  const unavailable = !status?.available && !crop;
  const disabled = busy || unavailable || (crop && !params.rect) || (paint && !hasMask) || (move && (!selection || moveUnchanged)) || (["inpaint", "video"].includes(tool.id) && !prompt.trim());
  const hint = move ? selection ? t("提示：可移动、缩放或旋转源区域与目标区域", "Move, resize or rotate the source and destination regions") : t("提示：请在目标对象上拖拽框选需要移动的区域", "Draw a rectangle around the complete object to move")
    : paint ? t("提示：用画笔大致圈出需要修改的区域", "Use the brush to outline the area you want to edit")
      : crop ? t("拖动边界调整裁剪区域，原图会保留", "Drag the handles to crop. Your original stays on the canvas")
        : tool.id === "expand" ? t("拖动图片外侧边界，或选择比例扩展画面", "Drag the outer handles or choose an aspect ratio") : "";
  const action = move ? t("确认移动", "Apply move") : tool.id === "inpaint" ? t("生成修改", "Apply edit") : crop ? t("裁剪", "Apply") : tool.id === "erase" ? t("消除", "Apply") : t("生成", "Apply");
  return <section className={`ms-editor ms-editor-${tool.id}`} aria-label={zh ? tool.zh : tool.en}>
    {hint && <p className="ms-editor-hint">{hint}</p>}
    <div className="ms-editor-card">
      <header><Icon size={16} /><h2>{zh ? tool.zh : tool.en}</h2>
        {(move || paint || crop || tool.id === "expand") && <button className="ms-editor-icon" type="button" disabled={busy || (move && !selection) || (paint && !hasMask)} onClick={onReset} title={move ? t("重新框选", "Select again") : paint ? t("清除", "Clear") : t("重置", "Reset")}><RotateCcw size={16} /></button>}
        <button className="ms-editor-icon" type="button" disabled={busy} onClick={onClose} title={t("关闭工具", "Close tool")}><X size={18} /></button>
      </header>
      <div className="ms-editor-content">
        {paint && <div className="ms-editor-reference"><Image unoptimized src={previewUrl(selected.assetId, 320)} width={56} height={56} alt={selected.name} /><span>{t("原图", "Source")}<small>{selected.pixelWidth} × {selected.pixelHeight}</small></span></div>}
        {promptTool && <textarea className="ms-editor-prompt" aria-label={move ? t("移动补充说明", "Move instruction") : tool.id === "inpaint" ? t("局部修改描述", "Local edit instruction") : t("工具提示词", "Tool prompt")} placeholder={move ? t("您可补充移动后的效果要求，或留空", "Describe the result after moving, or leave blank") : tool.id === "inpaint" ? t("请在此描述您的修改灵感", "Describe how the selected area should change") : tool.id === "video" ? t("描述画面运动、镜头和节奏…", "Describe motion, camera and pacing…") : t("可补充效果要求，或留空", "Additional instructions (optional)")} value={prompt} onChange={event => onPrompt(event.target.value)} maxLength={4000} disabled={busy} />}
        {paint && <div className="ms-editor-brush"><Paintbrush size={15} /><label htmlFor="studio-brush">{t("画笔", "Brush")}</label><input id="studio-brush" aria-label={t("画笔大小", "Brush size")} type="range" min="5" max="200" value={brush} onChange={event => onBrush(Number(event.target.value))} /><output>{brush}px</output><button className="ms-editor-icon" title={t("清除选区", "Clear selection")} disabled={!hasMask || busy} onClick={onReset}><RotateCcw size={16} /></button></div>}
        {move && selection && <div className="ms-move-offset ms-editor-offset" data-source={JSON.stringify(params.moveSource)} data-target={JSON.stringify(params.moveTarget)}><span>ΔX {params.moveTarget.left - params.moveSource.left}px</span><span>ΔY {params.moveTarget.top - params.moveSource.top}px</span><span>{t("旋转", "Rotation")} {params.moveTarget.rotation || 0}°</span></div>}
        {crop && <CropControls value={params} onChange={onParams} width={selected.pixelWidth} height={selected.pixelHeight} zh={zh} />}
        {tool.id === "expand" && <><div className="ms-editor-ratios" role="group" aria-label={t("扩图比例", "Expansion ratio")}>{[["1:1",1],["4:3",4/3],["3:4",3/4],["16:9",16/9],["9:16",9/16]].map(([label, ratio]) => <button key={label} type="button" onClick={() => {
          const width = selected.pixelWidth, height = selected.pixelHeight;
          const expandedWidth = Math.max(width, Math.ceil(height * ratio)), expandedHeight = Math.max(height, Math.ceil(width / ratio));
          const x = Math.min(2048, Math.max(32, expandedWidth - width)), y = Math.min(2048, Math.max(32, expandedHeight - height));
          onParams({ padding: { left: Math.floor(x / 2), right: Math.ceil(x / 2), top: Math.floor(y / 2), bottom: Math.ceil(y / 2) } });
        }}><ImageIcon size={16} />{label}</button>)}</div><div className="ms-edge-readout">{Object.entries(typeof params.padding === "number" ? { left: params.padding, right: params.padding, top: params.padding, bottom: params.padding } : params.padding).map(([edge, value]) => <span key={edge}>{edge[0].toUpperCase()} {value}</span>)}</div></>}
        {tool.id === "upscale" && <div className="ms-editor-options" role="group" aria-label={t("放大倍数", "Upscale factor")}>{[2,4].map(scale => <button key={scale} aria-pressed={params.scale === scale} onClick={() => onParams({ scale })}>{scale}×<small>{selected.pixelWidth * scale} × {selected.pixelHeight * scale}</small></button>)}</div>}
        {tool.id === "video" && <label className="ms-editor-field">{t("时长", "Duration")}<select value={params.duration} onChange={event => onParams({ duration: Number(event.target.value) })}><option value="5">5s</option><option value="10">10s</option></select></label>}
        {tool.id === "split" && <><p className="ms-editor-description">{status?.layerCountMode === "auto" ? t("自动识别完整物体，拆分为独立图层。原图会保留，遮挡部分不会自动补全。", "Detect objects and separate them into editable layers. Your original stays; hidden content is not reconstructed.") : t("将画面拆分为可独立编辑的图层，保留原始位置和原图。", "Separate the image into editable layers, keeping their positions and your original.")}</p>{status?.layerCountMode !== "auto" && <label className="ms-editor-field">{t("拆分层数", "Layers")}<select value={params.numLayers} onChange={event => onParams({ numLayers: Number(event.target.value) })}>{[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>}</>}
        {tool.id === "remove-bg" && <p className="ms-editor-description">{t("识别主体并移除背景，生成透明图片，原图会保留。", "Isolate the subject on a transparent background. Your original stays on the canvas.")}</p>}
        {tool.id === "ocr" && <p className="ms-editor-description">{t("识别图片文字，再逐条修改为可编辑的文字图层。", "Recognize text, then replace it with editable text layers.")}</p>}
        {unavailable && <p className="ms-editor-unavailable" role="status">{status?.reason === "TOOL_DISABLED" ? t("管理员已停用此工具", "This tool is disabled") : t("请在后台为此工具配置模型服务", "Configure a model for this tool in Admin")}</p>}
      </div>
      <footer><span className="ms-editor-cost">{cost ? `${cost} ${t("积分", "credits")}` : t("免费", "Free")}</span><button className="ms-editor-apply" disabled={disabled} onClick={onRun} aria-label={`${action} ${cost ? `${cost} ${t("积分", "credits")}` : t("免费", "Free")}`}>{busy ? <LoaderCircle size={15} className="ms-spin" /> : null}{action}</button></footer>
    </div>
  </section>;
}
