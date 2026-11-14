"use client";

import { ArrowUp, ChevronDown, LoaderCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import CreditIcon from "@/components/ui/CreditIcon";
import "./creation-launcher.css";

export default function CreationComposer({
  zh, prompt, onPromptChange, placeholder, onSubmit, attachments, settings,
  cost, disabled = false, submitDisabled = false, busy = false, recovering = false,
  promptLabel, submitLabel, maxLength = 12000, onDragOver, onDrop, onPaste, children,
}) {
  const text = (cn, en) => zh ? cn : en;
  return <form className="cr-creation-launcher" onSubmit={onSubmit} onDragOver={onDragOver} onDrop={onDrop} onPaste={onPaste}>
    <textarea
      aria-label={promptLabel || text("创作需求", "Creation request")}
      value={prompt} disabled={disabled} maxLength={maxLength}
      onChange={event => onPromptChange(event.target.value)} placeholder={placeholder}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault();
          if (!event.repeat && !submitDisabled && !busy) event.currentTarget.form.requestSubmit();
        }
      }}
    />
    {attachments}
    <div className="cr-creation-options">
      <details className="cr-creation-settings">
        <summary><SlidersHorizontal size={15} /><span>{text("参数", "Settings")}</span><ChevronDown size={12} /></summary>
        <div className="cr-creation-settings-panel">{settings}</div>
      </details>
      <button type="submit" className="cr-send" disabled={submitDisabled || busy} aria-label={submitLabel || text(recovering ? "恢复提交" : "开始创作", recovering ? "Recover submission" : "Start creating")}>
        {/* 积分显示在发送按钮内，与首页图片模式保持一致 */}
        <span className="cr-creation-cost" aria-live="polite"><CreditIcon size={13} />{cost ?? "—"}<span className="sr-only"> {text("积分", "credits")}</span></span>
        <span className="cr-send-icon">{busy ? <LoaderCircle size={18} className="ca-spin" /> : recovering ? <RefreshCw size={18} /> : <ArrowUp size={18} strokeWidth={2.4} />}</span>
      </button>
    </div>
    {children}
  </form>;
}
