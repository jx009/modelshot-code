"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bot, Check, ChevronDown, SendHorizontal, Upload, SlidersHorizontal, PersonStanding, Camera, Sun, X, Images, PackageCheck, Shirt, GalleryHorizontalEnd, PanelsTopLeft, Megaphone, ScanSearch, WandSparkles, Play } from "lucide-react";
import AssetImage from "@/components/ui/AssetImage";
import { conversationPrompt, planAgentTurn } from "@/lib/domain/generation/agent-planner";
import { WORKFLOWS, workflowNeedsModel } from "@/lib/domain/generation/workflow-catalog";

const poses = { standing: "poseStanding", walking: "poseWalking", three_quarter: "poseThreeQuarter", sitting: "poseSitting", leaning: "poseLeaning", closeup: "poseCloseup" };
const cameras = { eye_level: "camEyeLevel", low_angle: "camLowAngle", high_angle: "camHighAngle", full_body: "camFullBody" };
const lights = { soft: "lightSoft", natural: "lightNatural", editorial: "lightEditorial", golden: "lightGolden" };
const workflowIcons = { "commerce-suite": PackageCheck, "main-gallery": GalleryHorizontalEnd, "detail-page": PanelsTopLeft, "campaign-pack": Megaphone, "reference-remix": ScanSearch, "product-polish": WandSparkles, "sku-kit": PackageCheck, "model-set": Images, "single-shot": Shirt };
const categories = ["fashion", "beauty", "electronics", "food", "home", "jewelry", "sports", "other"];

