"use client";
import { useState } from "react";
import { useLocale } from "next-intl";
import { Trash2, Archive, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { api } from "@/lib/client-api";
import AssetImage from "@/components/ui/AssetImage";
import Modal from "@/components/ui/Modal";

export default function AccountAssets() {
  const zh = useLocale() === "zh";
  const [cursor, setCursor] = useState("");
  const assets = useRemoteResource(`/api/assets?cursor=${cursor}`);
  const drafts = useRemoteResource("/api/drafts");
  const projects = useRemoteResource("/api/projects");
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); setError("");
    try { await api(confirm.url, { method: confirm.body ? "PATCH" : "DELETE", body: confirm.body }); setConfirm(null); assets.reload(); drafts.reload(); projects.reload(); }
    catch (err) { setError(err.code === "ASSET_IN_USE" ? (zh ? "素材仍被草稿或任务引用" : "Asset is referenced by a draft or job") : (zh ? "操作失败" : "Request failed")); } finally { setBusy(false); }
  }
  return <>
    <section className="account-section"><h2>{zh ? "项目和草稿" : "Projects and drafts"}</h2>{projects.data?.map(row => <div className="export-row" key={row.id}><span>{row.name}</span><span>{row.sku}</span><button className="icon-button" title={zh ? "归档项目" : "Archive project"} aria-label={zh ? "归档项目" : "Archive project"} onClick={() => setConfirm({ url: "/api/projects", body: { id: row.id, archived: true } })}><Archive size={16} /></button></div>)}{drafts.data?.map(row => <div className="export-row" key={row.id}><Link href={`/studio?draft=${row.id}`}>{row.name}</Link><button className="icon-button" title={zh ? "删除草稿" : "Delete draft"} aria-label={zh ? "删除草稿" : "Delete draft"} onClick={() => setConfirm({ url: `/api/drafts?id=${row.id}` })}><Trash2 size={16} /></button></div>)}</section>
    <section className="account-section"><h2>{zh ? "上传素材" : "Uploaded assets"}</h2>{(error || assets.error || drafts.error || projects.error) && <p role="alert">{error || (zh ? "加载失败" : "Load failed")}</p>}<div className="account-asset-grid">{assets.data?.items.map(row => <div key={row.id}><AssetImage src={`/api/assets/${row.id}`} alt={`${row.width} x ${row.height}`} /><div><span>{row.width} x {row.height}</span><button className="icon-button" disabled={row._count.references > 0} title={zh ? "删除素材" : "Delete asset"} aria-label={zh ? "删除素材" : "Delete asset"} onClick={() => setConfirm({ url: `/api/assets/${row.id}` })}><Trash2 size={16} /></button></div></div>)}</div>{assets.data?.nextCursor && <button className="icon-button" title={zh ? "下一页" : "Next page"} aria-label={zh ? "下一页" : "Next page"} onClick={() => setCursor(assets.data.nextCursor)}><ChevronRight size={18} /></button>}</section>
    {confirm && <Modal label={zh ? "确认操作" : "Confirm operation"} onClose={() => { if (!busy) setConfirm(null); }}><h2>{zh ? "确认操作" : "Confirm operation"}</h2><div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setConfirm(null)}>{zh ? "取消" : "Cancel"}</button><button className="button primary" disabled={busy} onClick={remove}>{zh ? "确认" : "Confirm"}</button></div></Modal>}
  </>;
}
