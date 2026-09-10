"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Camera, LoaderCircle, Sparkles, X, Images } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import AssetRail from "@/components/studio/AssetRail";
import ParamsPanel from "@/components/studio/ParamsPanel";
import VariantCanvas from "@/components/studio/VariantCanvas";
import Filmstrip from "@/components/ui/Filmstrip";
import { downloadImage } from "@/lib/image-download";

const defaults = { modelSource: "preset", modelPresetId: "", personImage: "", scenePresetId: "", garmentType: "top", platformSpec: "", aspectRatio: "3:4", prompt: "", pose: "standing", camera: "eye_level", lighting: "soft", variants: 1 };
const terminal = status => ["completed", "needs_review", "failed"].includes(status);

export default function StudioPage() {
  const t = useTranslations("workspace");
  const ts = useTranslations("studio");
  const te = useTranslations("errors");
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [config, setConfig] = useState(defaults);
  const [images, setImages] = useState([]);
  const [batchMode, setBatchMode] = useState(false);
  const [models, setModels] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState(null);
  const [variants, setVariants] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("assets");
  const restored = useRef(false);
  const requestLock = useRef(false);
  const busy = uploading || submitting || !!job;

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true); setPresetsError(false);
    try {
      const responses = await Promise.all([fetch("/api/presets?type=models"), fetch("/api/presets?type=scenes")]);
      if (responses.some(r => !r.ok)) throw new Error("presets");
      const [m, s] = await Promise.all(responses.map(r => r.json()));
      setModels(m); setScenes(s);
      setConfig(c => ({ ...c, modelPresetId: c.modelPresetId || m[0]?.id || "" }));
    } catch { setPresetsError(true); } finally { setPresetsLoading(false); }
  }, []);
  useEffect(() => { Promise.resolve().then(loadPresets); }, [loadPresets]);

  const loadUsage = useCallback(async () => {
    try { const r = await fetch("/api/usage"); if (r.ok) setUsage(await r.json()); } catch { /* Estimate falls back to the published credit rate. */ }
  }, []);
  useEffect(() => { if (status === "authenticated") Promise.resolve().then(loadUsage); }, [status, loadUsage]);

  useEffect(() => {
    if (status !== "authenticated" || restored.current) return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) return;
    restored.current = true;
    const controller = new AbortController();
    fetch(`/api/tryons?id=${encodeURIComponent(id)}`, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error("restore"); return r.json(); }).then(record => {
      setImages([record.clothesImage]);
      setConfig(c => ({ ...c, ...Object.fromEntries(Object.keys(defaults).filter(k => record[k] != null).map(k => [k, record[k]])), modelSource: record.modelPresetId ? "preset" : "custom", personImage: record.personImage, variants: 1 }));
      setVariants([record]); setSelectedId(record.id); setTab("output");
      if (!terminal(record.status)) setJob({ ids: [record.id] });
    }).catch(err => { if (err.name !== "AbortError") setError(t("loadError")); });
    return () => { controller.abort(); restored.current = false; };
  }, [status, t]);

  // A single cancellable poll belongs to the active job, including recovered jobs.
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let timer;
    let failures = 0;
    const poll = async () => {
      try {
        const url = job.batchId ? `/api/batch?id=${encodeURIComponent(job.batchId)}` : `/api/tryons?ids=${job.ids.map(encodeURIComponent).join(",")}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("poll");
        const data = await response.json();
        const records = job.batchId ? data.tryons : data;
        if (!Array.isArray(records) || (!job.batchId && records.length !== job.ids.length)) throw new Error("missing job");
        failures = 0;
        setVariants(records); setSelectedId(id => records.some(r => r.id === id) ? id : records[0]?.id || "");
        if ((records.length > 0 && records.every(r => terminal(r.status))) || (job.batchId && terminal(data.status))) {
          setJob(null); loadUsage(); update();
          if (records.length && records.every(r => r.status === "failed")) setError(t("failed"));
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (++failures >= 5) { setError(t("networkError")); setJob(null); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(2500 * (failures + 1), 10000));
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, loadUsage, t, update]);

  const change = (key, value) => setConfig(c => ({ ...c, [key]: value }));
  const login = () => router.push("/login?callbackUrl=" + encodeURIComponent(window.location.pathname));
  async function uploadFiles(files, model = false) {
    if (!files.length || requestLock.current || busy) return;
    if (!session?.user) { login(); return; }
    const selected = model || !batchMode ? files.slice(0, 1) : files;
    if (!model && batchMode && images.length + selected.length > 50) { setError(ts("batchLimit")); return; }
    if (selected.some(f => !["image/png", "image/jpeg", "image/webp"].includes(f.type) || f.size > 10 * 1024 * 1024)) { setError(t("fileError")); return; }
    requestLock.current = true; setUploading(true); setError("");
    try {
      // Sequential uploads keep memory bounded and retain successful files on partial failure.
      for (const file of selected) {
        const form = new FormData(); form.append("file", file);
        const r = await fetch("/api/upload", { method: "POST", body: form });
        if (!r.ok) throw new Error("upload");
        const { url } = await r.json();
        if (model) change("personImage", url);
        else setImages(prev => batchMode ? [...prev, url] : [url]);
      }
    } catch { setError(t("uploadError")); } finally { setUploading(false); requestLock.current = false; }
  }

  async function generate() {
    if (requestLock.current || busy) return;
    if (!session?.user) { login(); return; }
    if (!images.length) { setError(ts("errNoGarment")); setTab("assets"); return; }
    if (config.modelSource === "preset" ? !config.modelPresetId : !config.personImage) { setError(t("chooseModel")); setTab("settings"); return; }
    requestLock.current = true; setSubmitting(true); setError("");
    try {
      const payload = { ...config, modelPresetId: config.modelSource === "preset" ? config.modelPresetId : undefined, personImage: config.modelSource === "custom" ? config.personImage : undefined, clothesImage: images[0], ...(batchMode ? { images, variants: 1 } : {}) };
      const response = await fetch(batchMode ? "/api/batch" : "/api/tryon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error && te.has(data.error) ? te(data.error, data) : t("failed"));
      }
      const data = await response.json();
      const ids = data.tryonIds || (data.tryonId ? [data.tryonId] : []);
      setVariants(ids.map(id => ({ id, status: "processing", clothesImage: images[0], aspectRatio: config.aspectRatio })));
      setSelectedId(ids[0] || "");
      setJob(batchMode ? { batchId: data.batchJobId } : { ids });
      setTab("output"); loadUsage(); update();
    } catch (err) { setError(err.message); } finally { setSubmitting(false); requestLock.current = false; }
  }

  const count = batchMode ? images.length : config.variants;
  const quota = Math.min(count, usage?.remaining || 0);
  const creditCost = (count - quota) * 18;
  const ownKey = !batchMode && !!session?.user?.customApiKey;
  const done = variants.filter(v => terminal(v.status)).length;
  return <div className="studio-shell" data-mobile-tab={tab}>
    <div className="studio-heading"><div className="flex items-center gap-3"><Camera size={19} className="text-primary" /><h1>{t("title")}</h1></div><div className="flex items-center gap-4"><div className="mode-switch">{[false, true].map(mode => <button key={String(mode)} disabled={busy} aria-pressed={batchMode === mode} onClick={() => { setBatchMode(mode); if (mode) change("modelSource", "preset"); }}>{ts(mode ? "batch" : "single")}</button>)}</div><Link className="studio-library-link" href="/gallery">{t("gallery")}<ArrowUpRight size={15} /></Link></div></div>
    <div className="mobile-workspace-tabs">{["assets", "settings", "output"].map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{t(key)}</button>)}</div>
    <div className="studio-body">
      <AssetRail images={batchMode ? images : images.slice(0, 1)} batchMode={batchMode} busy={busy} uploading={uploading} onFiles={uploadFiles} onRemove={index => setImages(v => v.filter((_, i) => i !== index))} />
      <main className="studio-center"><VariantCanvas variants={variants} selectedId={selectedId} onSelect={setSelectedId} garmentImage={images[0]} busy={!!job || submitting} onDownload={v => downloadImage(v.resultImage, `modelshot-${v.id}.png`).catch(() => setError(t("partialExport")))} />
        <div className="filmstrip-heading"><Images size={13} /><span>{t("history")}</span><span className="ml-auto tabular-nums">{variants.length ? t("generating", { done, total: variants.length }) : "00"}</span></div>
        <Filmstrip items={variants.map(v => ({ id: v.id, image: v.resultImage, status: v.status }))} selectedId={selectedId} onSelect={setSelectedId} emptyLabel={t("noResult")} />
      </main>
      <ParamsPanel config={config} onChange={change} models={models} scenes={scenes} loading={presetsLoading} error={presetsError} onRetry={loadPresets} batchMode={batchMode} disabled={busy} onModelFile={file => uploadFiles([file], true)} />
    </div>
    {error && <div className="workspace-error" role="alert"><span>{error}</span><Link href="/gallery">{t("gallery")}<ArrowUpRight size={13} /></Link><button className="icon-button" title={t("close")} aria-label={t("close")} onClick={() => setError("")}><X size={15} /></button></div>}
    <footer className="generation-bar"><div className="cost-summary"><span>{t("estimate")}</span><strong>{ownKey ? t("ownKey") : usage ? [quota > 0 && t("quotaCost", { count: quota }), creditCost > 0 && t("creditCost", { count: creditCost })].filter(Boolean).join(" + ") || t("creditCost", { count: 0 }) : t("costFallback")}</strong>{usage && <small>{t("available", { count: usage.remaining })}</small>}</div><button className="button primary generate-button" disabled={busy || status === "loading"} onClick={generate}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}<span>{job ? t("generating", { done, total: variants.length || count }) : uploading ? ts("uploading") : !session?.user ? t("loginGenerate") : t("start")}</span>{!busy && <span className="generate-count">{count}</span>}</button></footer>
  </div>;
}
