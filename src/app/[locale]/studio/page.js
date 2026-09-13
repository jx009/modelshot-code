"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Camera, LoaderCircle, Sparkles, X, Images, Save, FolderOpen, Plus, Ban } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import AssetRail from "@/components/studio/AssetRail";
import ParamsPanel from "@/components/studio/ParamsPanel";
import VariantCanvas from "@/components/studio/VariantCanvas";
import Filmstrip from "@/components/ui/Filmstrip";
import Modal from "@/components/ui/Modal";
import { downloadImage } from "@/lib/image-download";
import { api, requestKey, terminalStatus } from "@/lib/client-api";
import { WORKFLOWS, workflowOutputCount } from "@/lib/domain/generation/workflow-catalog";

const defaults = { workflowId: "commerce-suite", briefHistory: [], productName: "", productFacts: {}, productCategory: "other", targetAudience: "", brandStyle: "", copyLanguage: "zh", headline: "", subheadline: "", referenceImages: [], modelSource: "preset", modelPresetId: "", personImage: "", scenePresetId: "", garmentType: "top", platformSpec: "", aspectRatio: "3:4", prompt: "", pose: "standing", camera: "eye_level", lighting: "soft", variants: 1, provider: "", projectId: "", sku: "", name: "" };

function sanitizeConfig(config, provider) {
  if (!provider) return config;
  const next = { ...config, provider: provider.id };
  if (provider.workflows !== "all" && !provider.workflows?.includes(next.workflowId)) next.workflowId = provider.workflows?.[0] || "single-shot";
  if (!provider.productCategories?.includes(next.productCategory)) next.productCategory = provider.productCategories?.[0] || "other";
  for (const control of ["pose", "camera", "lighting", "prompt"]) if (!provider.controls.includes(control)) next[control] = "";
  if (!provider.controls.includes("scene")) next.scenePresetId = "";
  if (!provider.garments.includes(next.garmentType)) next.garmentType = provider.garments[0];
  return next;
}

export default function StudioPage() {
  return <Suspense><StudioContent /></Suspense>;
}

