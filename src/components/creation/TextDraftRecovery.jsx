"use client";

import { useState } from "react";

export default function TextDraftRecovery({ draft, content, onChange, onRestore, onDiscard, disabled, canRestore, zh }) {
  const [text, setText] = useState(draft.text), [busy, setBusy] = useState(false);
  const page = content?.pages?.find(page => page.id === draft.pageId), node = page?.nodes?.find(node => node.id === draft.nodeId);
  const t = (cn, en) => zh ? cn : en;
  async function act(callback) {
    if (busy) return;
    setBusy(true);
    try { await callback({ ...draft, text, composing: false }); }
    finally { setBusy(false); }
  }
  return <aside className="cw-text-recovery" aria-label={t("恢复未提交文字", "Recover unfinished text")}>
    <strong>{t("发现上次未提交的文字", "Unfinished text from your last visit")}</strong>
    <p>{t("请核对输入后恢复。若原对象已变化，可先复制下方文字，再自行决定如何处理。", "Review the text before restoring. If the original object changed, copy the text below and decide how to use it.")}</p>
    {node && <small>{page.title} · {node.name}</small>}
    <textarea aria-label={t("待恢复文字", "Text to recover")} value={text} maxLength={draft.format === "html-source" ? 160 * 1024 : 16000} disabled={disabled || busy} onChange={event => {
      const value = event.target.value; setText(value); onChange({ ...draft, text: value, composing: false });
    }} />
    <div><button disabled={disabled || busy || !canRestore} onClick={() => void act(onRestore)}>{t("恢复到作品", "Restore to artwork")}</button>
      <button disabled={disabled || busy} onClick={() => void act(onDiscard)}>{t("放弃这段草稿", "Discard this draft")}</button></div>
  </aside>;
}
