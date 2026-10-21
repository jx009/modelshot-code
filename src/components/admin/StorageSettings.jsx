"use client";

import { useEffect, useState } from "react";
import { Cloud, Database, ShieldCheck, Save, PlugZap, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";
import { uploadCosObject } from "@/lib/cos-upload";
import { ASSET_CDN_ORIGIN } from "@/lib/asset-cdn";

const fieldClass = "w-full min-w-0 rounded-xl border border-divider bg-bg-page px-3 py-2.5 text-sm text-primary-text disabled:opacity-60";
const messages = {
  COS_PRIMARY_MIGRATION_REQUIRED: "已有原图直接存放在 COS，迁移原图前不能更换存储桶或地域；可继续更新密钥和其他设置。",
  COS_CREDENTIALS_REQUIRED: "请填写存储桶、SecretId 和 SecretKey。",
  COS_ACCESS_DENIED: "权限不足：请检查子账号对指定目录的上传、读取、删除权限，以及存储桶 ACL 读取权限。",
  COS_INVALID_SIGNATURE: "签名不匹配：请核对 SecretId 和 SecretKey 是否配套。",
  COS_INVALID_KEY: "SecretId 无效或已停用，请检查腾讯云访问密钥。",
  COS_BUCKET_NOT_FOUND: "找不到存储桶，请检查完整桶名和所属地域。",
  COS_BUCKET_PUBLIC: "存储桶允许公共访问，请先设置为私有读写。",
  COS_CLOCK_SKEW: "美国服务器时间偏差过大，请同步服务器时间后重试。",
  COS_CONNECTION_FAILED: "连接 COS 失败，请检查桶名、地域及美国服务器的出站网络。",
  COS_READ_MISMATCH: "上传后的文件内容校验失败。",
  INVALID_INPUT: "配置格式有误，请核对桶名、地域、目录前缀和链接有效期。",
};
function Field({ label, hint, children }) { return <label className="block space-y-2 text-xs text-secondary-text"><span>{label}</span>{children}{hint && <span className="block leading-5">{hint}</span>}</label>; }
async function responseBody(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 403 ? "仅 ROOT 可修改和测试云存储配置。" : messages[data.error] || "操作失败，请稍后重试。");
  return data;
}
function browserProbe(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ""; reject(new Error("浏览器读取超时，请检查 CDN 回源、跨域规则和网络。")); }, 10000);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); ctx.getImageData(0, 0, 1, 1);
        resolve();
      } catch { reject(new Error("图片可访问，但画布跨域校验失败，请检查 CORS。")); }
    };
    image.onerror = () => { clearTimeout(timer); reject(new Error("COS 读写成功；CDN 图片读取失败，请检查 CDN 域名、回源鉴权、跨域规则或防盗链设置。")); };
    image.src = url;
  });
}

