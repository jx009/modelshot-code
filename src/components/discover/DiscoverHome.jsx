"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { api, requestKey } from "@/lib/client-api";
import { promptTitle } from "@/lib/studio/project-title";
import { scaleToFit } from "@/lib/studio/canvas-utils";
import { useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ArrowUp, ArrowUpRight, Search, Sparkles, MessageCircle, Zap, ShoppingBag, SlidersHorizontal, ImagePlus, ChevronDown, WandSparkles } from "lucide-react";
import { CASES, CATEGORIES } from "@/lib/commerce/catalog";
import CreativeShell from "./CreativeShell";
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
  const [models, setModels] = useState([]), [provider, setProvider] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (status !== "authenticated") return;
    const abort = new AbortController();
    api("/api/studio/capabilities", { signal: abort.signal }).then(caps => { setModels(caps.imageModels); setProvider(current => current || caps.imageProvider || caps.imageModels[0]?.id || ""); }).catch(() => {}).finally(() => { if (!abort.signal.aborted) setModelsReady(true); });
    return () => abort.abort();
  }, [status]);
  async function upload(files) {
    if (!files.length || busy) return;
    if (status !== "authenticated") { router.push("/login?callbackUrl=/"); return; }
    setBusy(true); setError("");
    try {
      const layers = [];
      for (const file of Array.from(files).slice(0, 3)) {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/upload", { method: "POST", body: form }), asset = await response.json();
        if (!response.ok) throw new Error(asset.code || "UPLOAD_FAILED");
        const size = scaleToFit(asset.width, asset.height, 480);
        layers.push({ id: requestKey(), assetId: asset.assetId, type: "image", name: file.name.slice(0, 150), x: layers.length * 530 + 90, y: 100, ...size, pixelWidth: asset.width, pixelHeight: asset.height, rotation: 0, visible: true, opacity: 1 });
      }
      const document = await api("/api/studio/documents", { method: "POST", body: { createKey: requestKey(), name: promptTitle(files[0].name.replace(/\.[^.]+$/, "")), nameSource: "upload", content: { schemaVersion: 1, layers, messages: [], jobs: [], composer: { text: prompt, referenceIds: layers.map(layer => layer.id) } } } });
      router.push(`/studio-v2?document=${document.id}&mode=${mode}&provider=${encodeURIComponent(provider)}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  }
  const visible = CASES.filter(c => (category === "all" || c.category === category) && `${c.title} ${c.en} ${c.label} ${c.labelEn} ${c.product}`.toLowerCase().includes(query.toLowerCase()));
  function start() { if (mode === "commerce") router.push(`/commerce?brief=${encodeURIComponent(prompt)}`); else router.push(`/studio-v2?mode=${mode}&prompt=${encodeURIComponent(prompt)}&provider=${encodeURIComponent(provider)}`); }
  return <CreativeShell>{!explore ? <section className="cr-hero cr-creation-hero"><div className="cr-hero-content"><h1>{zh ? "让创意，从这里开始" : "What will you create today?"}</h1><p className="cr-hero-subtitle">{zh ? "描述想法，或添加图片继续创作" : "Describe your idea, or add an image to start creating"}</p><div className="cr-home-composer"><div className="cr-mode-tabs" role="tablist" aria-label={zh ? "创作模式" : "Creative mode"}>{[["chat", MessageCircle, "对话", "Chat"], ["quick", Zap, "快速", "Quick"], ["commerce", ShoppingBag, "电商套图 Agent", "Commerce Agent"]].map(([id, Icon, cn, en]) => <button key={id} role="tab" aria-selected={mode === id} onClick={() => { setMode(id); if (id === "commerce") setCommerceOpened(true); }}><Icon size={15} />{zh ? cn : en}{id === "commerce" && <span>NEW</span>}</button>)}</div>{commerceOpened && <div hidden={mode !== "commerce"}><CommerceLauncher initialDescription={prompt} /></div>}{mode !== "commerce" && <><textarea aria-label={zh ? "描述你的创意" : "Describe your idea"} value={prompt} maxLength={2400} onChange={e => setPrompt(e.target.value)} placeholder={mode === "commerce" ? zh ? "描述产品、卖点和想要的风格，下一步上传产品图与参考图…" : "Describe your product and art direction. Add product and style references next…" : zh ? "说说你的想法吧：一张有呼吸感的产品海报，一组电影感的画面…" : "An airy product poster, a cinematic scene… What will you create?"} /><div className="cr-composer-bottom"><button disabled={busy} onClick={() => uploadInput.current.click()} className="cr-upload-shortcut"><ImagePlus size={17} /><span>{zh ? "添加图片" : "Add image"}</span></button><label className="cr-model-label"><Sparkles size={13} /><select aria-label={zh ? "生图模型" : "Image model"} value={provider} onChange={e => setProvider(e.target.value)} disabled={!models.length}>{models.length ? models.map(model => <option key={model.id} value={model.id}>{model.label} · {model.creditCost} {zh ? "积分" : "credits"}</option>) : <option value="">{status !== "authenticated" ? zh ? "登录后选择模型" : "Sign in to choose a model" : !modelsReady ? zh ? "正在加载模型…" : "Loading models…" : zh ? "暂无可用生图模型" : "No image model configured"}</option>}</select><ChevronDown size={12} /></label><input hidden ref={uploadInput} aria-label={zh ? "上传参考图片" : "Upload reference images"} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files)} /><button disabled={busy} className="cr-send" aria-label={zh ? "开始创作" : "Start creating"} onClick={start}><ArrowUp size={22} /></button></div>{error && <p role="alert">{error}</p>}</>}</div><div className="cr-quick-links">{[["quiet-living", "电商详情页", "Product stories"], ["botanical-light", "产品摄影", "Product photography"], ["red-motion", "创意海报", "Creative posters"]].map(([id, cn, en]) => <Link href={`/explore/${id}`} key={id}><WandSparkles size={13} />{zh ? cn : en}<ArrowUpRight size={12} /></Link>)}</div></div></section> : <section className="cr-explore-heading"><span className="cr-overline">THE INSPIRATION LIBRARY</span><h1>{zh ? "好作品，从灵感开始。" : "Good work starts with inspiration."}</h1><p>{zh ? "拆解一份创意，带走一种风格。把喜欢的案例，变成自己的作品。" : "Explore a composition. Borrow an approach. Make something of your own."}</p></section>}
    <section className="cr-inspiration"><div className="cr-section-heading"><div><h2><Sparkles size={19} />{zh ? "灵感发现" : "Discover inspiration"}<span>{zh ? "总有一种，打动你" : "Find your next direction"}</span></h2></div>{!explore && <Link href="/explore">{zh ? "探索全部" : "Explore all"}<ArrowUpRight size={15} /></Link>}</div><div className="cr-filter-bar"><div className="cr-categories" role="group" aria-label={zh ? "案例分类" : "Case categories"}>{CATEGORIES.map(([id, cn, en]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{zh ? cn : en}</button>)}</div><label className="cr-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={zh ? "搜索灵感" : "Search inspiration"} placeholder={zh ? "搜索灵感" : "Search inspiration"} /><SlidersHorizontal size={13} /></label></div><div className="cr-masonry">{visible.map(item => <CaseCard key={item.id} item={item} zh={zh} />)}</div>{!visible.length && <div className="cr-no-results">{zh ? "暂时没有匹配的案例，试试其他关键词。" : "No matching references. Try a different search."}<button onClick={() => { setQuery(""); setCategory("all"); }}>{zh ? "查看全部" : "Show all"}</button></div>}<p className="cr-source-note">{zh ? "摄影参考 × 版式研究 · 图片来自 Unsplash，案例不代表本产品的 AI 生成效果。" : "Photography × layout studies · Unsplash references, not AI output from this product."}</p></section></CreativeShell>;
}
