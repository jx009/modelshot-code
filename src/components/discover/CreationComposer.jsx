"use client";

import { ArrowUp, ChevronDown, LoaderCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
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
      <span className="cr-creation-cost" aria-live="polite">{cost ?? "—"} {text("积分", "credits")}</span>
      <button type="submit" className="cr-send" disabled={submitDisabled || busy} aria-label={submitLabel || text(recovering ? "恢复提交" : "开始创作", recovering ? "Recover submission" : "Start creating")}>
        {busy ? <LoaderCircle size={18} className="ca-spin" /> : recovering ? <RefreshCw size={18} /> : <ArrowUp size={18} />}
      </button>
    </div>
    {children}
  </form>;
}
