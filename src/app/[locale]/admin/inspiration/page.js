"use client";
import { uploadImage } from "@/lib/upload-image";
import Image from "next/image";
import { cloneElement, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ImagePlus, Images, Plus, Save, Search, Trash2, Upload, X } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import { gallerySchema, INSPIRATION_CATEGORIES, inspirationImage, inspirationPromptZh } from "@/lib/inspiration/gallery";
import { VIBRANT_ITEMS } from "@/lib/inspiration/vibrant-defaults";
import { IMAGE_SIZES } from "@/lib/studio/image-size";
import { useAdminReason } from "@/hooks/useAdminReason";
import Modal from "@/components/ui/Modal";
import InspirationCover from "@/components/discover/InspirationCover";
import "./inspiration-admin.css";

function previewImage(item) { return item.cover.type === "builtin" ? inspirationImage(item) : `/api/admin/assets/${encodeURIComponent(item.cover.assetId)}`; }
function generationSize(width, height) { return width > height * 1.2 ? "1536x1024" : height > width * 1.2 ? "1024x1536" : "1024x1024"; }
function Field({ label, children }) { return <label className="ig-admin-field"><span>{label}</span>{cloneElement(children, { "aria-label": label })}</label>; }
function GenerationPicker({ onSelect, onClose }) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/admin/tryons?status=completed&limit=18&page=${page}&q=${encodeURIComponent(search)}`, { signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, search, reload]);
  const results = (data?.tryons || []).flatMap(job => job.outputs.filter(a => a.id && a.contentType.startsWith("image/")).map(asset => ({ job, asset })));
  return <Modal label="从站内生成记录选图" onClose={onClose} className="ig-admin-picker">
    <header><div><h2>从站内生成记录选图</h2><p>选择生成结果，提示词和模型信息将一起带入待发布案例。</p></div><button type="button" onClick={onClose} aria-label="关闭选图"><X size={20} /></button></header>
    <div className="ig-picker-toolbar"><input aria-label="搜索站内生成图片" placeholder="搜索提示词、用户邮箱或任务 ID" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setLoading(true); setError(""); setSearch(query); setPage(1); setReload(v => v + 1); } }} /><button type="button" className="button compact" onClick={() => { setLoading(true); setError(""); setSearch(query); setPage(1); setReload(v => v + 1); }}><Search size={14} />搜索</button></div>
    <div className="ig-picker-body">{loading ? <p role="status">正在加载生成记录…</p> : error ? <p role="alert">{error}</p> : results.length ? <div className="ig-picker-results">{results.map(({ job, asset }) => <button key={`${job.id}-${asset.id}`} type="button" onClick={() => onSelect(job, asset)} aria-label={`选择图片 ${asset.id}`}><Image src={asset.url} width={240} height={240} unoptimized alt={asset.label || "生成结果"} /><strong>{job.userName || job.userEmail || "站内生成"}</strong><p>{job.userPrompt || job.prompt || "无提示词记录"}</p><span>{job.model || job.provider} · {asset.label}</span></button>)}</div> : <p>这一页没有可引用的图片，请更换关键词或翻页。仅展示已成功保存到本站的图片结果。</p>}</div>
    <footer><span>共 {data?.total || 0} 条生成任务 · 第 {page} 页</span><div><button type="button" className="button compact" disabled={loading || page <= 1} onClick={() => { setLoading(true); setPage(p => p - 1); }}>上一页</button><button type="button" className="button compact" disabled={loading || page * 18 >= (data?.total || 0)} onClick={() => { setLoading(true); setPage(p => p + 1); }}>下一页</button></div></footer>
  </Modal>;
}

export default function InspirationAdminPage() {
  const [gallery, setGallery] = useState(null), [version, setVersion] = useState(""), [selected, setSelected] = useState("");
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState(false), [replaceCover, setReplaceCover] = useState(false), [dirty, setDirty] = useState(false);
  const uploadRef = useRef(null), reasonPrompt = useAdminReason();
  async function load() {
    const data = await api("/api/admin/inspiration");
    applyLoaded(data);
  }
  function applyLoaded(data) {
    setGallery({ items: data.items.map(item => ({ ...item, promptZh: inspirationPromptZh(item) })), layout: data.layout, ...(data.catalogVersion ? { catalogVersion: data.catalogVersion } : {}) }); setVersion(data.version); setDirty(false);
    setSelected(id => data.items.some(i => i.id === id) ? id : data.items[0]?.id || "");
  }
  useEffect(() => {
    const abort = new AbortController();
    api("/api/admin/inspiration", { signal: abort.signal }).then(data => { if (!abort.signal.aborted) applyLoaded(data); }).catch(() => { if (!abort.signal.aborted) setError("无法加载灵感库，请检查管理员权限或重试。"); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const prevent = e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function edit(update) { setGallery(update); setDirty(true); setMessage(""); setError(""); }
  function update(field, value) { edit(g => ({ ...g, items: g.items.map(i => i.id === selected ? { ...i, [field]: value } : i) })); }
  function layout(field, value) { edit(g => ({ ...g, layout: { ...g.layout, [field]: value } })); }
  function move(index, to) { edit(g => { const items = [...g.items]; const [item] = items.splice(index, 1); items.splice(to, 0, item); return { ...g, items }; }); }
  function importVibrant() {
    const additions = VIBRANT_ITEMS.filter(item => !gallery.items.some(current => current.id === item.id || current.cover.type === "builtin" && current.cover.file === item.cover.file));
    if (gallery.items.length + additions.length > 200) { setError("图库最多 200 件，请先移除部分案例后再导入。" ); return; }
    if (!additions.length) { setMessage("这批案例已全部存在，已有内容和发布状态保持不变。" ); return; }
    edit(current => ({ ...current, items: [...additions, ...current.items], catalogVersion: 2 }));
    setSelected(additions[0].id);
    setMessage(`已添加 ${additions.length} 件新案例；检查预览后点击“保存并发布”，已有内容未修改。`);
  }
  function add(cover, info = {}) {
    const item = { id: requestKey(), title: info.title || "新的灵感作品", titleEn: "", category: "poster", description: "", descriptionEn: "", prompt: info.prompt || "", model: info.model || "", size: info.size || "1024x1024", quality: "medium", sourceUrl: "", sourceAuthor: "", sourceName: "", sourceLicense: "", cover, aspect: "original", position: 50, enabled: false };
    edit(g => ({ ...g, items: [item, ...g.items] })); setSelected(item.id);
  }
  async function choose(job, asset) {
    // Read the chosen bitmap itself; audit records may not include its dimensions.
    const bitmap = new window.Image();
    bitmap.src = asset.url;
    try { await bitmap.decode(); } catch { setError("图片暂时无法读取，请重新选择。"); setPicker(false); return; }
    const size = generationSize(bitmap.naturalWidth, bitmap.naturalHeight);
    const cover = { type: "asset", assetId: asset.id };
    if (replaceCover) edit(g => ({ ...g, items: g.items.map(i => i.id === selected ? { ...i, cover, size, generationSize: size } : i) }));
    else add(cover, { size, prompt: job.userPrompt || job.prompt, model: job.model, title: (job.userPrompt || job.prompt || "新的灵感作品").replace(/\s+/g, " ").slice(0, 24) });
    setPicker(false);
  }
  async function upload(file) {
    if (!file) return; setUploading(true); setError("");
    try {
      const data = await uploadImage(file);
      add({ type: "asset", assetId: data.assetId }, { size: generationSize(data.width, data.height), title: file.name.replace(/\.[^.]+$/, "").slice(0, 100) });
    } catch { setError("上传失败，请使用 PNG、JPEG 或 WebP 图片，并检查图片大小。" ); }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = ""; }
  }
  async function save(event) {
    event.preventDefault(); setError(""); setMessage("");
    const parsed = gallerySchema.safeParse(gallery);
    if (!parsed.success) { setError("请填写每个案例的标题和完整提示词，并检查来源链接。草稿也需要完整提示词。" ); return; }
    setSaving(true);
    try {
      const approval = await reasonPrompt.ask();
      await api("/api/admin/inspiration", { method: "PATCH", key: approval.key, body: { ...parsed.data, version, reason: approval.reason } });
      await load(); setMessage("灵感库已保存，首页与灵感发现会读取最新内容。");
    } catch (e) {
      setError(e.code === "INSPIRATION_CHANGED" ? "其他管理员已修改灵感库，请重新加载后编辑，避免覆盖他人的修改。" : e.code === "INSPIRATION_ASSET_UNAVAILABLE" ? "有引用图片已被删除或暂不可用，请替换对应封面后重试。" : "保存失败，请检查权限或稍后重试。" );
    } finally { setSaving(false); }
  }
  if (!gallery) return <div><p role={error ? "alert" : "status"}>{error || "正在加载灵感库…"}</p><button className="button compact" onClick={() => void load().catch(() => {})}>重新加载</button></div>;
  const current = gallery.items.find(i => i.id === selected), blocked = saving || uploading;
  return <form onSubmit={save} className="ig-admin">
    <header className="ig-admin-header"><div><span className="ig-admin-eyebrow">INSPIRATION / CURATION</span><h1><Images size={22} />灵感管理</h1><p>把值得收藏的作品，变成用户下一次创作的起点。</p></div><div><span className="ig-admin-state">{dirty ? "有未保存的修改" : "已同步"}</span><button className="button primary compact" disabled={blocked} type="submit"><Save size={15} />{saving ? "保存中…" : "保存并发布"}</button></div></header>
    {error && <p className="ig-admin-error" role="alert">{error}<button type="button" onClick={() => void load().then(() => setError("")).catch(() => setError("重新加载失败"))}>重新加载（丢弃修改）</button></p>}{message && <p className="ig-admin-success" role="status"><Check size={16} />{message}</p>}
    <fieldset disabled={blocked} className="ig-admin-settings"><div><strong>画廊布局</strong><small>{gallery.items.filter(i => i.enabled).length} 件已发布 · {gallery.items.length} 件作品</small></div><Field label="展示方式"><select value={gallery.layout.mode} onChange={e => layout("mode", e.target.value)}><option value="masonry">自然瀑布流 · 原图比例</option><option value="grid">等高网格 · 完整展示</option></select></Field><Field label="桌面密度"><select value={gallery.layout.columns} onChange={e => layout("columns", Number(e.target.value))}>{[3,4,5].map(v => <option key={v} value={v}>{v === 3 ? "疏朗" : v === 4 ? "适中" : "紧凑"}（{v}）</option>)}</select></Field><Field label={`图片间距 · ${gallery.layout.gap}px`}><input type="range" min={8} max={40} value={gallery.layout.gap} onChange={e => layout("gap", Number(e.target.value))} /></Field></fieldset>
    <fieldset disabled={blocked} className="ig-admin-editor"><section className="ig-admin-list"><div className="ig-admin-list-actions"><button type="button" className="button compact" disabled={gallery.items.length >= 200} onClick={() => { setReplaceCover(false); setPicker(true); }}><Plus size={15} />从生成记录新增</button><button type="button" className="button compact" disabled={gallery.items.length >= 200} onClick={() => uploadRef.current?.click()}><Upload size={14} />{uploading ? "上传中…" : "上传图片"}</button><button type="button" className="button compact" onClick={importVibrant}><Images size={14} />导入撞色设计精选</button><input type="file" hidden ref={uploadRef} accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files?.[0])} /></div>
      <div className="ig-admin-list-scroll">{gallery.items.map((item,index) => <div key={item.id} className={`ig-admin-row ${selected === item.id ? "active" : ""}`}><button type="button" className="ig-admin-select" onClick={() => setSelected(item.id)}><Image src={previewImage(item)} width={54} height={64} unoptimized alt="" /><div><strong>{item.title || "未命名作品"}</strong><small>{String(index + 1).padStart(2,"0")} · {item.enabled ? "已发布" : "草稿 / 已隐藏"}</small></div></button><div className="ig-admin-reorder"><button aria-label={`上移 ${item.title}`} type="button" disabled={index === 0} onClick={() => move(index,index-1)}><ArrowUp size={13} /></button><button aria-label={`下移 ${item.title}`} type="button" disabled={index === gallery.items.length-1} onClick={() => move(index,index+1)}><ArrowDown size={13} /></button></div></div>)}{!gallery.items.length && <p className="ig-admin-empty">还没有作品，从生成记录中挑选第一张吧。</p>}</div>
    </section>
    {current ? <section className="ig-admin-edit"><div className="ig-admin-edit-title"><h2>作品信息</h2><div><label><input type="checkbox" checked={current.enabled} onChange={e => update("enabled",e.target.checked)} />发布到前台</label><button type="button" aria-label="删除当前案例" onClick={() => { const next = gallery.items.find(i => i.id !== selected)?.id || ""; edit(g => ({ ...g, items: g.items.filter(i => i.id !== selected) })); setSelected(next); }}><Trash2 size={15} />删除</button></div></div>
      <div className="ig-admin-edit-grid"><div><InspirationCover item={current} src={previewImage(current)} className="ig-admin-cover" unoptimized /><button type="button" className="button compact ig-admin-replace" onClick={() => { setReplaceCover(true); setPicker(true); }}><ImagePlus size={14} />替换封面</button><p className="ig-admin-note">按图片真实比例完整展示。生成尺寸仅用于创作配方，不会改变封面构图。</p></div>
      <div className="ig-admin-fields"><Field label="作品标题"><input required maxLength={100} value={current.title} onChange={e => update("title",e.target.value)} /></Field><Field label="作品分类"><select value={current.category} onChange={e => update("category",e.target.value)}>{INSPIRATION_CATEGORIES.slice(1).map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></Field><Field label="创作说明"><textarea rows={3} maxLength={1000} value={current.description} onChange={e => update("description",e.target.value)} /></Field><Field label="生成模型"><input maxLength={150} value={current.model} onChange={e => update("model",e.target.value)} /></Field><div className="ig-admin-field-pair"><Field label="生成尺寸"><select value={current.generationSize || current.size} onChange={e => update("generationSize",e.target.value)}>{IMAGE_SIZES.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="生成质量"><select value={current.quality} onChange={e => update("quality",e.target.value)}>{["low","medium","high","auto"].map(v => <option key={v}>{v}</option>)}</select></Field></div></div></div>
      <Field label="完整提示词（会公开展示，用户可一键带入画布）"><textarea required rows={9} maxLength={4000} value={current.prompt} onChange={e => update("prompt",e.target.value)} /></Field>
      <Field label="中文提示词（中文页面展示、复制及带入画布）"><textarea rows={7} maxLength={4000} value={inspirationPromptZh(current)} onChange={e => update("promptZh",e.target.value)} placeholder="填写完整中文版本，保留构图、光影、材质及限制条件。原提示词已是中文时可留空。" /></Field>
      <details><summary>来源署名与英文信息</summary><div className="ig-admin-more">{[["sourceUrl","提示词来源链接",1000],["sourceName","来源项目",200],["sourceAuthor","原作者",200],["sourceLicense","来源许可",100],["titleEn","英文标题",150],["descriptionEn","英文说明",1500]].map(([key,label,max]) => <Field key={key} label={label}><input maxLength={max} value={current[key]} onChange={e => update(key,e.target.value)} /></Field>)}</div></details>
    </section> : <section className="ig-admin-empty">选择一件作品，或新增一张站内生成图。</section>}</fieldset>
    <section className="ig-admin-preview"><div><h2>画廊预览</h2><p>只展示已启用的作品。瀑布流保留原图比例，自然错落，不裁图、不强制底边对齐。</p></div><div className={`ig-admin-preview-grid ${gallery.layout.mode}`} style={{"--preview-columns":gallery.layout.columns,"--preview-gap":`${gallery.layout.gap}px`}}>{gallery.items.filter(i => i.enabled).map(i => <button type="button" key={i.id} onClick={() => setSelected(i.id)}><InspirationCover item={i} src={previewImage(i)} mode={gallery.layout.mode} unoptimized /></button>)}</div></section>
    <p className="ig-admin-note">新案例默认为草稿；发布前请检查提示词与图片内容。删除案例只移出灵感库，保留用户的原始图片。引用中的图片会保留，避免素材清理导致封面失效。最多 200 个案例。</p>
    {picker && <GenerationPicker onClose={() => setPicker(false)} onSelect={choose} />}
  </form>;
}
