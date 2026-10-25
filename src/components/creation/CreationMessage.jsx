"use client";

import { memo } from "react";
import { ChevronRight, Download, FileImage, FileText, Presentation, Sheet, Globe, ListChecks } from "lucide-react";
import { MessageReferenceAssets } from "./ReferenceAssets";

const icons = { slides: Presentation, poster: FileImage, document: FileText, sheet: Sheet, web: Globe };
// Render text only; never execute model-provided HTML or load remote images.
function inline(value) {
  return value.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
export function MessageText({ value = "" }) {
  return <div className="cw-message-text">{value.split(/\n\s*\n/).filter(Boolean).map((part, i) => {
    const lines = part.split("\n");
    if (lines.every(line => /^\s*[-*]\s+/.test(line))) return <ul key={i}>{lines.map((line, j) => <li key={j}>{inline(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>;
    if (lines.every(line => /^\s*\d+[.)、]\s*/.test(line))) return <ol key={i}>{lines.map((line, j) => <li key={j}>{inline(line.replace(/^\s*\d+[.)、]\s*/, ""))}</li>)}</ol>;
    if (/^#{1,4}\s+/.test(lines[0])) return <div key={i}><h4>{inline(lines[0].replace(/^#{1,4}\s+/, ""))}</h4>{lines.length > 1 && <MessageText value={lines.slice(1).join("\n")} />}</div>;
    return <p key={i}>{inline(part)}</p>;
  })}</div>;
}
export default memo(function CreationMessage({ message, artifacts, projectKind, zh, onOpen, onOutline, onWarm }) {
  const refs = Array.isArray(message.references) ? message.references : [], t = (cn, en) => zh ? cn : en;
  return <article data-message-id={message.id} className={"cw-message is-" + message.role}>
    <MessageText value={message.text} />
    <MessageReferenceAssets references={message.references} zh={zh} />
    {refs.filter(item => item.type === "artifact").map(item => {
      const file = artifacts?.find(file => file.id === item.artifactId), kind = file?.kind || projectKind, Icon = icons[kind] || FileText;
      return <button className="cw-message-file" key={item.artifactId + ":" + item.revision} onPointerEnter={() => onWarm(kind)} onFocus={() => onWarm(kind)} onClick={() => onOpen(item.artifactId, kind)}><Icon size={19} data-kind={kind} /><span><strong>{file?.name || t(kind === "slides" ? "演示文稿" : "创作作品", kind === "slides" ? "Presentation" : "Artwork")}</strong><small>{t("已保存", "Saved")} · V{item.revision}</small></span><ChevronRight size={16} /></button>;
    })}
    {refs.filter(item => item.type === "outline").map(item => <button className="cw-message-file" key={item.runId} onClick={() => onOutline(item.runId)}><ListChecks size={18} /><span>{t("查看并确认大纲", "Review outline")}</span><ChevronRight size={16} /></button>)}
    {refs.filter(item => item.type === "export").map(item => <a className="cw-message-file" key={item.exportId} href={"/api/creation/exports/" + encodeURIComponent(item.exportId) + "/download"}><Download size={17} /><span>{t("下载文件", "Download file")} · {item.format.toUpperCase()}</span><ChevronRight size={16} /></a>)}
  </article>;
});
