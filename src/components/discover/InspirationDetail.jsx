"use client";
import Image from "next/image";
import { useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, ArrowUpRight, Copy, Check } from "lucide-react";
import Link from "@/components/ui/NavigationLink";
import { inspirationImage, inspirationLabel, inspirationPrompt } from "@/lib/inspiration/gallery";
import CaseRecipe from "./CaseRecipe";

export default function InspirationDetail({ item }) {
  const zh = useLocale() === "zh", [copied, setCopied] = useState(false), [error, setError] = useState("");
  const prompt = inspirationPrompt(item, zh ? "zh" : "en");
  return <article className="ig-detail"><Link className="cr-back" href="/explore"><ArrowLeft size={16} />{zh ? "返回灵感发现" : "Back to inspiration"}</Link>
    <div className="ig-detail-grid"><div className="ig-full-image"><Image src={inspirationImage(item)} width={Number(item.size.split("x")[0])} height={Number(item.size.split("x")[1])} unoptimized={item.cover.type === "asset"} alt={item.title} priority sizes="(max-width: 900px) 100vw, 60vw" /><a href={inspirationImage(item)} target="_blank" rel="noreferrer">{zh ? "查看完整图片" : "View full image"}<ArrowUpRight size={14} /></a></div>
      <aside><span className="cr-overline">{inspirationLabel(item, zh)} / SELECTED WORK</span><h1>{zh ? item.title : item.titleEn || item.title}</h1><p className="ig-description">{zh ? item.description : item.descriptionEn || item.description}</p>
        <div className="ig-parameters"><span>{item.model || (zh ? "站内精选" : "Curated work")}</span><span>{item.size} · {item.quality}</span></div>
        <CaseRecipe item={item} zh={zh} />
        <section className="ig-prompt"><div><h2>{zh ? "完整提示词" : "Full prompt"}</h2><button onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); setError(""); } catch { setError(zh ? "请选中下方文本手动复制。" : "Select the text below to copy."); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? zh ? "已复制" : "Copied" : zh ? "复制" : "Copy"}</button></div><p>{prompt}</p>{error && <small role="status">{error}</small>}</section>
        <section className="ig-process"><h2>{zh ? "如何创作你的版本" : "Make your own version"}</h2><ol><li>{zh ? "使用配方，把完整提示词带入画布。" : "Load the full prompt into your canvas."}</li><li>{zh ? "替换主体、文案或色彩，保留你喜欢的构图与材质。" : "Replace the subject, copy or colors; keep the composition and materials you like."}</li><li>{zh ? "选择可用模型后生成；需要微调时再引用生成结果编辑。" : "Choose an available model and generate. Use the result as a reference for further edits."}</li></ol></section>
        {item.sourceUrl && <div className="ig-attribution"><a href={item.sourceUrl} target="_blank" rel="noreferrer">{zh ? "提示词灵感来源" : "Prompt inspiration"}<ArrowUpRight size={13} /></a><p>{item.sourceName} · {item.sourceAuthor} · {item.sourceLicense}{item.sourceLicense === "CC BY 4.0" && <> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">{zh ? "许可原文" : "License"}</a></>}{item.sourceLicense === "Apache-2.0" && <> · <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noreferrer">{zh ? "许可原文" : "License"}</a></>}</p><small>{zh ? "基于来源提示词改编，主题、构图或措辞已调整；此图为本站重新生成。" : "Adapted prompt with changes to subject, composition or wording. This image was newly generated for this site."}</small></div>}
      </aside></div>
  </article>;
}