function StudioContent() {
  const t = useTranslations("workspace");
  const ts = useTranslations("studio");
  const f = useTranslations("flow");
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [config, setConfig] = useState(defaults);
  const [images, setImages] = useState([]);
  const [batchMode, setBatchMode] = useState(false);
  const [models, setModels] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [providers, setProviders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [draft, setDraft] = useState(null);
  const [draftConflict, setDraftConflict] = useState(false);
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
  const [quote, setQuote] = useState(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [saved, setSaved] = useState(false);
  const requestLock = useRef(false);
  const busy = uploading || submitting || !!job || !!quote;
  const userId = session?.user?.id;
  const fail = useCallback(err => setError(f.has(`errors.${err.code || err.message}`) ? f(`errors.${err.code || err.message}`) : f("requestFailed")), [f]);

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true); setPresetsError(false);
    try {
      const [m, s] = await Promise.all([api("/api/presets?type=models"), api("/api/presets?type=scenes")]);
      setModels(m); setScenes(s);
      setConfig(c => ({ ...c, modelPresetId: c.modelPresetId || m[0]?.id || "" }));
    } catch { setPresetsError(true); } finally { setPresetsLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(loadPresets, 0); return () => clearTimeout(timer); }, [loadPresets]);
  const loadAccount = useCallback(async () => {
    const [u, caps, p, d] = await Promise.all([api("/api/usage"), api("/api/capabilities"), api("/api/projects"), api("/api/drafts")]);
    setUsage(u); setProviders(caps.providers); setProjects(p); setDrafts(d);
    setConfig(c => sanitizeConfig(c, caps.providers.find(p => p.id === c.provider) || caps.providers[0]));
  }, []);
  useEffect(() => { const timer = setTimeout(() => { if (userId) loadAccount().catch(fail); }, 0); return () => clearTimeout(timer); }, [userId, loadAccount, fail]);

  const restoreDraft = useCallback(async id => {
    const row = await api(`/api/drafts?id=${encodeURIComponent(id)}`);
    setDraft({ id: row.id, version: row.version }); setDraftConflict(false); setSaved(true);
    setConfig(c => ({ ...defaults, provider: c.provider, ...Object.fromEntries(Object.entries(row.config).filter(([key]) => key in defaults)), modelSource: row.config.personImage ? "custom" : "preset" }));
    setImages(row.config.images || []); setBatchMode((row.config.images?.length || 0) > 1); setTab("assets");
  }, []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const query = new URLSearchParams(search);
    (async () => {
      if (query.get("draft")) { await restoreDraft(query.get("draft")); return; }
      const id = query.get("id");
      if (id) {
        const record = await api(`/api/tryons?id=${encodeURIComponent(id)}`, { signal: controller.signal });
        setConfig(c => ({ ...c, ...record.snapshot?.config, modelSource: record.snapshot?.person ? "custom" : "preset", personImage: record.snapshot?.person ? `/api/assets/${record.snapshot.person.id}` : "", variants: 1,
          ...(query.has("retry") ? { retryOfId: record.id } : {}) }));
        setImages([record.clothesImage]); setVariants([record]); setSelectedId(record.id); setTab("output");
        if (!terminalStatus(record.status)) setJob({ batchId: record.batchJobId, ids: [record.id] });
      } else {
        const batchId = query.get("batch") || localStorage.getItem(`modelshot-job:${userId}`);
        if (batchId) { setJob({ batchId }); setTab("output"); }
      }
    })().catch(err => { if (err.name !== "AbortError") fail(err); });
    return () => controller.abort();
  }, [userId, search, restoreDraft, fail]);

  useEffect(() => {
    if (!job || !userId) return;
    const controller = new AbortController();
    let timer, failures = 0;
    async function poll() {
      try {
        const data = await api(job.batchId ? `/api/batch?id=${encodeURIComponent(job.batchId)}` : `/api/tryons?ids=${job.ids.map(encodeURIComponent).join(",")}`, { signal: controller.signal });
        const records = job.batchId ? data.tryons : data;
        if (!Array.isArray(records) || !records.length) throw new Error("JOB_NOT_FOUND");
        failures = 0; setVariants(records); setSelectedId(id => records.some(r => r.id === id) ? id : records[0].id);
        const finished = records.every(row => terminalStatus(row.status));
        const processed = records.every(row => row.status !== "succeeded" || row.exportStatus !== "pending" && row.qaStatus !== "pending");
        if (finished && processed) {
          setJob(null); localStorage.removeItem(`modelshot-job:${userId}`); await loadAccount(); await update(); return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (++failures >= 5) { fail(err); setJob(null); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(2500 * (failures + 1), 15000));
    }
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, userId, loadAccount, update, fail]);

  function change(key, value) {
    setSaved(false);
    setConfig(current => {
      const next = { ...current, [key]: value };
      if (key === "provider") {
        const provider = providers.find(row => row.id === value);
        return sanitizeConfig(next, provider);
      }
      return next;
    });
  }
  function patchConfig(values) {
    setSaved(false);
    setConfig(current => ({ ...current, ...values }));
  }
  function payload() {
    const { modelSource, ...data } = config;
    return { ...data, images: batchMode ? images : images.slice(0, 1), modelPresetId: modelSource === "preset" ? config.modelPresetId : null,
      personImage: modelSource === "custom" ? config.personImage : null, provider: config.provider || undefined, projectId: config.projectId || null };
  }
  const login = () => router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  async function uploadFiles(files, target = "product", role = "detail") {
    if (!files.length || requestLock.current || busy) return;
    if (!userId) { login(); return; }
    const selected = target === "model" || target === "product" && !batchMode ? files.slice(0, 1) : files;
    if (target === "product" && images.length + selected.length > 50) { setError(ts("batchLimit")); return; }
    if (target === "reference" && config.referenceImages.length + selected.length > 15) { setError(ts("referenceLimit")); return; }
    requestLock.current = true; setUploading(true); setError("");
    try {
      for (const file of selected) {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.code);
        if (target === "model") change("personImage", result.url);
        else if (target === "reference") setConfig(current => ({ ...current, referenceImages: [...current.referenceImages, { id: result.url, role }] }));
        else setImages(previous => batchMode ? [...previous, result.url] : [result.url]);
      }
      setSaved(false);
    } catch (err) { fail(err); } finally { setUploading(false); requestLock.current = false; }
  }
  async function getQuote() {
    if (requestLock.current || busy) return;
    if (!userId) { login(); return; }
    requestLock.current = true; setSubmitting(true); setError("");
    try { setQuote({ ...await api("/api/quotes", { method: "POST", body: payload() }), key: requestKey() }); }
    catch (err) { fail(err); } finally { setSubmitting(false); requestLock.current = false; }
  }
  async function confirmQuote() {
    if (!quote || requestLock.current) return;
    requestLock.current = true; setSubmitting(true);
    try {
      const data = await api("/api/tryon", { method: "POST", body: { quoteId: quote.quoteId, digest: quote.digest }, key: quote.key });
      const tasks = quote.snapshot.tasks || [];
      setVariants(data.tryonIds.map((id, index) => {
        const task = tasks[Math.floor(index / config.variants) % Math.max(tasks.length, 1)];
        return { id, status: "queued", clothesImage: images[Math.floor(index / Math.max(tasks.length * config.variants, 1))] || images[0], aspectRatio: task?.aspectRatio || config.aspectRatio, snapshot: { task } };
      }));
      setSelectedId(data.tryonId); setJob({ batchId: data.batchJobId }); setQuote(null); setTab("output");
      localStorage.setItem(`modelshot-job:${userId}`, data.batchJobId);
      window.history.replaceState(null, "", `${window.location.pathname}?batch=${encodeURIComponent(data.batchJobId)}`);
      await loadAccount(); await update();
    } catch (err) { fail(err); } finally { requestLock.current = false; setSubmitting(false); }
  }
  async function save(copy = false) {
    if (!userId) { login(); return; }
    try {
      const row = await api("/api/drafts", { method: "POST", body: { ...(!copy && draft ? draft : {}), name: config.name || config.sku || f("newDraft"), projectId: config.projectId || null, config: payload() } });
      setDraft({ id: row.id, version: row.version }); setSaved(true); setDraftConflict(false); await loadAccount();
    } catch (err) { if (err.code === "DRAFT_VERSION_CONFLICT") setDraftConflict(true); fail(err); }
  }
  async function createProject(event) {
    event.preventDefault();
    try { const project = await api("/api/projects", { method: "POST", body: { name: projectName, sku: config.sku } }); change("projectId", project.id); setProjectDialog(false); setProjectName(""); await loadAccount(); } catch (err) { fail(err); }
  }
  async function cancelSelected() {
    try { const result = await api(`/api/jobs/${selectedId}/cancel`, { method: "POST" }); if (!result.cancelled) setError(f("cancelPending")); } catch (err) { fail(err); }
  }
  const count = workflowOutputCount(config.workflowId, batchMode ? images.length : 1, config.variants);
  const quota = Math.min(count, usage?.remaining || 0);
  const creditCost = (count - quota) * 18;
  const done = variants.filter(row => terminalStatus(row.status)).length;
  const selected = variants.find(row => row.id === selectedId);

  return <div className="studio-shell" data-mobile-tab={tab}>
    <div className="studio-heading"><div className="flex items-center gap-3"><Camera size={19} className="text-primary" /><h1>{t("title")}</h1></div><div className="flex items-center gap-3"><div className="mode-switch">{[false, true].map(mode => <button key={String(mode)} disabled={busy} aria-pressed={batchMode === mode} onClick={() => setBatchMode(mode)}>{ts(mode ? "batch" : "single")}</button>)}</div><Link className="studio-library-link" href="/gallery">{t("gallery")}<ArrowUpRight size={15} /></Link></div></div>
    <div className="workspace-context"><select disabled={busy} aria-label={f("project")} value={config.projectId || ""} onChange={e => change("projectId", e.target.value)}><option value="">{f("project")}</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button className="icon-button" title={f("newProject")} aria-label={f("newProject")} disabled={!userId || busy} onClick={() => setProjectDialog(true)}><Plus size={16} /></button><input disabled={busy} aria-label={f("sku")} placeholder="SKU" maxLength={80} value={config.sku} onChange={e => change("sku", e.target.value)} /><input disabled={busy} className="draft-name-input" aria-label={f("draftName")} placeholder={f("draftName")} maxLength={100} value={config.name} onChange={e => change("name", e.target.value)} /><button className="icon-button" title={f(saved ? "saved" : "saveDraft")} aria-label={f(saved ? "saved" : "saveDraft")} disabled={uploading || submitting} onClick={() => save(draftConflict)}><Save size={17} /></button><button className="icon-button" title={f("newDraft")} aria-label={f("newDraft")} disabled={busy} onClick={() => { setConfig(sanitizeConfig({ ...defaults, modelPresetId: models[0]?.id || "" }, providers[0])); setImages([]); setVariants([]); setDraft(null); setSaved(false); setDraftConflict(false); router.replace("/studio"); }}><Plus size={17} /></button><label className="draft-picker"><FolderOpen size={16} /><select aria-label={f("openDraft")} value="" disabled={busy} onChange={e => restoreDraft(e.target.value).catch(fail)}><option value="">{f("drafts")}</option>{drafts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{draftConflict && <button className="button compact" onClick={() => save(true)}>{f("saveCopy")}</button>}</div>
    <div className="mobile-workspace-tabs">{["assets", "settings", "output"].map(key => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{t(key)}</button>)}</div>
    <div className="studio-body"><AssetRail images={batchMode ? images : images.slice(0, 1)} referenceImages={config.referenceImages} batchMode={batchMode} busy={busy} uploading={uploading} onFiles={files => uploadFiles(files, "product")} onReferenceFiles={(files, role) => uploadFiles(files, "reference", role)} onRemove={index => setImages(value => value.filter((_, i) => i !== index))} onRemoveReference={index => change("referenceImages", config.referenceImages.filter((_, i) => i !== index))} />
      <main className="studio-center"><VariantCanvas variants={variants} selectedId={selectedId} onSelect={setSelectedId} garmentImage={images[0]} busy={!!job || submitting} onDownload={row => downloadImage(row.resultImage, `modelshot-${row.id}.png`).catch(fail)} />
        {selected && <div className="output-actions"><span>{f.has(selected.status) ? f(selected.status) : selected.status}</span>{selected.status === "failed" && selected.errorCode && <small className="output-error" role="alert" title={selected.errorCode}>{selected.errorCode}</small>}{!terminalStatus(selected.status) ? <button className="button compact" onClick={cancelSelected}><Ban size={14} />{f("cancelJob")}</button> : ["failed", "cancelled"].includes(selected.status) ? <Link className="button compact" href={`/studio?id=${selected.id}&retry=1`}>{f("retryFailed")}</Link> : <Link className="button compact" href={`/gallery?id=${selected.id}`}>{t("details")}</Link>}</div>}
        <div className="filmstrip-heading"><Images size={13} /><span>{t("history")}</span><span className="ml-auto tabular-nums">{variants.length ? t("generating", { done, total: variants.length }) : "00"}</span></div><Filmstrip items={variants.map(row => ({ id: row.id, image: row.resultImage, status: row.status }))} selectedId={selectedId} onSelect={setSelectedId} emptyLabel={t("noResult")} /></main>
      <ParamsPanel config={config} onChange={change} onPatch={patchConfig} models={models} scenes={scenes} providers={providers} loading={presetsLoading} error={presetsError} onRetry={loadPresets} batchMode={batchMode} images={images} disabled={busy} onModelFile={file => uploadFiles([file], "model")} />
    </div>
    {error && <div className="workspace-error" role="alert"><span>{error}</span><button className="icon-button" title={t("close")} aria-label={t("close")} onClick={() => setError("")}><X size={15} /></button></div>}
    <footer className="generation-bar"><div className="cost-summary"><span>{f("outputCount", { count })}</span><strong>{`${quota} ${f("quota")} + ${creditCost} ${f("credits")}`}</strong>{usage && <small>{f("available")}: {usage.remaining} / {usage.credits} {f("credits")}</small>}</div><button className="button primary generate-button" disabled={busy || status === "loading" || !!userId && (!providers.length || !images.length || count > 100)} onClick={getQuote}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}<span>{job ? t("generating", { done, total: variants.length || count }) : uploading ? ts("uploading") : !userId ? t("loginGenerate") : f("quoteAction")}</span></button></footer>
    {quote && <Modal label={f("quote")} onClose={() => { if (!submitting) setQuote(null); }}><h2>{f("quote")}</h2><p className="quote-workflow">{ts(`workflow.${quote.snapshot.workflow.id}.name`)}</p><ol className="quote-plan">{quote.snapshot.tasks.map(task => <li key={`${task.id}-${task.sequence}`}><span>{ts.has(`shots.${task.id}`) ? ts(`shots.${task.id}`) : task.title}</span><small>{task.aspectRatio}</small></li>)}</ol><dl className="quote-details"><div><dt>{f("outputCount", { count: quote.pricing.count })}</dt><dd>{quote.snapshot.model}</dd></div><div><dt>{f("quota")}</dt><dd>{quote.pricing.quotaCount}</dd></div><div><dt>{f("credits")}</dt><dd>{quote.pricing.credits}</dd></div><div><dt>{f("workflow")}</dt><dd>{WORKFLOWS.find(row => row.id === quote.snapshot.workflow.id)?.plan.length || quote.snapshot.tasks.length} {f("deliverables")}</dd></div></dl><p>{f("deliveryPolicy")}</p><p>{f("quoteExpiry", { time: new Date(quote.expiresAt).toLocaleTimeString() })}</p><div className="dialog-actions"><button className="button" disabled={submitting} onClick={() => setQuote(null)}>{f("cancel")}</button><button className="button primary" disabled={submitting} onClick={confirmQuote}>{submitting && <LoaderCircle size={16} className="animate-spin" />}{f("confirm")}</button></div></Modal>}
    {projectDialog && <Modal label={f("newProject")} onClose={() => setProjectDialog(false)}><form onSubmit={createProject}><h2>{f("newProject")}</h2><label htmlFor="project-name">{f("projectName")}</label><input id="project-name" required maxLength={100} value={projectName} onChange={e => setProjectName(e.target.value)} /><div className="dialog-actions"><button type="button" className="button" onClick={() => setProjectDialog(false)}>{f("cancel")}</button><button className="button primary">{f("save")}</button></div></form></Modal>}
  </div>;
}
