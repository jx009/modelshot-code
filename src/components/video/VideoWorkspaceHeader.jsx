"use client";

import { Check, Download, FolderOpen, MessageSquare, MoreHorizontal, PanelLeftOpen, Pencil, Redo2, Save, SunMoon, Undo2 } from "lucide-react";
import { useTheme } from "next-themes";
import WorkspaceHeader from "@/components/creation/WorkspaceHeader";

export default function VideoWorkspaceHeader({ project, zh, disabled, motion, editing, onEdit, chatOpen, onChat, treeOpen, onFiles, tab, history, onTravel, onDownloadProject, onRender, renderOffer, result, showMotion, onImport }) {
  const { draft, change, setError } = project;
  const { resolvedTheme, setTheme } = useTheme();
  const text = (cn, en) => zh ? cn : en;
  const canEdit = motion && draft.content.video.composition && draft.content.video.confirmed;
  return <WorkspaceHeader
    title={<>
      <input className="vm-project-name" value={draft.name} aria-label={text("项目名称", "Project name")} maxLength={100} disabled={disabled} onChange={event => { const name = event.target.value; change(current => ({ ...current, name })); }} />
      <span className="vm-save-status" role="status">{project.saving ? text("保存中", "Saving") : project.dirty ? text("待保存", "Unsaved") : project.id ? text("已保存", "Saved") : text("新项目", "New project")}</span>
    </>}
    actions={<>
      <button type="button" aria-label={text("切换对话与作品", "Toggle conversation and preview")} title={text("对话 / 作品", "Conversation / preview")} aria-pressed={chatOpen && tab === "chat"} onClick={onChat}><MessageSquare size={16} /></button>
      <button type="button" aria-label={text("切换文件列表", "Toggle files")} title={text("文件与素材", "Files and media")} aria-expanded={treeOpen} onClick={onFiles}><PanelLeftOpen size={16} /></button>
      {canEdit && <>
        <button type="button" disabled={disabled} aria-label={text(editing ? "完成编辑" : "编辑视频", editing ? "Finish editing" : "Edit video")} title={text(editing ? "完成编辑" : "编辑视频", editing ? "Finish editing" : "Edit video")} aria-pressed={editing} onClick={onEdit}>{editing ? <Check size={16} /> : <Pencil size={16} />}</button>
        <button className="vm-header-history" type="button" disabled={disabled || !history.past.length} aria-label={text("撤销", "Undo")} title={text("撤销", "Undo")} onClick={() => onTravel("past")}><Undo2 size={16} /></button>
        <button className="vm-header-history" type="button" disabled={disabled || !history.future.length} aria-label={text("重做", "Redo")} title={text("重做", "Redo")} onClick={() => onTravel("future")}><Redo2 size={16} /></button>
      </>}
      {result && (!showMotion || !canEdit) ? <a href={`/api/assets/${result.assetId}?download=1`} download aria-label={text("下载 MP4", "Download MP4")} title={text("下载 MP4", "Download MP4")}><Download size={16} /><span className="vm-header-label">MP4</span></a> : canEdit && <button type="button" disabled={disabled || !renderOffer?.available} onClick={onRender} aria-label={text("导出 MP4", "Export MP4")} title={text("导出 MP4", "Export MP4")}><Download size={16} /><span className="vm-header-label">MP4</span></button>}
      <details className="vm-header-more" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary aria-label={text("更多工作台操作", "More workspace actions")} title={text("更多", "More")}><MoreHorizontal size={18} /></summary>
        <div className="vm-header-menu" onClick={event => { if (event.target.closest("button:not(:disabled)")) { const menu = event.currentTarget.closest("details"); menu.open = false; menu.querySelector("summary")?.focus(); } }}>
          <button type="button" disabled={disabled || project.saving} onClick={() => { setError(""); void project.save().catch(() => {}); }}><Save size={15} />{text("保存项目", "Save project")}</button>
          {canEdit && <>
            <button className="vm-menu-history" type="button" disabled={disabled || !history.past.length} onClick={() => onTravel("past")}><Undo2 size={15} />{text("撤销", "Undo")}</button>
            <button className="vm-menu-history" type="button" disabled={disabled || !history.future.length} onClick={() => onTravel("future")}><Redo2 size={15} />{text("重做", "Redo")}</button>
            <button type="button" onClick={onDownloadProject}><FolderOpen size={15} />{text("下载可编辑工程", "Download editable project")}</button>
          </>}
          {motion && <button type="button" disabled={disabled} onClick={onImport}>{text("导入本账号工程 JSON", "Import project JSON")}</button>}
          <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}><SunMoon size={15} />{text("切换明暗主题", "Toggle theme")}</button>
        </div>
      </details>
    </>}
  />;
}
