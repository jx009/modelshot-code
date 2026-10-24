"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { requestKey } from "@/lib/client-api";
import { suggestedWebPath } from "@/lib/creation/client/web-files";
import { creationError } from "./creation-errors";

export default function WebFileDialog({ action, file, content, zh, onSubmit, onClose }) {
  const [path, setPath] = useState(() => action === "create" || action === "duplicate" ? suggestedWebPath(content, action === "duplicate" ? file : null) : file.path);
  const [kind, setKind] = useState(file?.kind || "html"), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const gate = useRef(false), identity = useRef(null);
  const text = (cn, en) => zh ? cn : en;
  const removing = action === "delete", renaming = action === "rename";
  const title = removing ? text("删除文件", "Delete file") : renaming ? text("重命名文件", "Rename file") : action === "duplicate" ? text("复制文件", "Duplicate file") : text("新建文件", "New file");
  async function submit(event) {
    event.preventDefault(); if (gate.current) return;
    gate.current = true; setBusy(true); setError(null);
    try {
      identity.current ||= `file-${requestKey()}`;
      await onSubmit({ action, fileId: file?.id, path: file?.path, nextPath: path.trim(), kind, newId: identity.current, zh });
      onClose();
    } catch (error) { setError(error); }
    finally { gate.current = false; setBusy(false); }
  }
  return <Modal label={title} onClose={() => { if (!gate.current) onClose(); }}><form className="cw-web-file-dialog" aria-label={title} onSubmit={submit}>
    <header><h2>{title}</h2><button type="button" aria-label={text("关闭文件操作", "Close file action")} disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {removing ? <><strong>{file.path}</strong><p>{text("删除后可撤销恢复。其他文件中的引用不会自动移除，请同时检查使用这个文件的页面。", "You can undo this deletion. References in other files are not removed automatically; check pages that use this file.")}</p></> : <>
      {action === "create" && <label>{text("文件类型", "File type")}<select aria-label={text("文件类型", "File type")} disabled={busy} value={kind} onChange={event => { const next = event.target.value; setKind(next); setPath(value => value.replace(/\.(?:html?|css|m?js)$/i, `.${next}`)); }}><option value="html">HTML</option><option value="css">CSS</option><option value="js">JavaScript</option></select></label>}
      <label>{text("文件路径", "File path")}<input aria-label={text("文件路径", "File path")} value={path} disabled={busy} maxLength={240} spellCheck={false} autoComplete="off" onChange={event => setPath(event.target.value)} /></label>
      <p>{text("使用英文字母、数字、短横线或下划线；可用 / 创建目录。", "Use letters, digits, hyphens or underscores; use / for folders.")}</p>
      {action === "duplicate" && <p>{text("复制保留文件原内容；放到其他目录后，请检查相对路径引用。", "The copy preserves the original contents. Check relative references if you place it in another folder.")}</p>}
      {renaming && <p>{text("会同步更新 HTML、CSS 中的静态引用。脚本与数据中的动态路径不会改写，请在修改后检查。", "Static references in HTML and CSS will be updated. Dynamic paths in scripts and data stay unchanged; check them after renaming.")}</p>}
    </>}
    {error && <p role="alert" className="cw-error">{creationError(error, zh)}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>{text("取消", "Cancel")}</button><button type="submit" disabled={busy || !removing && !path.trim()}>{busy ? text("正在处理…", "Working…") : removing ? text("确认删除", "Confirm delete") : renaming ? text("确认重命名", "Confirm rename") : text("创建文件", "Create file")}</button></footer>
  </form></Modal>;
}
