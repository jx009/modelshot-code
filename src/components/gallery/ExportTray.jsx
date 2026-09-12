"use client";
import { useEffect, useState } from "react";
import { Download, Ban, RefreshCw, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { api, requestKey } from "@/lib/client-api";

export default function ExportTray({ revision = 0 }) {
  const f = useTranslations("flow");
  const resource = useRemoteResource(`/api/exports?revision=${revision}`);
  const [error, setError] = useState("");
  const active = resource.data?.some(job => ["queued", "running"].includes(job.status));
  useEffect(() => { if (!active) return; const timer = setInterval(resource.reload, 4000); return () => clearInterval(timer); }, [active, resource.reload]);
  async function action(job, retry) {
    try {
      if (retry) await api("/api/exports", { method: "POST", key: requestKey(), body: { outputIds: job.selection.map(row => row.id), mode: job.selection[0]?.profile ? "delivery" : "original" } });
      else await api(`/api/exports/${job.id}`, { method: "DELETE" });
      resource.reload();
    } catch (err) { setError(f.has(`errors.${err.code}`) ? f(`errors.${err.code}`) : f("requestFailed")); }
  }
  if (!resource.data?.length && !resource.error) return null;
  return <section className="export-tray"><h2>{f("exports")}</h2>{(error || resource.error) && <p role="alert">{error || f("loadError")}</p>}{resource.data?.slice(0, 5).map(job => {
    const ready = ["succeeded", "partial_success"].includes(job.status);
    const expired = ready && new Date(job.expiresAt) <= new Date();
    return <div className="export-row" key={job.id}><span>{job.id.slice(-8)}</span><span>{expired ? f("exportExpired") : f.has(job.status) ? f(job.status) : job.status}</span><span>{job.completedCount}/{job.selection.length}</span>{ready && !expired ? <a className="icon-button" href={`/api/exports/${job.id}/download`} title={f("createExport")} aria-label={f("createExport")}><Download size={17} /></a> : ["queued", "running"].includes(job.status) ? <><LoaderCircle size={15} className="animate-spin" /><button className="icon-button" aria-label={f("cancel")} title={f("cancel")} onClick={() => action(job, false)}><Ban size={16} /></button></> : <button className="icon-button" aria-label={f("retry")} title={f("retry")} onClick={() => action(job, true)}><RefreshCw size={16} /></button>}{job.failures?.length > 0 && <span>{f("exportPartial")}: {job.failures.length}</span>}</div>;
  })}</section>;
}