export default function StorageSettings() {
  const reasonPrompt = useAdminReason();
  const [config, setConfig] = useState(null);
  const [info, setInfo] = useState({ canManage: false, mirrored: 0, credentialsConfigured: false, endpoint: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState(null);
  async function load() {
    const body = await responseBody(await fetch("/api/admin/storage", { cache: "no-store" }));
    const { credentialsConfigured, endpoint, ...values } = body.config;
    setInfo({ canManage: body.canManage, mirrored: body.mirrored, credentialsConfigured, endpoint });
    setConfig({ directUploadEnabled: false, ...values, secretId: "", secretKey: "" });
  }
  useEffect(() => { void Promise.resolve().then(load).catch(e => setError(e.message)); }, []);
  function change(key, value) { setConfig(current => ({ ...current, [key]: value })); setTest(null); }
  async function submit(mode) {
    const operation = await reasonPrompt.ask();
    if (!operation) return;
    setBusy(mode); setError("");
    if (mode === "test") setTest(null);
    try {
      const data = await responseBody(await fetch("/api/admin/storage", { method: mode === "save" ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: JSON.stringify({ config, reason: operation.reason }) }));
      if (mode === "save") { await load(); toast.success("云存储配置已保存，后台任务将在一分钟内读取新配置。"); }
      else {
        const direct = config.enabled && config.directUploadEnabled;
        if (direct) {
          if (!data.uploadProbe?.url || !data.uploadProbe?.bodyBase64) throw new Error("上传测试响应不完整，请更新服务后重新测试。");
          const bytes = Uint8Array.from(atob(data.uploadProbe.bodyBase64), value => value.charCodeAt(0));
          try { await uploadCosObject(data.uploadProbe.url, { headers: data.uploadProbe.headers, body: bytes, timeoutMs: 10000 }); }
          catch (cause) { throw new Error(`服务器读写检查通过，但浏览器 PUT 上传检查失败。${cause.message}`, { cause }); }
        }
        await browserProbe(data.probeUrl);
        setTest(direct ? "私有桶检查、服务器读写删除、浏览器 PUT 直传和画布跨域检查全部通过。测试不保存配置，请点击保存。" : "私有桶检查、服务器读写删除和画布跨域检查全部通过。当前未启用浏览器直传，无需浏览器 PUT 权限。测试不保存配置，请点击保存。");
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  if (!config) return <p role={error ? "alert" : "status"} className="text-secondary-text">{error || "正在加载云存储配置…"}</p>;
  return <div className="max-w-5xl space-y-6">
    {reasonPrompt.dialog}
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-lg font-semibold">云存储与图片加速</h1><p className="mt-2 text-xs leading-6 text-secondary-text">原图与预览图长期保存，上传方式可独立切换。仅 ROOT 可修改配置。</p></div>
      <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">已同步 {info.mirrored} 张原图</span>
    </div>
    <section className="rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3 text-sm"><Database size={18} className="text-secondary-text" /><span>用户上传 / 模型生成</span><ArrowRight size={14} className="text-muted" /><Cloud size={18} className="text-primary" /><span>腾讯 COS 长期图片存储</span><ArrowRight size={14} className="text-muted" /><span>用户浏览器</span></div>
      <p className="mt-4 text-xs leading-6 text-secondary-text">默认使用原来的服务器上传方式，无需浏览器 PUT 跨域权限。开启浏览器直传后，使用短期签名直接上传 COS，并保留 JPG / WebP / PNG 原格式。COS 长期存储、图片读取加速和旧图兼容由 COS 存储配置控制。</p>
    </section>
    <section className="space-y-5 rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-medium"><Cloud size={18} />腾讯云 COS</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} disabled={!info.canManage || Boolean(busy)} onChange={e => change("enabled", e.target.checked)} />启用 COS 长期存储与加速</label></div>
      <div className="rounded-xl border border-divider bg-bg-page p-4">
        <label className="flex items-center justify-between gap-4 text-sm font-medium"><span>浏览器直传 COS（PUT）</span><input type="checkbox" role="switch" checked={config.directUploadEnabled} disabled={!info.canManage || !config.enabled || Boolean(busy)} aria-describedby="cos-direct-upload-hint" onChange={e => change("directUploadEnabled", e.target.checked)} /></label>
        <p id="cos-direct-upload-hint" className="mt-2 text-xs leading-6 text-secondary-text">{config.enabled && config.directUploadEnabled ? "开启：浏览器直接上传腾讯 COS。请先在存储桶 CORS 中允许当前网站来源、PUT 方法和 Content-Type 请求头。" : "关闭：使用原来的服务器上传方式，无需给浏览器开放 COS PUT。图片读取加速继续按 COS 存储配置运行。"} 修改后点击「保存配置」生效。</p>
      </div>
      <fieldset disabled={!info.canManage || Boolean(busy)} className="grid gap-5 sm:grid-cols-2">
        <Field label="存储桶名称（Bucket）" hint="复制完整桶名，必须包含末尾 APPID。"><input className={fieldClass} placeholder="letaidraw-1250000000" value={config.bucket} onChange={e => change("bucket", e.target.value)} /></Field>
        <Field label="所属地域（Region）" hint="香港填写 ap-hongkong；已有桶必须填写它的实际地域。"><input className={fieldClass} placeholder="ap-hongkong" value={config.region} onChange={e => change("region", e.target.value)} /></Field>
        <Field label="SecretId" hint={info.credentialsConfigured ? "凭据已配置。留空保留，更新时建议同时填写两项。" : "在腾讯云访问管理 CAM 中创建专用子用户密钥。"}><input className={fieldClass} type="password" autoComplete="new-password" value={config.secretId} onChange={e => change("secretId", e.target.value)} /></Field>
        <Field label="SecretKey" hint="仅在服务端使用，加密保存；不会返回到浏览器。"><input className={fieldClass} type="password" autoComplete="new-password" value={config.secretKey} onChange={e => change("secretKey", e.target.value)} /></Field>
        <Field label="专用目录前缀" hint="建议保留 letaidraw。更换桶或目录后旧副本不会自动搬迁或清除。"><input className={fieldClass} value={config.prefix} onChange={e => change("prefix", e.target.value)} /></Field>
        <Field label="服务端读取签名有效期（秒）" hint="60–900 秒，仅用于服务端读取 COS。浏览图片使用固定 CDN 地址，不受此有效期影响。"><input className={fieldClass} type="number" min={60} max={900} step={1} value={config.signedUrlSeconds} onChange={e => change("signedUrlSeconds", Number(e.target.value))} /></Field>
      </fieldset>
      <p className="text-xs leading-6 text-secondary-text">图片 CDN：<code>{ASSET_CDN_ORIGIN}</code>。数据库保存对象路径，展示时拼接 CDN 域名，不保存临时签名地址。</p>
      <p className="flex items-start gap-2 text-xs leading-6 text-secondary-text"><ShieldCheck size={16} className="mt-1 shrink-0 text-primary" />COS 桶保持私有，通过 CDN 回源鉴权读取。接口仍校验用户权限，但 CDN 图片链接是公开的，任何拿到链接的人均可读取；退出登录或关闭加速不会撤销已有 CDN 链接。</p>
      {error && <p role="alert" className="rounded-xl border border-error/25 bg-error/5 p-3 text-sm text-error">{error}</p>}
      {test && <p role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm text-primary">{test}</p>}
      <div className="flex flex-wrap gap-3"><button className="button compact" disabled={!info.canManage || Boolean(busy)} onClick={() => submit("test")}><PlugZap size={15} />{busy === "test" ? "正在检测读写与跨域…" : "测试连接与跨域"}</button><button className="button primary compact" disabled={!info.canManage || Boolean(busy)} onClick={() => submit("save")}><Save size={15} />{busy === "save" ? "保存中…" : "保存配置"}</button></div>
    </section>
    <section className="space-y-4 rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <h2 className="font-medium">首次配置</h2>
      <ol className="list-decimal space-y-3 pl-5 text-xs leading-6 text-secondary-text">
        <li>在腾讯 COS 控制台选择中国内地或香港地域，新建「私有读写」存储桶；已有桶必须填写实际地域。</li>
        <li>检查桶的生命周期规则：项目目录不要设置到期删除或转归档。图片持续保留，用户主动删除并完成回收站清理后才删除对应 COS 对象。</li>
        <li>在访问管理 CAM 创建专用子用户，授权本桶 ACL 读取与专用目录内对象的上传、读取、复制和删除，再创建访问密钥。</li>
        <li>将 <code>{ASSET_CDN_ORIGIN}</code> 配置到当前 COS 桶，开启私有桶回源鉴权，保留对象完整路径；不要启用访问者 URL 签名鉴权。</li>
        <li>在 CDN 响应头配置允许本站来源的 CORS，支持 GET、HEAD，暴露 <code>ETag, Content-Length, Content-Range</code>，确保图片可在画布中读取。CDN 端缓存规则也需允许缓存图片。</li>
        <li>暂时无法添加 PUT 时，保持「浏览器直传 COS（PUT）」关闭。以后在 CORS 中补上 PUT 后，再打开开关、测试并保存，切换到浏览器直传。</li>
      </ol>
      <p className="text-xs leading-6 text-secondary-text">请确保美国 worker 已更新并运行。COS 加速图片传输，不会消除登录、页面与生成接口的跨洋耗时；存储和流量费用按腾讯云实际计费。</p>
    </section>
  </div>;
}
