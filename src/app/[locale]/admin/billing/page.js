"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, CreditCard, Save } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";
import { requestKey } from "@/lib/client-api";

const fieldClass = "w-full min-w-0 rounded-xl border border-divider bg-bg-page px-3 py-2 text-sm text-primary-text";
function Field({ label, children }) { return <label className="block space-y-1.5 text-xs text-secondary-text"><span>{label}</span>{children}</label>; }
export default function BillingSettings() {
  const reasonPrompt = useAdminReason();
  const [packages, setPackages] = useState([]);
  const [config, setConfig] = useState(null);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const response = await fetch("/api/admin/billing", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "加载失败");
    const values = Object.fromEntries(body.configs.map(c => [c.key, c.display || ""]));
    setKeyConfigured(body.configs.some(c => c.key === "epay_merchant_key" && c.source !== "none"));
    setConfig({ payments_enabled: ["true", "1"].includes(values.payments_enabled) ? "true" : "false", epay_enabled: ["true", "1"].includes(values.epay_enabled) ? "true" : "false", epay_gateway: values.epay_gateway, epay_merchant_id: values.epay_merchant_id, epay_merchant_key: "", payment_public_url: values.payment_public_url, epay_methods: (values.epay_methods || "alipay,wxpay").split(",") });
    setPackages(body.packages.map(p => ({ ...p, cny: (p.cnyMinor / 100).toFixed(2), usd: (p.usdMinor / 100).toFixed(2) })));
  }
  useEffect(() => { void Promise.resolve().then(load).catch(e => setError(e.message)); }, []);
  function updateConfig(key, value) { setConfig(c => ({ ...c, [key]: value })); }
  function updatePackage(id, key, value) { setPackages(rows => rows.map(p => p.id === id ? { ...p, [key]: value } : p)); }
  async function save() {
    const minor = value => {
      if (!/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) throw new Error("价格须大于 0，最多两位小数");
      const [whole, fraction = ""] = String(value).split(".");
      const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (result <= 0) throw new Error("价格须大于 0");
      return result;
    };
    let rows;
    try { rows = packages.map(({ cny, usd, ...p }) => ({ ...p, credits: Number(p.credits), cnyMinor: minor(cny), usdMinor: minor(usd) })); }
    catch (e) { toast.error(e.message); return; }
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/billing", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key }, body: JSON.stringify({ packages: rows, config, reason: approval.reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error === "FORBIDDEN" || response.status === 403 ? "仅 ROOT 可修改支付与套餐" : body.error || "保存失败");
      toast.success("套餐与支付配置已保存");
      await load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }
  if (!config) return <p className="text-secondary-text">{error || "正在加载充值配置…"}</p>;
  return <div className="space-y-6 max-w-6xl">
    {reasonPrompt.dialog}
    <div className="flex flex-wrap gap-4 justify-between items-start"><div><h1 className="text-lg font-semibold">充值与支付</h1><p className="text-xs text-secondary-text mt-2">固定积分，一次购买，永久有效。仅 ROOT 可保存配置。</p></div><button onClick={save} disabled={saving} className="button primary compact"><Save size={15} />{saving ? "保存中…" : "保存所有配置"}</button></div>
    <section className="rounded-2xl border border-divider bg-bg-card p-5 space-y-5">
      <h2 className="flex items-center gap-2 font-medium"><CreditCard size={17} />支付服务</h2>
      <div className="flex flex-wrap gap-6">{[["payments_enabled", "开放充值"], ["epay_enabled", "启用易支付"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config[key] === "true"} onChange={e => updateConfig(key, String(e.target.checked))} />{label}</label>)}</div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="易支付网关地址"><input className={fieldClass} placeholder="https://pay.example.com" value={config.epay_gateway} onChange={e => updateConfig("epay_gateway", e.target.value)} /></Field>
        <Field label="商户 ID（PID）"><input className={fieldClass} value={config.epay_merchant_id} onChange={e => updateConfig("epay_merchant_id", e.target.value)} /></Field>
        <Field label={`商户密钥（${keyConfigured ? "已配置，留空保留" : "未配置"}）`}><input className={fieldClass} type="password" autoComplete="new-password" value={config.epay_merchant_key} onChange={e => updateConfig("epay_merchant_key", e.target.value)} /></Field>
        <Field label="本站公网地址（用于支付回调）"><input className={fieldClass} placeholder="https://your-domain.com" value={config.payment_public_url} onChange={e => updateConfig("payment_public_url", e.target.value)} /></Field>
      </div>
      <div className="flex gap-6 flex-wrap">{[["alipay", "支付宝"], ["wxpay", "微信支付"], ["qqpay", "QQ 钱包"]].map(([id, name]) => <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.epay_methods.includes(id)} onChange={e => updateConfig("epay_methods", e.target.checked ? [...config.epay_methods, id] : config.epay_methods.filter(m => m !== id))} />{name}</label>)}</div>
      <p className="text-xs text-secondary-text leading-6">易支付用于人民币充值，复用 LetAiCodeWeb2 的 submit.php / MD5 签名协议。异步通知路径：<code>/api/payment/epay/callback</code>。美元充值可在「系统设置」配置 Stripe；本站地址必须能被支付平台访问。易支付退款请在网关后台操作，本站不提供自动退款。</p>
    </section>
    <div className="flex justify-between items-center"><h2 className="font-medium">积分套餐 <span className="text-xs text-secondary-text">{packages.length} / 12</span></h2><button className="button compact" disabled={packages.length >= 12} onClick={() => setPackages(rows => [...rows, { id: `pack_${requestKey().replaceAll("-", "").slice(0, 16)}`, name: "新套餐", nameEn: "New pack", description: "", descriptionEn: "", credits: 1000, cnyMinor: 100, usdMinor: 100, cny: "1.00", usd: "1.00", active: false, recommended: false, sort: rows.length }])}><Plus size={14} />添加套餐</button></div>
    <div className="grid lg:grid-cols-2 gap-4">{packages.map((p, index) => <section key={p.id} className="rounded-2xl border border-divider bg-bg-card p-5 space-y-4">
      <div className="flex justify-between items-center"><span className="text-xs text-secondary-text">套餐 {index + 1} · {p.id}</span><button className="icon-button" aria-label={`删除${p.name}`} disabled={packages.length <= 1} onClick={() => setPackages(rows => rows.filter(row => row.id !== p.id))}><Trash2 size={15} /></button></div>
      <div className="grid grid-cols-2 gap-3">{[["name", "中文名称"], ["nameEn", "英文名称"]].map(([key, label]) => <Field key={key} label={label}><input className={fieldClass} maxLength={key === "name" ? 40 : 60} value={p[key]} onChange={e => updatePackage(p.id, key, e.target.value)} /></Field>)}</div>
      <div className="grid grid-cols-3 gap-3">{[["credits", "积分数"], ["cny", "人民币（元）"], ["usd", "美元（$）"]].map(([key, label]) => <Field key={key} label={label}><input className={fieldClass} type="number" min={key === "credits" ? 1 : 0.01} step={key === "credits" ? 1 : 0.01} value={p[key]} onChange={e => updatePackage(p.id, key, e.target.value)} /></Field>)}</div>
      {[["description", "中文简介"], ["descriptionEn", "英文简介"]].map(([key, label]) => <Field key={key} label={label}><input className={fieldClass} maxLength={180} value={p[key]} onChange={e => updatePackage(p.id, key, e.target.value)} /></Field>)}
      <div className="flex flex-wrap items-center gap-5 text-xs">{[["active", "上架"], ["recommended", "推荐"]].map(([key, label]) => <label key={key} className="flex gap-2 items-center"><input type="checkbox" checked={p[key]} onChange={e => updatePackage(p.id, key, e.target.checked)} />{label}</label>)}<label className="flex gap-2 items-center">排序<input className={`${fieldClass} !w-16`} type="number" min="0" max="9999" value={p.sort} onChange={e => updatePackage(p.id, "sort", Number(e.target.value))} /></label></div>
    </section>)}</div>
  </div>;
}