export default function ParamsPanel({ config, onChange, onPatch, models, scenes, providers = [], loading, error, onRetry, disabled, onModelFile, images = [] }) {
  const t = useTranslations("studio");
  const tw = useTranslations("workspace");
  const f = useTranslations("flow");
  const provider = providers.find(row => row.id === config.provider);
  const needsModel = workflowNeedsModel(config.workflowId);
  const locale = useLocale();
  const name = item => locale === "zh" ? item.name : item.nameEn || item.name;
  const supportsWorkflow = id => !provider || provider.workflows === "all" || provider.workflows?.includes(id);
  const taskName = task => t.has(`shots.${task.id}`) ? t(`shots.${task.id}`) : task.title;
  const select = (key, options) => <select id={`shot-${key}`} value={config[key]} onChange={event => onChange(key, event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  const [brief, setBrief] = useState("");
  const [lastPlan, setLastPlan] = useState(null);
  const selectedWorkflow = WORKFLOWS.find(row => row.id === config.workflowId) || WORKFLOWS[0];
  const submitBrief = text => {
    const value = text.trim();
    if (!value) return;
    const plan = planAgentTurn(value, { ...config, images });
    const briefHistory = [...(config.briefHistory || []), { text: value, workflowId: plan.workflowId }].slice(-12);
    onPatch({ workflowId: plan.workflowId, productCategory: plan.productCategory, platformSpec: plan.platformSpec, briefHistory, prompt: conversationPrompt(briefHistory) });
    setLastPlan(plan);
    setBrief("");
  };

  return <aside className="params-panel"><div className="panel-heading"><span>{tw("settings")}</span><SlidersHorizontal size={15} /></div>
    <fieldset disabled={disabled} className="params-fields">
      <section className="parameter-section brief-section">
        <div className="section-heading"><span className="step-number">01</span><h2>{t("briefTitle")}</h2></div>
        <p className="section-intro">{t("briefIntro")}</p>
        <div className="agent-conversation" role="log" aria-label={t("conversationLabel")}>
          <div className="agent-message"><i><Bot size={13} /></i><p>{t("agentWelcome")}</p></div>
          {(config.briefHistory || []).map((turn, index) => <div className="agent-turn" key={`${index}-${turn.text}`}><p className="user-message">{turn.text}</p><div className="agent-message"><i><Bot size={13} /></i><p>{t("agentPlanUpdated", { workflow: t(`workflow.${turn.workflowId}.name`), count: WORKFLOWS.find(row => row.id === turn.workflowId)?.plan.length || 1 })}</p></div></div>)}
          {lastPlan && <div className="agent-plan-feedback" role="status"><div className="agent-message"><i><Bot size={13} /></i><p>{lastPlan.ready ? t("agentReady", { count: lastPlan.estimatedOutputs }) : t("agentNeedsInfo", { count: lastPlan.estimatedOutputs })}</p></div>{lastPlan.clarifications.length > 0 && <ul>{lastPlan.clarifications.map(key => <li key={key}>{t(`clarifications.${key}`)}</li>)}</ul>}{lastPlan.estimatedOutputs > 4 && <><small>{t("previewHint", { count: lastPlan.estimatedOutputs, workflow: t(`workflow.${lastPlan.previewWorkflow}.name`) })}</small><button type="button" className="button compact agent-preview-button" onClick={() => onPatch({ workflowId: lastPlan.previewWorkflow, variants: 1 })}><Play size={13} />{t("usePreview")}</button></>}</div>}
        </div>
        <form className="agent-composer" onSubmit={event => { event.preventDefault(); submitBrief(brief); }}>
          <label className="sr-only" htmlFor="shot-agent-brief">{t("requestLabel")}</label><textarea id="shot-agent-brief" rows={3} maxLength={4000} value={brief} onChange={event => setBrief(event.target.value)} placeholder={t("requestPlaceholder")} />
          <button type="submit" className="icon-button" disabled={!brief.trim()} title={t("sendBrief")} aria-label={t("sendBrief")}><SendHorizontal size={16} /></button>
        </form>
        {!config.briefHistory?.length && <div className="agent-suggestions">{["launch", "detail", "campaign"].map(key => <button type="button" key={key} onClick={() => submitBrief(t(`suggestions.${key}`))}>{t(`suggestions.${key}`)}</button>)}</div>}
        <label htmlFor="shot-productName">{t("productName")}</label><input id="shot-productName" maxLength={160} value={config.productName} onChange={event => onChange("productName", event.target.value)} placeholder={t("productNamePlaceholder")} />
        <div className="field-pair"><div><label htmlFor="shot-productCategory">{t("productCategory")}</label>{select("productCategory", categories.filter(category => !provider || provider.productCategories?.includes(category)).map(category => [category, t(`categories.${category}`)]))}</div><div><label htmlFor="shot-platformSpec">{t("platform")}</label>{select("platformSpec", [["", t("platformGeneral")], ["taobao", t("taobao")], ["amazon", "Amazon"], ["tiktok", "TikTok Shop"], ["shein", "SHEIN"]])}</div></div>
        <label htmlFor="shot-brandStyle">{t("brandStyle")}</label><input id="shot-brandStyle" maxLength={1000} value={config.brandStyle} onChange={event => onChange("brandStyle", event.target.value)} placeholder={t("brandStylePlaceholder")} />
        <label htmlFor="shot-targetAudience">{t("targetAudience")}</label><input id="shot-targetAudience" maxLength={1000} value={config.targetAudience} onChange={event => onChange("targetAudience", event.target.value)} placeholder={t("targetAudiencePlaceholder")} />
      </section>
      <section className="parameter-section workflow-section">
        <div className="section-heading"><span className="step-number">02</span><h2>{t("workflowTitle")}</h2></div>
        <div className="agent-plan-summary"><Bot size={16} /><span><strong>{t(`workflow.${selectedWorkflow.id}.name`)}</strong><small>{t(`workflow.${selectedWorkflow.id}.description`)}</small></span><b>{selectedWorkflow.plan.length}</b></div>
        <div className="workflow-plan" aria-label={t("workflowPlan")}><span>{t("workflowPlan")}</span><ol>{selectedWorkflow.plan.map(task => <li key={task.id}>{taskName(task)} <small>{task.aspectRatio || config.aspectRatio}</small></li>)}</ol></div>
        <details className="workflow-picker"><summary>{t("adjustWorkflow")}<ChevronDown size={15} /></summary><div className="workflow-options">{WORKFLOWS.map(workflow => {
          const Icon = workflowIcons[workflow.id] || Images;
          return <button type="button" key={workflow.id} disabled={!supportsWorkflow(workflow.id)} aria-pressed={config.workflowId === workflow.id} onClick={() => onChange("workflowId", workflow.id)}><Icon size={16} /><span><strong>{t(`workflow.${workflow.id}.name`)}</strong><small>{t(`workflow.${workflow.id}.description`)}</small></span><b>{workflow.plan.length}</b></button>;
        })}</div></details>
      </section>
      <section className="parameter-section"><label htmlFor="shot-provider">{f("provider")}</label>{select("provider", providers.length ? providers.map(row => [row.id, row.label]) : [["", f("noProvider")]])}</section>
      {needsModel && <section className="parameter-section">
        <div className="section-heading"><span className="step-number">03</span><h2>{t("selectModel")}</h2></div>
        <div className="mode-switch w-full mb-4">{["preset", "custom"].map(mode => <button type="button" key={mode} aria-pressed={config.modelSource === mode} onClick={() => onChange("modelSource", mode)}>{t(mode === "preset" ? "presets" : "custom")}</button>)}</div>
        {config.modelSource === "preset" ? <>{loading ? <div className="model-loading" aria-label={tw("loading")}>{[1, 2, 3].map(n => <div key={n} />)}</div> : error ? <div className="inline-error"><p>{tw("presetsError")}</p><button type="button" className="button compact" onClick={onRetry}>{tw("retry")}</button></div> : models.length === 0 ? <p className="text-xs text-secondary-text py-3">{t("noPresets")}</p> : <div className="model-grid">{models.map(model => <button type="button" key={model.id} title={name(model)} className={`model-choice ${config.modelPresetId === model.id ? "selected" : ""}`} aria-pressed={config.modelPresetId === model.id} onClick={() => onChange("modelPresetId", model.id)}><AssetImage src={model.referenceImage} alt={name(model)} /><span>{name(model)}</span>{config.modelPresetId === model.id && <i><Check size={11} /></i>}</button>)}</div>}</> : <div className="custom-model">{config.personImage ? <><AssetImage src={config.personImage} alt={t("modelLabel")} /><button type="button" className="icon-button" title={tw("remove")} aria-label={tw("remove")} onClick={() => onChange("personImage", "")}><X size={15} /></button></> : <label><Upload size={21} /><span>{t("customUpload")}</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) onModelFile(file); event.target.value = ""; }} /></label>}</div>}
        <label className="mt-4" htmlFor="shot-garmentType">{t("garmentType")}</label>{select("garmentType", (provider?.garments || ["top", "dress", "bottom", "outerwear", "swimwear"]).map(value => [value, t(value)]))}
      </section>}
      {provider?.controls.includes("scene") && <section className="parameter-section"><div className="section-heading"><span className="step-number">{needsModel ? "04" : "03"}</span><h2>{t("selectScene")}</h2></div><label className="sr-only" htmlFor="shot-scenePresetId">{t("selectScene")}</label>{select("scenePresetId", [["", t("sceneDefault")], ...scenes.map(scene => [scene.id, name(scene)])])}</section>}
      <section className="parameter-section"><div className="section-heading"><span className="step-number">{needsModel ? "05" : "04"}</span><h2>{t("outputSettings")}</h2></div>
        <label className="mt-4">{t("ratio")}</label><div className="ratio-options">{["3:4", "1:1", "9:16", "4:3", "16:9"].map(ratio => <button type="button" key={ratio} aria-label={`${t("ratio")} ${ratio}`} aria-pressed={config.aspectRatio === ratio} onClick={() => onChange("aspectRatio", ratio)}><span className="ratio-symbol"><i style={{ aspectRatio: ratio.replace(":", "/"), height: ratio === "16:9" || ratio === "4:3" ? 14 : 20 }} /></span><span>{ratio}</span></button>)}</div>
        <div className="flex items-center justify-between mt-4 gap-3"><label className="!mb-0">{t("variantsLabel")}</label><div className="mode-switch">{[1, 2, 4].map(number => <button type="button" key={number} aria-label={`${t("variantsLabel")} ${number}`} aria-pressed={config.variants === number} onClick={() => onChange("variants", number)}>{number}</button>)}</div></div>
      </section>
      <details className="parameter-details"><summary><span><SlidersHorizontal size={15} />{t("verifiedFacts")}</span><ChevronDown size={15} /></summary><div className="details-body">
        <div><label htmlFor="shot-material">{t("materialFact")}</label><input id="shot-material" maxLength={1000} value={config.productFacts?.material || ""} onChange={event => onChange("productFacts", { ...config.productFacts, material: event.target.value })} placeholder={t("materialFactPlaceholder")} /></div>
        <div><label htmlFor="shot-feature">{t("featureFact")}</label><input id="shot-feature" maxLength={1000} value={config.productFacts?.feature || ""} onChange={event => onChange("productFacts", { ...config.productFacts, feature: event.target.value })} placeholder={t("featureFactPlaceholder")} /></div>
        <div><label htmlFor="shot-copyLanguage">{t("copyLanguage")}</label>{select("copyLanguage", [["zh", t("languageZh")], ["en", t("languageEn")]])}</div>
        <div><label htmlFor="shot-headline">{t("headline")}</label><input id="shot-headline" maxLength={160} value={config.headline} onChange={event => onChange("headline", event.target.value)} placeholder={t("headlinePlaceholder")} /></div>
        <div><label htmlFor="shot-subheadline">{t("subheadline")}</label><input id="shot-subheadline" maxLength={300} value={config.subheadline} onChange={event => onChange("subheadline", event.target.value)} placeholder={t("subheadlinePlaceholder")} /></div>
      </div></details>
      {needsModel && <details className="parameter-details"><summary><span><PersonStanding size={15} />{tw("advanced")}</span><ChevronDown size={15} /></summary><div className="details-body">{[["pose", poses, PersonStanding], ["camera", cameras, Camera], ["lighting", lights, Sun]].filter(([key]) => provider?.controls.includes(key)).map(([key, choices, Icon]) => <div key={key}><label htmlFor={`shot-${key}`}><Icon size={13} />{t(key)}</label>{select(key, [["", "-"], ...Object.entries(choices).map(([id, label]) => [id, t(label)])])}</div>)}</div></details>}
    </fieldset>
  </aside>;
}
