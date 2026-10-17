"use client";
import Image from "next/image";
import { previewUrl } from "@/lib/studio/image-url";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { api, requestKey } from "@/lib/client-api";
import { promptTitle } from "@/lib/studio/project-title";
import { scaleToFit } from "@/lib/studio/canvas-utils";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import Link from "@/components/ui/NavigationLink";
import { ArrowUp, ArrowUpRight, Search, Sparkles, MessageCircle, Zap, ShoppingBag, SlidersHorizontal, ImagePlus, WandSparkles, X, Type, LoaderCircle } from "lucide-react";
import { CASES, CATEGORIES } from "@/lib/commerce/catalog";
import ModelPicker from "@/components/ui/ModelPicker";
import CommerceLauncher from "./CommerceLauncher";
import CaseArtwork from "./CaseArtwork";

export function CaseCard({ item, zh }) {
  return <Link href={`/explore/${item.id}`} className={`cr-case cr-case-${item.theme} cr-case-${item.span}`} aria-label={zh ? item.title : item.en}><div className="cr-case-art"><CaseArtwork item={item} zh={zh} /><span className="cr-case-open"><ArrowUpRight size={18} /></span></div><div className="cr-case-caption"><div><h3>{zh ? item.title : item.en}</h3><p>{zh ? item.label : item.labelEn}</p></div><ArrowUpRight size={15} /></div></Link>;
}

