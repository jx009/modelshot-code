"use client";
import AssetImage from "@/components/ui/AssetImage";

import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Upload, SlidersHorizontal, PersonStanding, Camera, Sun, X } from "lucide-react";

const poses = { standing: "poseStanding", walking: "poseWalking", three_quarter: "poseThreeQuarter", sitting: "poseSitting", leaning: "poseLeaning", closeup: "poseCloseup" };
const cameras = { eye_level: "camEyeLevel", low_angle: "camLowAngle", high_angle: "camHighAngle", full_body: "camFullBody" };
const lights = { soft: "lightSoft", natural: "lightNatural", editorial: "lightEditorial", golden: "lightGolden" };

export default function ParamsPanel({ config, onChange, models, scenes, providers = [], loading, error, onRetry, disabled, onModelFile }) {
  const t = useTranslations("studio");
  const tw = useTranslations("workspace");
  const f = useTranslations("flow");
  const provider = providers.find(row => row.id === config.provider);
  const locale = useLocale();
  const name = item => locale === "zh" ? item.name : item.nameEn || item.name;
  const select = (key, options) => <select id={`shot-${key}`} value={config[key]} onChange={e => onChange(key, e.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  return <aside className="params-panel"><div className="panel-heading"><span>{tw("settings")}</span><SlidersHorizontal size={15} /></div>
    <fieldset disabled={disabled} className="params-fields">
      <section className="parameter-section"><label htmlFor="shot-provider">{f("provider")}</label>{select("provider", providers.length ? providers.map(row => [row.id, row.label]) : [["", f("noProvider")]])}</section>
      <section className="parameter-section">
        <div className="section-heading"><span className="step-number">01</span><h2>{t("selectModel")}</h2></div>
        <div className="mode-switch w-full mb-4">{["preset", "custom"].map(mode => <button type="button" key={mode} aria-pressed={config.modelSource === mode} onClick={() => onChange("modelSource", mode)}>{t(mode === "preset" ? "presets" : "custom")}</button>)}</div>
        {config.modelSource === "preset" ? <>
          {loading ? <div className="model-loading" aria-label={tw("loading")}>{[1, 2, 3].map(n => <div key={n} />)}</div> : error ? <div className="inline-error"><p>{tw("presetsError")}</p><button type="button" className="button compact" onClick={onRetry}>{tw("retry")}</button></div> : models.length === 0 ? <p className="text-xs text-secondary-text py-3">{t("noPresets")}</p> : <div className="model-grid">{models.map(m => <button type="button" key={m.id} title={name(m)} className={`model-choice ${config.modelPresetId === m.id ? "selected" : ""}`} aria-pressed={config.modelPresetId === m.id} onClick={() => onChange("modelPresetId", m.id)}><AssetImage src={m.referenceImage} alt={name(m)} /><span>{name(m)}</span>{config.modelPresetId === m.id && <i><Check size={11} /></i>}</button>)}</div>}
        </> : <div className="custom-model">{config.personImage ? <><AssetImage src={config.personImage} alt={t("modelLabel")} /><button type="button" className="icon-button" title={tw("remove")} aria-label={tw("remove")} onClick={() => onChange("personImage", "")}><X size={15} /></button></> : <label><Upload size={21} /><span>{t("customUpload")}</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) onModelFile(file); e.target.value = ""; }} /></label>}</div>}
      </section>
      {provider?.controls.includes("scene") && <section className="parameter-section"><div className="section-heading"><span className="step-number">02</span><h2>{t("selectScene")}</h2></div>
        <label className="sr-only" htmlFor="shot-scenePresetId">{t("selectScene")}</label>{select("scenePresetId", [["", t("sceneDefault")], ...scenes.map(s => [s.id, name(s)])])}
      </section>}
      <section className="parameter-section"><div className="section-heading"><span className="step-number">03</span><h2>{t("groupOutput")}</h2></div>
        <div className="field-pair"><div><label htmlFor="shot-garmentType">{t("garmentType")}</label>{select("garmentType", (provider?.garments || ["top", "dress", "bottom", "outerwear", "swimwear"]).map(g => [g, t(g)]))}</div>{provider?.controls.includes("prompt") && <div><label htmlFor="shot-platformSpec">{t("platform")}</label>{select("platformSpec", [["", t("platformGeneral")], ["taobao", t("taobao")], ["amazon", "Amazon"], ["tiktok", "TikTok Shop"], ["shein", "SHEIN"]])}</div>}</div>
        <label className="mt-4">{t("ratio")}</label><div className="ratio-options">{["3:4", "1:1", "9:16", "4:3", "16:9"].map(r => <button type="button" key={r} aria-label={`${t("ratio")} ${r}`} aria-pressed={config.aspectRatio === r} onClick={() => onChange("aspectRatio", r)}><span className="ratio-symbol"><i style={{ aspectRatio: r.replace(":", "/"), height: r === "16:9" || r === "4:3" ? 14 : 20 }} /></span><span>{r}</span></button>)}</div>
        <div className="flex items-center justify-between mt-4 gap-3"><label className="!mb-0">{t("variantsLabel")}</label><div className="mode-switch">{[1, 2, 4].map(n => <button type="button" key={n} aria-label={`${t("variantsLabel")} ${n}`} aria-pressed={config.variants === n} onClick={() => onChange("variants", n)}>{n}</button>)}</div></div>
      </section>
      <details className="parameter-details"><summary><span><SlidersHorizontal size={15} />{tw("advanced")}</span><ChevronDown size={15} /></summary><div className="details-body">
        {[["pose", poses, PersonStanding], ["camera", cameras, Camera], ["lighting", lights, Sun]].filter(([key]) => provider?.controls.includes(key)).map(([key, choices, Icon]) => <div key={key}><label htmlFor={`shot-${key}`}><Icon size={13} />{t(key)}</label>{select(key, [["", "-"], ...Object.entries(choices).map(([id, label]) => [id, t(label)])])}</div>)}
      </div></details>
      {provider?.controls.includes("prompt") && <details className="parameter-details"><summary><span>{tw("advancedPrompt")}</span><ChevronDown size={15} /></summary><div className="details-body"><label className="sr-only" htmlFor="shot-prompt">{tw("prompt")}</label><textarea id="shot-prompt" rows={5} maxLength={4000} value={config.prompt} onChange={e => onChange("prompt", e.target.value)} placeholder={t("advancedPlaceholder")} /></div></details>}
    </fieldset>
  </aside>;
}
