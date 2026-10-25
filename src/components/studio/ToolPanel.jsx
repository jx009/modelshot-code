"use client";

import Image from "@/components/studio/AssetImage";
import { useState } from "react";
import { X, RotateCcw, Paintbrush, LoaderCircle, ImageIcon, ChevronDown, ChevronUp } from "lucide-react";
import CropControls from "./CropControls";
import { previewUrl } from "@/lib/studio/image-url";
import "./tool-panel.css";
import { upscaleInputError } from "@/lib/studio/upscale";
import { expansionPadding, expansionEdges } from "@/lib/studio/edit-geometry";
import ImageSizePicker from "@/components/ui/ImageSizePicker";
import { billingResolution } from "@/lib/studio/image-pricing";
import { imageSizeChoice } from "@/lib/studio/image-size";

/** Shared, stable editing surface. Tool state stays owned by the workbench. */
export default function ToolPanel({ tool, Icon, status, selected, params, onParams, prompt, onPrompt, brush, onBrush, hasMask, selection, busy, moveUnchanged, cost, zh, onClose, onReset, onRun, referenceLayers = [], selectedReferences = [], onReferences, onAddReferences, onIdentify, identifyCost = 1, canIdentify = false }) {
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const t = (cn, en) => zh ? cn : en;
  const referenceLimit = status?.maxUserReferences ?? 2;
  const paint = ["inpaint", "erase", "text-edit"].includes(tool.id);
  const move = tool.id === "move";
  const crop = tool.id === "crop";
  const edges = tool.id === "expand" ? expansionEdges(params.padding) : null;
  const promptTool = paint || move || ["expand", "video", "describe", "template", "merge", "focus", "enhance", "translate"].includes(tool.id);
  const unavailable = !status?.available && !crop;
  const upscaleError = tool.id === "upscale" && upscaleInputError({ width: selected.pixelWidth, height: selected.pixelHeight }, params.scale);
  const disabled = busy || selectedReferences.length > referenceLimit || unavailable || upscaleError || (crop && !params.rect) || (paint && !hasMask) || (move && (!selection || moveUnchanged)) || (["inpaint", "video", "merge", "focus"].includes(tool.id) && !prompt.trim()) || (tool.id === "text-edit" && !params.newText?.trim()) || (tool.id === "merge" && !selectedReferences.length) || (tool.id === "focus" && (!params.focusPoints?.length || params.focusPoints.some(p => p.loading || !p.label.trim())));
  const hint = move ? selection ? t("提示：可移动、缩放或旋转源区域与目标区域", "Move, resize or rotate the source and destination regions") : t("提示：请在目标对象上拖拽框选需要移动的区域", "Draw a rectangle around the complete object to move")
    : paint ? t("提示：用画笔大致圈出需要修改的区域", "Use the brush to outline the area you want to edit")
      : crop ? t("拖动边界调整裁剪区域，原图会保留", "Drag the handles to crop. Your original stays on the canvas")
        : tool.id === "expand" ? t("拖动图片外侧边界，或选择比例扩展画面", "Drag the outer handles or choose an aspect ratio") : "";
  const action = move ? t("确认移动", "Apply move") : tool.id === "inpaint" ? t("生成修改", "Apply edit") : crop ? t("裁剪", "Apply") : tool.id === "erase" ? t("消除", "Apply") : t("生成", "Apply");
  return <section className={`ms-editor ms-editor-${tool.id}`} data-collapsed={collapsed} aria-label={zh ? tool.zh : tool.en}>
    {hint && <p className="ms-editor-hint">{hint}</p>}
    <div className="ms-editor-card">
      <header><Icon size={16} /><h2>{zh ? tool.zh : tool.en}</h2>
        <button className="ms-editor-icon" type="button" aria-expanded={!collapsed} aria-label={t(collapsed ? "展开编辑参数" : "收起编辑参数", collapsed ? "Expand edit controls" : "Collapse edit controls")} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</button>
        {(move || paint || crop || tool.id === "expand") && <button className="ms-editor-icon" type="button" disabled={busy || (move && !selection) || (paint && !hasMask)} onClick={onReset} title={move ? t("重新框选", "Select again") : paint ? t("清除", "Clear") : t("重置", "Reset")}><RotateCcw size={16} /></button>}
        <button className="ms-editor-icon" type="button" disabled={busy} onClick={onClose} title={t("关闭工具", "Close tool")}><X size={18} /></button>
      </header>
      <div className="ms-editor-content">
        {tool.dependency === "image" && <div className="ms-editor-resolution"><span>{t("输出比例与分辨率", "Output size")}</span><ImageSizePicker value={params.size} onChange={size => onParams({ size })} zh={zh} disabled={busy} source={{ width: selected.pixelWidth, height: selected.pixelHeight }} />{status?.billingResolutions && <small>{t("此工具保持编辑区域比例", "Uses the edited area's aspect ratio")}{billingResolution(status, params.size) !== imageSizeChoice(params.size).resolution && t(` · 当前模型实际按 ${billingResolution(status, params.size)} 输出并计费`, ` · This model outputs and bills at ${billingResolution(status, params.size)}`)}</small>}</div>}
        {tool.id === "text-edit" && <label className="ms-editor-field">{t("替换为", "Replace with")}<input aria-label={t("替换文字", "Replacement text")} value={params.newText || ""} onChange={e => onParams({ newText: e.target.value })} maxLength={1000} placeholder={t("涂抹文字区域，再输入新文字", "Mark the text, then enter its replacement")} /></label>}
        {tool.id === "translate" && <label className="ms-editor-field">{t("目标语言", "Target language")}<select aria-label={t("翻译语言", "Translation language")} value={params.language || "en"} onChange={e => onParams({ language: e.target.value })}>{[["en","英语","English"],["zh","中文","Chinese"],["ja","日语","Japanese"],["ko","韩语","Korean"],["fr","法语","French"],["de","德语","German"],["es","西班牙语","Spanish"],["pt","葡萄牙语","Portuguese"],["ru","俄语","Russian"],["th","泰语","Thai"]].map(([v,cn,en]) => <option key={v} value={v}>{t(cn,en)}</option>)}</select></label>}
        {tool.id === "focus" && <div className="ms-focus-points"><p>{t("在画面中点击对象，再用 @1、@2 描述修改。最多 10 个焦点，可直接编辑对象名称。", "Click objects, then use @1 or @2 in your request. Add up to 10 points and edit their labels.")}</p>{(params.focusPoints || []).map((point,index) => <div key={point.id}><span>@{index + 1}</span>{point.loading ? <LoaderCircle size={14} className="ms-spin" /> : null}<button disabled={!canIdentify || point.loading || busy} onClick={() => onIdentify(point)} title={`${t("识别对象", "Identify object")} · ${identifyCost} ${t("积分", "credits")}`}>{t("识别", "Identify")} · {identifyCost}</button><input aria-label={`${t("焦点", "Point ")}${index + 1}`} value={point.label} maxLength={100} onChange={e => onParams({ focusPoints: params.focusPoints.map(p => p.id === point.id ? { ...p, label: e.target.value, loading: false, manual: true } : p) })} /><button onClick={() => onParams({ focusPoints: params.focusPoints.filter(p => p.id !== point.id) })} aria-label={`${t("移除焦点", "Remove point ")}${index + 1}`}><X size={14} /></button></div>)}</div>}
        {["merge", "inpaint"].includes(tool.id) && <div className="ms-tool-references">
          <p><button type="button" aria-expanded={referencesOpen} onClick={() => setReferencesOpen(value => !value)}>{t("参考图片", "Reference images")} · {selectedReferences.length}/{referenceLimit}</button><button type="button" onClick={onAddReferences}>{t("素材库", "Asset library")}</button></p>
          <div>{referenceLayers.filter((layer, index) => selectedReferences.includes(layer.assetId) || referencesOpen && index < 8).map(layer => <button type="button" key={layer.id} aria-label={`${t("参考", "Reference ")}${layer.name}`} aria-pressed={selectedReferences.includes(layer.assetId)} disabled={busy || !selectedReferences.includes(layer.assetId) && selectedReferences.length >= referenceLimit} onClick={() => onReferences(selectedReferences.includes(layer.assetId) ? selectedReferences.filter(id => id !== layer.assetId) : [...selectedReferences, layer.assetId])}><Image unoptimized src={previewUrl(layer.assetId, 320)} width={40} height={40} alt={layer.name} /><span>{layer.name}</span></button>)}</div>
        </div>}
        {paint && <div className="ms-editor-reference"><Image unoptimized src={previewUrl(selected.assetId, 320)} width={56} height={56} alt={selected.name} /><span>{t("原图", "Source")}<small>{selected.pixelWidth} × {selected.pixelHeight}</small></span></div>}
        {promptTool && <textarea className="ms-editor-prompt" aria-label={move ? t("移动补充说明", "Move instruction") : tool.id === "inpaint" ? t("局部修改描述", "Local edit instruction") : t("工具提示词", "Tool prompt")} placeholder={move ? t("您可补充移动后的效果要求，或留空", "Describe the result after moving, or leave blank") : tool.id === "inpaint" ? t("请在此描述您的修改灵感", "Describe how the selected area should change") : tool.id === "video" ? t("描述画面运动、镜头和节奏…", "Describe motion, camera and pacing…") : t("可补充效果要求，或留空", "Additional instructions (optional)")} value={prompt} onChange={event => onPrompt(event.target.value)} maxLength={4000} disabled={busy} />}
        {paint && <div className="ms-editor-brush"><Paintbrush size={15} /><label htmlFor="studio-brush">{t("画笔", "Brush")}</label><input id="studio-brush" aria-label={t("画笔大小", "Brush size")} type="range" min="5" max="200" value={brush} onChange={event => onBrush(Number(event.target.value))} /><output>{brush}px</output><button className="ms-editor-icon" title={t("清除选区", "Clear selection")} disabled={!hasMask || busy} onClick={onReset}><RotateCcw size={16} /></button></div>}
        {move && selection && <div className="ms-move-offset ms-editor-offset" data-source={JSON.stringify(params.moveSource)} data-target={JSON.stringify(params.moveTarget)}><span>ΔX {params.moveTarget.left - params.moveSource.left}px</span><span>ΔY {params.moveTarget.top - params.moveSource.top}px</span><span>{t("旋转", "Rotation")} {params.moveTarget.rotation || 0}°</span></div>}
        {crop && <CropControls value={params} onChange={onParams} width={selected.pixelWidth} height={selected.pixelHeight} zh={zh} />}
        {tool.id === "expand" && <><div className="ms-editor-ratios" role="group" aria-label={t("扩图比例", "Expansion ratio")}>{["1:1", "4:3", "3:4", "16:9", "9:16"].map(label => {
          const padding = expansionPadding(selected.pixelWidth, selected.pixelHeight, label);
          return <button key={label} type="button" disabled={busy || !padding} onClick={() => onParams({ padding })}><ImageIcon size={16} />{label}</button>;
        })}</div><div className="ms-edge-readout">{Object.entries(edges).map(([edge, value]) => <span key={edge}>{edge[0].toUpperCase()} {value}</span>)}</div><p className="ms-editor-description">{t("输出画布", "Output canvas")}：{selected.pixelWidth + edges.left + edges.right} × {selected.pixelHeight + edges.top + edges.bottom}</p></>}
        {tool.id === "upscale" && <div className="ms-editor-options" role="group" aria-label={t("放大倍数", "Upscale factor")}>{(status?.supportedScales || [2]).map(scale => <button key={scale} aria-pressed={params.scale === scale} onClick={() => onParams({ scale })}>{scale}×<small>{selected.pixelWidth * scale} × {selected.pixelHeight * scale}</small></button>)}</div>}
        {tool.id === "upscale" && <p className="ms-editor-description">{upscaleError ? t("当前图片尺寸不支持放大：输入需宽 50–2128、高 50–4064 像素。", "Input must be 50–2128 px wide and 50–4064 px high.") : t("放大为原图的 2 倍，保留原图。输入文件最大 5 MB。", "Upscale to 2× and keep the original. Input limit: 5 MB.")}</p>}
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