export default function DiscoverHome({ explore = false }) {
  const zh = useLocale() === "zh", router = useRouter();
  const [mode, setMode] = useState("chat"), [prompt, setPrompt] = useState(""), [category, setCategory] = useState("all"), [query, setQuery] = useState("");
  const { status } = useSession(), uploadInput = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [commerceOpened, setCommerceOpened] = useState(false);
  const [attachments, setAttachments] = useState([]), [size, setSize] = useState("1024x1024"), [count, setCount] = useState(1), [fixed, setFixed] = useState(""), [fixedOpen, setFixedOpen] = useState(false);
  const pending = useRef(null), operation = useRef(false);
  const [resumeDocument, setResumeDocument] = useState(null);
  const [models, setModels] = useState([]), [provider, setProvider] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (status !== "authenticated" || explore) return;
    const abort = new AbortController();
    api("/api/studio/capabilities", { signal: abort.signal }).then(caps => { setModels(caps.imageModels); setProvider(current => current || caps.imageProvider || caps.imageModels[0]?.id || ""); }).catch(() => {}).finally(() => { if (!abort.signal.aborted) setModelsReady(true); });
    return () => abort.abort();
  }, [status, explore]);
  async function upload(files) {
    if (!files.length || operation.current) return;
    if (status !== "authenticated") { router.push("/login?callbackUrl=/"); return; }
    operation.current = true; setBusy(true); setError("");
    try {
      const layers = [...attachments];
      for (const file of Array.from(files).slice(0, 3 - attachments.length)) {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: form }), asset = await response.json();
        if (!response.ok) throw new Error(asset.code || "UPLOAD_FAILED");
        const size = scaleToFit(asset.width, asset.height, 480);
        layers.push({ id: requestKey(), assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x: layers.length * 530 + 90, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, visible: true, opacity: 1 });
      }
      setAttachments(layers);
    } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  }
  const visible = CASES.filter(c => (category === "all" || c.category === category) && `${c.title} ${c.en} ${c.label} ${c.labelEn} ${c.product}`.toLowerCase().includes(query.toLowerCase()));
  async function start() {
    if (operation.current) return;
    if (mode === "commerce") { router.push(`/commerce?brief=${encodeURIComponent(prompt)}`); return; }
    if (status !== "authenticated") { router.push(`/studio-v2?mode=${mode}&prompt=${encodeURIComponent(prompt)}&size=${size}&count=${count}&fixed=${encodeURIComponent(fixed)}`); return; }
    if (!prompt.trim() && !attachments.length) return;
    operation.current = true; setBusy(true); setError("");
    try {
      const text = [fixed, prompt].filter(Boolean).join("\n");
      if (text.length > 4000) throw new Error(zh ? "固定提示词与描述合计不能超过 4000 字" : "Combined prompt exceeds 4,000 characters");
      const model = models.find(m => m.id === provider);
      if (attachments.length > (model?.maxReferenceImages ?? 3)) throw new Error(zh ? "此模型不支持这些参考图，请更换模型" : "Choose a model supporting these references");
      const fingerprint = JSON.stringify({ text, size, count, provider, attachments });
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, createKey: requestKey(), keys: Array.from({ length: count }, () => requestKey()), index: 0 };
      const batch = pending.current;
      if (!batch.document) batch.document = await api("/api/studio/documents", { method: "POST", body: { createKey: batch.createKey, name: promptTitle(prompt || attachments[0]?.name || "Untitled"), nameSource: prompt.trim() ? "prompt" : "upload", content: { schemaVersion: 1, layers: attachments, messages: [], jobs: [], composer: { text: prompt, fixedPrompt: fixed, outputCount: count, size, referenceIds: attachments.map(l => l.id) } } } });
      setResumeDocument(batch.document.id);
      if (prompt.trim()) for (; batch.index < count; batch.index++) {
        const source = attachments[0];
        await api("/api/studio/jobs", { method: "POST", key: batch.keys[batch.index], body: { tool: source ? "edit" : "generate", documentId: batch.document.id, documentVersion: batch.document.version, ...(provider ? { provider } : {}), ...(source ? { assetId: source.assetId, targetId: source.id, referenceAssetIds: attachments.slice(1).map(l => l.assetId) } : {}), params: { prompt: text, size } } });
      }
      router.push(`/studio-v2?document=${batch.document.id}&mode=${mode}&provider=${encodeURIComponent(provider)}`);
    } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(false); }
  }
  const estimatedCost = (models.find(m => m.id === provider)?.creditCost ?? 18) * count;
  return <>{!explore ? <section className="cr-hero cr-creation-hero"><div className="cr-hero-content"><h1>{zh ? "让创意，从这里开始" : "What will you create today?"}</h1><p className="cr-hero-subtitle">{zh ? "描述想法，或添加图片继续创作" : "Describe your idea, or add an image to start creating"}</p><div className="cr-home-composer"><div className="cr-mode-tabs" role="tablist" aria-label={zh ? "创作模式" : "Creative mode"}>{[["chat", MessageCircle, "对话", "Chat"], ["quick", Zap, "快速", "Quick"], ["commerce", ShoppingBag, "电商套图 Agent", "Commerce Agent"]].map(([id, Icon, cn, en]) => <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); if (id === "commerce") setCommerceOpened(true); }}><Icon size={15} />{zh ? cn : en}{id === "commerce" && <span>NEW</span>}</button>)}</div>{commerceOpened && <div hidden={mode !== "commerce"}><CommerceLauncher initialDescription={prompt} /></div>}{mode !== "commerce" && <>{attachments.length > 0 && <div className="cr-attachments">{attachments.map((layer, i) => <div key={layer.id}><Image src={previewUrl(layer.assetId, 320)} unoptimized width={64} height={64} alt={layer.name} /><span>{i + 1} · {layer.name}</span><button disabled={busy} aria-label={`${zh ? "移除参考图" : "Remove reference "}${i + 1}`} onClick={() => setAttachments(rows => rows.filter(l => l.id !== layer.id))}><X size={14} /></button></div>)}</div>}{fixedOpen && <textarea className="cr-fixed-prompt" aria-label={zh ? "固定提示词" : "Fixed prompt"} value={fixed} maxLength={1600} onChange={e => setFixed(e.target.value)} placeholder={zh ? "每次创作都要保持的风格、品牌或要求…" : "Consistent style, brand and instructions…"} />}<textarea aria-label={zh ? "描述你的创意" : "Describe your idea"} value={prompt} maxLength={2400} onChange={e => setPrompt(e.target.value)} placeholder={mode === "commerce" ? zh ? "描述产品、卖点和想要的风格，下一步上传产品图与参考图…" : "Describe your product and art direction. Add product and style references next…" : zh ? "说说你的想法吧：一张有呼吸感的产品海报，一组电影感的画面…" : "An airy product poster, a cinematic scene… What will you create?"} /><div className="cr-composer-bottom"><button disabled={busy || attachments.length >= 3} onClick={() => uploadInput.current.click()} className="cr-upload-shortcut"><ImagePlus size={17} /><span>{zh ? "添加图片" : "Add image"}</span></button><ModelPicker models={models} value={provider} onChange={setProvider} zh={zh} disabled={busy} emptyLabel={status !== "authenticated" ? zh ? "登录后选择模型" : "Sign in to choose a model" : !modelsReady ? zh ? "正在加载模型…" : "Loading models…" : zh ? "暂无可用生图模型" : "No image model configured"} /><button className="cr-parameter" aria-label={zh ? "设置固定提示词" : "Set fixed prompt"} aria-pressed={fixedOpen} onClick={() => setFixedOpen(v => !v)}><Type size={16} /></button><select className="cr-parameter" aria-label={zh ? "图片比例" : "Aspect ratio"} value={size} onChange={e => setSize(e.target.value)} disabled={busy}><option value="1024x1024">1:1</option><option value="1024x1536">2:3</option><option value="1536x1024">3:2</option></select><select className="cr-parameter" aria-label={zh ? "生成张数" : "Image count"} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>{[1,2,3,4].map(n => <option key={n} value={n}>{n}{zh ? "张" : "×"}</option>)}</select><input hidden ref={uploadInput} aria-label={zh ? "上传参考图片" : "Upload reference images"} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files)} /><button disabled={busy} className="cr-send" aria-label={zh ? "开始创作" : "Start creating"} onClick={start} title={`${estimatedCost} ${zh ? "积分" : "credits"}`}>{busy ? <LoaderCircle size={22} className="ca-spin" /> : <ArrowUp size={22} />}</button></div><div className="cr-generation-note">{zh ? `一次生成 ${count} 张 · ${estimatedCost} 积分 · 原图与结果分别保存` : `${count} images · ${estimatedCost} credits · Originals preserved`}</div>{error && <p role="alert">{error}{resumeDocument && <Link href={`/studio-v2?document=${resumeDocument}`}>{zh ? "打开项目，查看已提交的任务" : "Open project to recover submitted tasks"}</Link>}</p>}</>}</div><div className="cr-quick-links">{[["quiet-living", "电商详情页", "Product stories"], ["botanical-light", "产品摄影", "Product photography"], ["red-motion", "创意海报", "Creative posters"]].map(([id, cn, en]) => <Link href={`/explore/${id}`} key={id}><WandSparkles size={13} />{zh ? cn : en}<ArrowUpRight size={12} /></Link>)}</div></div></section> : <section className="cr-explore-heading"><span className="cr-overline">THE INSPIRATION LIBRARY</span><h1>{zh ? "好作品，从灵感开始。" : "Good work starts with inspiration."}</h1><p>{zh ? "拆解一份创意，带走一种风格。把喜欢的案例，变成自己的作品。" : "Explore a composition. Borrow an approach. Make something of your own."}</p></section>}
    <section className="cr-inspiration"><div className="cr-section-heading"><div><h2><Sparkles size={19} />{zh ? "灵感发现" : "Discover inspiration"}<span>{zh ? "总有一种，打动你" : "Find your next direction"}</span></h2></div>{!explore && <Link href="/explore">{zh ? "探索全部" : "Explore all"}<ArrowUpRight size={15} /></Link>}</div><div className="cr-filter-bar"><div className="cr-categories" role="group" aria-label={zh ? "案例分类" : "Case categories"}>{CATEGORIES.map(([id, cn, en]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{zh ? cn : en}</button>)}</div><label className="cr-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={zh ? "搜索灵感" : "Search inspiration"} placeholder={zh ? "搜索灵感" : "Search inspiration"} /><SlidersHorizontal size={13} /></label></div><div className="cr-masonry">{visible.map(item => <CaseCard key={item.id} item={item} zh={zh} />)}</div>{!visible.length && <div className="cr-no-results">{zh ? "暂时没有匹配的案例，试试其他关键词。" : "No matching references. Try a different search."}<button onClick={() => { setQuery(""); setCategory("all"); }}>{zh ? "查看全部" : "Show all"}</button></div>}<p className="cr-source-note">{zh ? "摄影参考 × 版式研究 · 图片来自 Unsplash，案例不代表本产品的 AI 生成效果。" : "Photography × layout studies · Unsplash references, not AI output from this product."}</p></section></>;
}
