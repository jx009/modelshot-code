"use client";

import { cloneElement, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, X, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";
import { CHANNEL_PRESETS, channelScope, channelCapability } from "@/lib/studio/model-channels";
import { api } from "@/lib/client-api";
import { VIDEO_KINDS, VIDEO_PROTOCOLS, VIDEO_DURATIONS, videoModelOptions } from "@/lib/video/model-protocols";
import { GPTBEST_VIDEO_APIS, gptBestApi, validVideoParameters } from "@/lib/video/gptbest-catalog";

const providerError = error => ["PROVIDER_BASE_URL_INVALID", "PROVIDER_PROXY_NOT_ALLOWED"].includes(error?.message)
  ? "模型接口地址格式不正确：请填写完整的 http:// 或 https:// 地址，可包含端口和路径，不要附带用户名、密码、查询参数或 #。"
  : error?.message;

const emptyChannel = { scope: "public", kind: "openai", studioCapability: "image", imageMode: "both", displayName: "", model: "", apiKey: "", accessKeyId: "", secretAccessKey: "", baseURL: "", creditCost: 18, costPerImage: 0.08 };
const PURPOSE_LABELS = { image: "图像编辑", segment: "物体分割", split: "图层拆分", ocr: "OCR 文字识别", upscale: "图片超分" };
const providerCategory = provider => channelCapability(provider, provider.config) === "video" ? "video" : channelScope(provider, provider.config);
const videoSettings = (kind, options) => ({ videoDurations: options.durations, videoInputMode: options.inputMode,
  ...(kind === "gptbest" ? { videoApi: options.api, videoParameters: options.parameters } : {}),
  ...(kind === "zzshu" ? { videoReferenceMode: options.referenceMode || "reference_images" } : {}) });
function dedicatedPreset(purpose) {
  const { label, ...settings } = CHANNEL_PRESETS.find(p => p.studioCapability === purpose);
  return { ...emptyChannel, ...settings, displayName: label };
}

export default function AdminProviders() {
  const reasonPrompt = useAdminReason();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadController = useRef(null), mounted = useRef(false);
  const [savingId, setSavingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState({});
  const [category, setCategory] = useState("public");
  const [adding, setAdding] = useState(false);
  const [channel, setChannel] = useState(emptyChannel);

  const load = useCallback(async () => {
    if (!mounted.current) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setLoadError("");
    try {
      const data = await api("/api/admin/providers", { signal: controller.signal, timeoutMs: 15000 });
      if (!Array.isArray(data)) throw new Error("INVALID_PROVIDER_RESPONSE");
      if (!controller.signal.aborted && mounted.current) setProviders(data);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setLoadError(error.code === "REQUEST_TIMEOUT" ? "读取模型配置超时，请重试。" : "加载模型配置失败，请重试。");
    } finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("category");
      if (["public", "language", "tool"].includes(requested)) setCategory(requested);
      load();
      const purpose = new URLSearchParams(window.location.search).get("purpose");
      if (["ocr", "upscale"].includes(purpose)) { setCategory("tool"); setChannel(dedicatedPreset(purpose)); setAdding(true); }
    }, 0);
    return () => { mounted.current = false; clearTimeout(timer); loadController.current?.abort(); };
  }, [load]);

  const patch = async (id, data, note) => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/admin/providers", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key }, body: JSON.stringify({ id, ...data, reason: approval.reason }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.code || "SAVE_FAILED");
      toast.success(note || "配置已保存"); await load();
    } catch (error) { toast.error(providerError(error) || "保存失败"); }
    finally { setSavingId(null); }
  };

  const create = async event => {
    event.preventDefault();
    if (channel.kind === "gptbest" && !validVideoParameters(channel.videoParameters || {})) { toast.error("附加参数必须是有效的 JSON 对象，不能包含密钥。"); return; }
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSavingId("new");
    try {
      const res = await fetch("/api/admin/providers", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key }, body: JSON.stringify({ ...channel, creditCost: Number(channel.creditCost), costPerImage: Number(channel.costPerImage), reason: approval.reason }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.code || "CREATE_FAILED");
      setChannel(emptyChannel); setAdding(false); toast.success("模型已添加"); await load();
    } catch (error) { toast.error(providerError(error) || "新增失败"); }
    finally { setSavingId(null); }
  };

  const testConnection = async (id, mode = "image") => {
    const key = `${id}:${mode}`; setTestingId(key); setTestResult(value => ({ ...value, [key]: null }));
    try {
      const res = await fetch("/api/admin/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, mode }) });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setTestResult(value => ({ ...value, [key]: data }));
      if (data.ok) toast.success(`连接测试通过：${data.durationMs}ms`);
      else toast.error(data.error || data.code || "测试失败");
    } catch { toast.error("测试请求失败"); }
    finally { setTestingId(null); }
  };

  if (loading) return <div role="status" className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} />加载模型配置…</div>;
  if (loadError) return <div role="alert" className="space-y-3 py-10"><p>{loadError}</p><button type="button" className="px-4 py-2 rounded-[10px] border border-divider" onClick={load}>重新加载模型配置</button></div>;

  return <div className="space-y-5">
    {reasonPrompt.dialog}
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div><h1 className="text-base font-medium text-primary-text">模型配置</h1><p className="text-xs text-secondary-text mt-1 leading-relaxed max-w-4xl">生图模型供用户选择；后台大语言模型用于自动调用、反推提示词等场景。工具专用模型仅在后台绑定，不进入用户模型列表。测试会产生上游费用。</p></div>
      <button className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5" onClick={() => { setChannel(category === "video" ? dedicatedPreset("video") : { ...emptyChannel, scope: category, studioCapability: category === "language" ? "language" : "image", creditCost: category === "language" ? 1 : 18 }); setAdding(true); }}><Plus size={14} />新增模型</button>
    </div>

    <div className="flex flex-wrap gap-2" role="tablist" aria-label="模型分类">{[["public", "生图模型"], ["video", "视频模型"], ["language", "后台大语言模型"], ["tool", "工具专用模型"]].map(([id, label]) => <button key={id} role="tab" aria-selected={category === id} className={`px-4 py-2 rounded-[10px] text-sm border ${category === id ? "border-primary text-primary bg-primary-muted" : "border-divider text-secondary-text"}`} onClick={() => { setCategory(id); setAdding(false); }}>{label}</button>)}</div>
    <p className="text-xs text-secondary-text">{category === "video" ? "支持 GPT-Best 视频接口、吱吱鼠 Videos JSON、第三方 OpenAI Videos、方舟 / Seedance、百炼 / 万相兼容协议。按供应商文档选择协议，填写自定义 Base URL、API Key 和实际模型名；同一家供应商可配置多个模型。仅 Chat Completions 兼容不代表视频接口兼容。" : category === "public" ? "图片工作台、海报配图与演示文稿配图共用这里的生图模型。" : category === "language" ? "后台通用大语言模型负责规划和反推提示词。OCR 在工具专用模型中独立配置，不会替换这里的通用模型。" : "按用途独立配置图像编辑、物体分割、图层拆分、OCR 和超分；再进入“工具配置”选择对应模型与单次积分。OCR 支持火山方舟或 OpenAI 兼容接口，超分使用火山 AK/SK。"}</p>
    {category === "tool" && <div className="flex flex-wrap gap-2">{["ocr", "upscale"].map(purpose => <button key={purpose} type="button" className="h-9 px-4 rounded-[10px] border border-divider text-primary-text text-xs inline-flex items-center gap-1.5" onClick={() => { setChannel(dedicatedPreset(purpose)); setAdding(true); }}><Plus size={14} />新增{PURPOSE_LABELS[purpose]}配置</button>)}</div>}
    {adding && <form onSubmit={create} className="rounded-[16px] border border-primary/50 bg-primary-muted/20 p-5 space-y-4">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-medium text-primary-text">新增模型</h2><p className="text-[11px] text-secondary-text mt-1">凭据、地址和实际模型名只在服务端使用。</p></div><button type="button" className="text-secondary-text" onClick={() => setAdding(false)}><X size={16} /></button></div>
      {category !== "language" && <Field label="配置预设"><select defaultValue="" onChange={e => { const preset = CHANNEL_PRESETS[Number(e.target.value)]; if (preset) { const { label, ...settings } = preset; setChannel({ ...emptyChannel, ...settings, scope: category === "video" ? "public" : category, displayName: label }); } }}><option value="" disabled>选择供应商</option>{CHANNEL_PRESETS.map((preset, index) => (category !== "tool" || preset.kind !== "minimax") && (category === "video" ? preset.studioCapability === "video" : preset.studioCapability !== "video" && (category === "tool" || preset.studioCapability === "image" && preset.imageMode !== "edit")) && <option key={preset.label} value={index}>{preset.label}</option>)}</select></Field>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {category === "tool" && <Field label="用途"><select value={channel.studioCapability} onChange={e => {
          const purpose = e.target.value;
          if (["ocr", "upscale"].includes(purpose)) setChannel(dedicatedPreset(purpose));
          else setChannel({ ...emptyChannel, scope: "tool", studioCapability: purpose, ...(purpose === "segment" ? { kind: "volc-visual", model: "entity_seg", baseURL: "https://visual.volcengineapi.com" } : purpose === "split" ? { kind: "fal", model: "fal-ai/qwen-image-layered", baseURL: "https://fal.run" } : {}) });
        }}>{Object.entries(PURPOSE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>}
        {category === "video" ? <Field label="视频接口协议"><select value={channel.kind} onChange={event => { const kind = event.target.value; setChannel(value => ({ ...value, kind, baseURL: VIDEO_PROTOCOLS[kind].baseURL, videoReferenceMode: undefined, ...videoSettings(kind, videoModelOptions(kind)) })); }}>{VIDEO_KINDS.map(kind => <option key={kind} value={kind}>{VIDEO_PROTOCOLS[kind].label}</option>)}</select></Field> : <Field label="协议类型"><select disabled={channel.studioCapability === "upscale"} value={channel.kind} onChange={e => setChannel(value => ({ ...value, kind: e.target.value, imageMode: e.target.value === "minimax" ? "generate" : "both", studioCapability: value.studioCapability === "ocr" ? "ocr" : category === "language" ? "language" : ["fal", "volc-visual"].includes(e.target.value) ? "segment" : "image", model: e.target.value === "volc-visual" ? "entity_seg" : e.target.value === "minimax" ? "image-01" : "", baseURL: e.target.value === "dashscope" ? "https://dashscope.aliyuncs.com" : e.target.value === "volcengine" ? "https://ark.cn-beijing.volces.com/api/v3" : e.target.value === "minimax" ? "https://api.minimax.cn/v1" : e.target.value === "volc-visual" ? "https://visual.volcengineapi.com" : e.target.value === "fal" ? "https://fal.run" : value.studioCapability === "ocr" ? "https://api.openai.com/v1" : "" }))}><option value="openai">OpenAI 兼容</option>{channel.studioCapability !== "ocr" && <option value="dashscope">阿里百炼</option>}<option value="volcengine">火山方舟</option>{category === "public" && <option value="minimax">MiniMax 文生图</option>}{category === "tool" && channel.studioCapability !== "ocr" && <><option value="volc-visual">火山智能视觉</option><option value="fal">fal 托管推理</option></>}</select></Field>}
        <Field label="显示名称"><input required value={channel.displayName} maxLength={100} onChange={e => setChannel(value => ({ ...value, displayName: e.target.value }))} placeholder="例如：来塔绘梦 Pro" /></Field>
        <Field label={channel.studioCapability === "upscale" ? "超分算法（固定）" : channel.studioCapability === "ocr" ? "OCR 视觉模型 ID / Endpoint ID" : "模型名 / 火山 Endpoint ID"}><input required readOnly={channel.kind === "volc-visual"} value={channel.model} maxLength={128} onChange={e => setChannel(value => ({ ...value, model: e.target.value }))} placeholder={channel.studioCapability === "video" ? "供应商提供的实际视频模型 ID" : channel.studioCapability === "ocr" ? "填写支持读图的模型名或 Endpoint ID" : "例如：gpt-image-2"} /></Field>
        {channel.kind === "fal" && <Field label="专用服务"><select value={channel.studioCapability} onChange={e => setChannel(value => ({ ...value, studioCapability: e.target.value }))}><option value="segment">物体分割</option><option value="split">图层拆分</option></select></Field>}
        {channel.kind === "volc-visual" ? <><Field label="Access Key ID (AK)"><input required type="password" autoComplete="off" value={channel.accessKeyId} onChange={e => setChannel(value => ({ ...value, accessKeyId: e.target.value }))} /></Field><Field label="Secret Access Key (SK)"><input required type="password" autoComplete="off" value={channel.secretAccessKey} onChange={e => setChannel(value => ({ ...value, secretAccessKey: e.target.value }))} /></Field></> : <Field label="API Key"><input required type="password" value={channel.apiKey} maxLength={4096} onChange={e => setChannel(value => ({ ...value, apiKey: e.target.value }))} placeholder="sk-…" /></Field>}
        <Field label="Base URL"><input type="url" value={channel.baseURL} maxLength={500} onChange={e => setChannel(value => ({ ...value, baseURL: e.target.value }))} placeholder="支持 HTTP / HTTPS，留空使用官方地址" /></Field>
        <Field label="每次模型请求积分"><input disabled={["ocr", "upscale"].includes(channel.studioCapability)} type="number" min="0" max="100000" step="1" value={channel.creditCost} onChange={e => setChannel(value => ({ ...value, creditCost: e.target.value }))} /></Field>
      </div>
      {channel.kind === "minimax" && <MiniMaxNotice />}
      {["ocr", "upscale"].includes(channel.studioCapability) && <p className="text-xs text-secondary-text">{channel.studioCapability === "ocr" ? "支持火山方舟和 OpenAI 兼容 Chat Completions 接口。填写支持图片输入、JSON 输出的模型；兼容服务的 Base URL 填写 API 前缀（通常以 /v1 结尾）。此配置只用于 OCR。" : "原生 2× 超分 · CVProcess · cn-north-1。需开通图片超分权限，AK/SK 与方舟 API Key 不通用。"} 用户积分请在“工具配置”中设置。</p>}
      <button disabled={savingId === "new"} className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5">{savingId === "new" && <LoaderCircle size={12} className="animate-spin" />}保存新模型</button>
      {category === "video" && <VideoOptions kind={channel.kind} value={videoModelOptions(channel.kind, channel)} onChange={options => setChannel(current => ({ ...current, ...videoSettings(current.kind, options) }))} />}
    </form>}

    <div className="space-y-4">{providers.filter(provider => providerCategory(provider) === category && (!["gemini", "fashn"].includes(provider.kind) || provider.config.hasKey)).map(provider => <ProviderCard key={JSON.stringify(provider)} provider={provider} saving={savingId === provider.id} testingId={testingId} testResult={testResult} onPatch={patch} onTest={testConnection} />)}</div>
  </div>;
}

function Field({ label, children }) {
  return <label className="block text-xs text-secondary-text space-y-1"><span>{label}</span>{cloneElement(children, { className: `w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text focus:outline-none focus:border-primary/50 ${children.props.className || ""}` })}</label>;
}

function VideoOptions({ kind, value, onChange }) {
  const durations = kind === "openai" ? VIDEO_PROTOCOLS.openai.durations : VIDEO_DURATIONS;
  return <div className="space-y-3">
    {kind === "gptbest" && <><Field label="GPT-Best 视频接口"><select value={value.api} onChange={event => onChange({ ...value, api: event.target.value, durations: gptBestApi(event.target.value).durations || [5, 10], parameters: {} })}>{GPTBEST_VIDEO_APIS.map(api => <option key={api.id} value={api.id}>{api.label}</option>)}</select></Field><VideoParameterEditor key={value.api} value={value.parameters} onChange={parameters => onChange({ ...value, parameters })} /><p className="text-xs text-secondary-text">Base URL 填账号实际调用域名，不要填 Apifox 文档地址；路径由所选接口决定。分辨率、音效、模板等附加配置按该模型文档填写。文生 / 图生能力与允许时长请逐个模型设置。</p></>}
    <Field label="视频输入能力"><select value={value.inputMode} onChange={event => onChange({ ...value, inputMode: event.target.value })}><option value="text">文生视频 · 不接受参考图</option><option value="image">图生视频 · 必须提供图片</option><option value="both">文生 / 图生均支持</option></select></Field>
    {kind === "zzshu" && <><Field label="图片用途（按模型选择）"><select value={value.referenceMode} onChange={event => onChange({ ...value, referenceMode: event.target.value })}><option value="reference_images">参考图 · 参考 / 30图版模型</option><option value="first_frame">首帧 · 首尾帧模型</option></select></Field><p className="text-xs text-secondary-text">模型 ID 原样填写“可用渠道”中的名称。分辨率由模型名决定；默认 5 秒，其他时长请按模型说明勾选。支持文生、多图和视频 / 音频参考；首帧模式最多两张，按首帧、尾帧顺序传入。素材通过一小时有效的临时链接提供。</p></>}
    <fieldset className="flex flex-wrap items-center gap-3 text-xs text-secondary-text"><legend>允许时长（按供应商模型文档勾选）</legend>{durations.map(duration => <label key={duration}><input type="checkbox" checked={value.durations.includes(duration)} disabled={value.durations.length === 1 && value.durations.includes(duration)} onChange={event => onChange({ ...value, durations: event.target.checked ? [...value.durations, duration].sort((first, second) => first - second) : value.durations.filter(item => item !== duration) })} /> {duration} 秒</label>)}</fieldset>
    <p className="text-xs text-secondary-text">请填写视频 API 前缀，不是聊天接口地址。吱吱鼠使用 JSON，标准 OpenAI Videos 使用表单，两者都请求 /videos（通常前缀为 /v1）。方舟使用 /contents/generations/tasks，百炼使用 /services/aigc/video-generation/video-synthesis。请按供应商文档选择对应协议。</p>
  </div>;
}

function VideoParameterEditor({ value, onChange }) {
  const [draft, setDraft] = useState(() => typeof value === "string" ? value : JSON.stringify(value || {}, null, 2));
  const [invalid, setInvalid] = useState(false);
  return <><Field label="模型附加参数（JSON，可选）"><textarea rows={5} value={draft} onChange={event => {
    const text = event.target.value; setDraft(text);
    try { const parsed = JSON.parse(text || "{}"); const valid = validVideoParameters(parsed); setInvalid(!valid); onChange(valid ? parsed : text); }
    catch { setInvalid(true); onChange(text); }
  }} /></Field>{invalid && <p role="alert" className="text-xs text-red-500">请输入 JSON 对象，不要包含 API Key、认证头或密钥。</p>}</>;
}

function ProviderCard({ provider: p, saving, testingId, testResult, onPatch, onTest }) {
  const [apiKey, setApiKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [displayName, setDisplayName] = useState(p.displayName);
  const [baseURL, setBaseURL] = useState(p.config.baseURL || "");
  const [model, setModel] = useState(p.config.model || "");
  const scope = channelScope(p, p.config);
  const [selectedScope, setSelectedScope] = useState(scope);
  const [selectedCapability, setSelectedCapability] = useState(channelCapability(p, p.config));
  const [videoKind, setVideoKind] = useState(p.kind);
  const [videoOptions, setVideoOptions] = useState(() => videoModelOptions(p.kind, p.config));
  const [creditCost, setCreditCost] = useState(p.creditCost);
  const [costPerImage, setCost] = useState(p.costPerImage);
  const testMode = scope === "language" ? "planner" : "image", imageTest = testResult[`${p.id}:${testMode}`];
  const save = () => { if (videoKind === "gptbest" && !validVideoParameters(videoOptions?.parameters || {})) { toast.error("模型附加参数无效，请检查 JSON。"); return; } onPatch(p.id, { displayName: displayName.trim(), creditCost: Number(creditCost), costPerImage: Number(costPerImage), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}), ...(secretAccessKey.trim() ? { secretAccessKey: secretAccessKey.trim() } : {}), baseURL, model, scope: selectedScope, studioCapability: selectedCapability, ...(selectedCapability === "video" && videoOptions ? { kind: videoKind, ...videoSettings(videoKind, videoOptions) } : {}), ...(selectedScope === "language" ? { isPlanner: true } : p.isPlanner ? { isPlanner: false } : {}) }, "模型配置已保存"); setApiKey(""); setAccessKeyId(""); setSecretAccessKey(""); };

  return <div className={`rounded-[16px] border p-5 space-y-4 ${(p.config.studioDefault || p.isDefault) ? "border-primary/50 bg-primary-muted/20" : "border-divider bg-bg-card surface-lit"}`}>
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 flex-wrap"><span className="text-sm font-medium text-primary-text">{p.displayName}</span><span className="text-[10px] uppercase text-secondary-text border border-divider rounded px-1.5 py-0.5">{p.kind}</span>{p.isDefault && <Badge>电商默认</Badge>}{p.config.studioDefault && scope === "public" && <Badge>{selectedCapability === "video" ? "默认视频模型" : "默认生图模型"}</Badge>}{p.isPlanner && <Badge>后台自动调用</Badge>}<span className="text-xs text-secondary-text">{scope === "language" ? `${p.creditCost} 积分/次` : `$${p.costPerImage}/次`}</span></div>
      <div className="flex items-center gap-3 flex-wrap"><label className="flex items-center gap-1.5 text-xs text-secondary-text">优先级<input type="number" min={1} defaultValue={p.priority} onBlur={e => { const value = Number(e.target.value); if (value && value !== p.priority) onPatch(p.id, { priority: value }, "优先级已更新"); }} className="w-14" /></label>{scope === "public" && <button onClick={() => onPatch(p.id, { studioDefault: true })} disabled={p.config.studioDefault} className="text-xs text-secondary-text disabled:opacity-40">设为默认</button>}{scope === "language" && <button onClick={() => onPatch(p.id, { isPlanner: true })} disabled={p.isPlanner} className="text-xs text-secondary-text disabled:opacity-40">设为后台通用模型</button>}<button onClick={() => onPatch(p.id, { isActive: !p.isActive }, p.isActive ? "已停用" : "已启用")} className={`relative w-10 h-5.5 rounded-full ${p.isActive ? "bg-primary" : "bg-divider-strong"}`} aria-label={`启用 ${p.displayName}`} aria-pressed={p.isActive}><span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-bg-page transition-transform ${p.isActive ? "translate-x-[18px]" : "translate-x-0.5"}`} /></button></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="显示名称（模型映射名）"><input value={displayName} maxLength={100} onChange={e => setDisplayName(e.target.value)} placeholder="用户看到的名称" /></Field>
      <Field label={selectedCapability === "upscale" ? "超分算法（固定）" : selectedCapability === "ocr" ? "OCR 视觉模型 ID / Endpoint ID" : "模型名 / 火山 Endpoint ID"}><input readOnly={p.kind === "volc-visual"} value={model} maxLength={128} onChange={e => setModel(e.target.value)} placeholder={selectedCapability === "video" ? "供应商提供的实际视频模型 ID" : selectedCapability === "ocr" ? "支持读图的模型名或 Endpoint ID" : "例如：gpt-image-2"} /></Field>
      <Field label="用途"><select value={["image", "language"].includes(selectedCapability) ? selectedScope : selectedCapability} onChange={e => {
        const purpose = e.target.value;
        setSelectedScope(purpose === "video" ? "public" : ["public", "language"].includes(purpose) ? purpose : "tool");
        setSelectedCapability(["public", "tool"].includes(purpose) ? "image" : purpose);
        if (purpose === "video" && !videoOptions) setVideoOptions(videoModelOptions(p.kind));
        if (p.kind === "volc-visual") setModel(purpose === "upscale" ? "lens_vida_nnsr" : "entity_seg");
      }}>{VIDEO_KINDS.includes(p.kind) && <option value="video">视频生成 · 用户可选</option>}{p.kind === "minimax" && <option value="public">生图模型 · 用户可选</option>}{!["volc-visual", "fal", "minimax", "zzshu", "gptbest"].includes(p.kind) && <><option value="public">生图模型 · 用户可选</option><option value="language">后台通用大语言模型</option><option value="tool">图像编辑 · 工具专用</option></>}{["openai", "volcengine"].includes(p.kind) && <option value="ocr">OCR 文字识别 · 独立模型</option>}{["volc-visual", "fal"].includes(p.kind) && <option value="segment">物体分割</option>}{p.kind === "fal" && <option value="split">图层拆分</option>}{p.kind === "volc-visual" && <option value="upscale">图片超分 · 火山 2×</option>}</select></Field>
      {p.kind === "volc-visual" ? <><Field label={`Access Key ID (AK)${p.config.hasAccessKey ? " · 已配置" : ""}`}><input type="password" autoComplete="off" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} placeholder={p.config.hasAccessKey ? "留空不变更" : "填写 AK"} /></Field><Field label={`Secret Access Key (SK)${p.config.hasSecretKey ? " · 已配置" : ""}`}><input type="password" autoComplete="off" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} placeholder={p.config.hasSecretKey ? "留空不变更" : "填写 SK"} /></Field></> : <Field label={<>API Key {p.config.hasKey && <span className="text-success">（{p.config.keyMasked}）</span>}</>}><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={p.config.hasKey ? "留空不变更" : "sk-…"} /></Field>}
      <Field label="Base URL（对应协议地址）"><input type="url" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="支持 HTTP / HTTPS，留空使用官方地址" /></Field>
      <Field label="每次模型请求积分"><input disabled={["ocr", "upscale"].includes(selectedCapability)} type="number" min="0" max="100000" step="1" value={creditCost} onChange={e => setCreditCost(e.target.value)} /></Field>
      {scope !== "language" && <Field label="预估成本（美元/次）"><input type="number" min="0" step="0.001" value={costPerImage} onChange={e => setCost(e.target.value)} /></Field>}
    </div>
    {selectedCapability === "video" && videoOptions && <><Field label="视频接口协议"><select value={videoKind} onChange={event => { const kind = event.target.value; setVideoKind(kind); setVideoOptions(videoModelOptions(kind)); }}>{VIDEO_KINDS.map(kind => <option key={kind} value={kind}>{VIDEO_PROTOCOLS[kind].label}</option>)}</select></Field><VideoOptions kind={videoKind} value={videoOptions} onChange={setVideoOptions} /></>}
    {p.kind === "minimax" && <MiniMaxNotice />}
    {["ocr", "upscale"].includes(selectedCapability) && <p className="text-xs text-secondary-text">{selectedCapability === "ocr" ? "OCR 独立调用此视觉大模型；不会改变后台通用大模型。识别后返回文字与估算位置。" : "火山图片超分 · 原生 2× · 输入最大 5 MB，宽 50–2128、高 50–4064 像素。"} 用户扣费以“工具配置”的单次积分为准。</p>}
    <div className="flex items-center gap-3 flex-wrap"><button onClick={save} disabled={saving || !displayName.trim() || !model.trim()} className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5">{saving && <LoaderCircle size={12} className="animate-spin" />}保存配置</button>{selectedCapability !== "video" && <TestButton label="测试功能（产生上游费用）" busy={testingId === `${p.id}:${testMode}`} disabled={!p.isActive} result={imageTest} onClick={() => onTest(p.id, testMode)} />}</div>
  </div>;
}

function MiniMaxNotice() { return <p className="text-xs text-secondary-text">MiniMax 当前接入 image-01 文生图；不支持参考图或图像编辑。宽高各为 512–2048 像素、8 的倍数，提示词最多 1500 字符；不支持 4K。</p>; }
function Badge({ children }) { return <span className="text-xs font-medium text-primary bg-primary-muted border border-primary/30 rounded-full px-2 py-0.5">{children}</span>; }
function TestButton({ label, busy, disabled, result, onClick }) { return <><button onClick={onClick} disabled={busy || disabled} className="h-9 px-4 rounded-[10px] border border-divider text-primary-text text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Zap size={12} />}{label}</button>{result && <span className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.ok ? `✓ ${result.durationMs}ms` : `✗ ${result.error || result.code || "failed"}`}</span>}</>; }
