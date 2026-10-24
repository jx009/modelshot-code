"use client";

import { useState } from "react";

function address(entry) {
  let value = entry.column + 1, letters = "";
  while (value) { letters = String.fromCharCode(65 + (value - 1) % 26) + letters; value = Math.floor((value - 1) / 26); }
  return `${letters}${entry.row + 1}`;
}

export default function NativeInputRecovery({ entries, content, zh, busy, onDismiss }) {
  const [selected, setSelected] = useState(0);
  const entry = entries[Math.min(selected, entries.length - 1)];
  if (!entry) return null;
  const text = (cn, en) => zh ? cn : en;
  const label = item => `${content?.snapshot?.sheets?.[item.sheetId]?.name || item.sheetId} · ${address(item)} · V${item.revision}`;
  function download() {
    const body = entries.map(item => `${label(item)}\n${text("已输入文字", "Editor text")}\n${item.text}${item.composing || item.compositionText ? `\n\n${text("输入法组合文字（单独保留，可能与正文重叠）", "IME composition (separate; may overlap editor text)")}\n${item.compositionText}` : ""}`).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "input-recovery.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="cw-native-recovery" aria-label={text("上次输入备份", "Previous input backup")}>
    <strong>{text("发现上次未确认的输入备份", "Previous unconfirmed input found")}</strong>
    <p>{text("请先复制或下载需要的文字，再继续编辑。备份可能已包含在作品中；不会自动写回单元格，格式和输入法候选状态不会恢复。", "Copy or download any text you need before continuing. It may already be in the artwork. Nothing is inserted automatically; formatting and IME candidate state are not restored.")}</p>
    <label>{text("输入位置", "Input location")}<select value={Math.min(selected, entries.length - 1)} onChange={event => setSelected(Number(event.target.value))}>{entries.map((item, index) => <option key={index} value={index}>{label(item)}</option>)}</select></label>
    <textarea aria-label={text("备份文字", "Backup text")} readOnly value={entry.text} onFocus={event => event.target.select()} />
    {(entry.composing || entry.compositionText) && <label>{text("输入法组合文字（可能与上方文字重叠）", "IME composition (may overlap text above)")}<textarea aria-label={text("组合文字备份", "Composition backup")} readOnly value={entry.compositionText} onFocus={event => event.target.select()} /></label>}
    <div><button onClick={download}>{text("下载全部备份", "Download all backups")}</button><button disabled={busy} onClick={onDismiss}>{text("继续编辑并清除备份", "Continue and clear backups")}</button></div>
  </section>;
}
