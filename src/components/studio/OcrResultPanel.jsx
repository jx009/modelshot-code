"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";

export default function OcrResultPanel({ result, zh, cost, canReplace, onChange, onReplace, onClose, onError }) {
  const close = useRef(null);
  const [copiedText, setCopiedText] = useState(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    const escape = event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  const t = (cn, en) => zh ? cn : en;
  const boxes = result.boxes || [];
  const fullText = boxes.map(box => box.text).join("\n");
  async function copyAll() {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(fullText); copied = true; } catch { /* Use selection copying when clipboard permission is unavailable. */ }
      }
      if (!copied) {
        const previous = document.activeElement;
        const field = document.createElement("textarea");
        field.value = fullText; field.readOnly = true;
        field.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(field);
        try { field.select(); copied = document.execCommand("copy"); }
        finally { field.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); }
      }
      if (!copied) throw new Error(t("复制失败，请选中文字后手动复制。", "Copy failed. Select the text and copy it manually."));
      setCopiedText(fullText);
    } catch (error) { onError(error); }
  }
  return <section className="ms-tool-panel ms-ocr-panel" role="dialog" aria-label={t("图片中的文字", "Image text")}>
    <header className="ms-ocr-header">
      <div className="ms-panel-title"><strong>{t("图片中的文字", "Image text")}</strong><button ref={close} className="ms-icon" onClick={onClose} aria-label={t("关闭文字识别结果", "Close text recognition results")}><X size={16} /></button></div>
      <div className="ms-ocr-actions"><span>{t(`识别到 ${boxes.length} 段文字`, `${boxes.length} text regions`)}</span><button className="ms-text-button" disabled={!boxes.length} onClick={copyAll}><Copy size={13} />{copiedText === fullText ? t("已复制", "Copied") : t("复制全部文字", "Copy all text")}</button></div>
    </header>
    <div className="ms-ocr-content">
      <p>{t(`修改文字后，移除原文字并创建可编辑文字层。${cost} 积分/区域。`, `Replace original text with an editable layer. ${cost} credits per region.`)}</p>
      {result.approximateLocations && <p>{t("文字位置由模型估算，请核对后再替换；无法定位的文字可复制使用。", "Text positions are estimated. Check before replacing; unlocated text can still be copied.")}</p>}
      {!boxes.length && <p>{t("未识别到文字", "No text found")}</p>}
      {boxes.map((box, index) => <div className="ms-ocr-row" key={index}><input aria-label={t(`第 ${index + 1} 段文字`, `Text region ${index + 1}`)} value={box.text} onChange={event => onChange({ ...result, boxes: boxes.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} /><button className="ms-icon" disabled={!canReplace || !box.rect} onClick={() => onReplace(box)} title={t("替换此文字", "Replace text")}><Check size={16} /></button></div>)}
    </div>
  </section>;
}
