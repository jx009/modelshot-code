"use client";

import { useEffect, useState } from "react";
import { Cloud, Database, ShieldCheck, Save, PlugZap, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";

const fieldClass = "w-full min-w-0 rounded-xl border border-divider bg-bg-page px-3 py-2.5 text-sm text-primary-text disabled:opacity-60";
const messages = {
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
    const timer = setTimeout(() => { image.src = ""; reject(new Error("浏览器读取超时，请检查 COS 跨域规则和网络。")); }, 10000);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); ctx.getImageData(0, 0, 1, 1);
        resolve();
      } catch { reject(new Error("图片可访问，但画布跨域校验失败，请检查 CORS。")); }
    };
    image.onerror = () => { clearTimeout(timer); reject(new Error("服务器读写成功；浏览器读取失败，请检查 COS 跨域规则或防盗链设置。")); };
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
    setConfig({ ...values, secretId: "", secretKey: "" });
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
      else { await browserProbe(data.probeUrl); setTest("私有桶检查、上传、读取、删除和浏览器画布跨域检查全部通过。测试不保存配置，请点击保存。"); }
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  }
  if (!config) return <p role={error ? "alert" : "status"} className="text-secondary-text">{error || "正在加载云存储配置…"}</p>;
  return <div className="max-w-5xl space-y-6">
    {reasonPrompt.dialog}
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-lg font-semibold">云存储与图片加速</h1><p className="mt-2 text-xs leading-6 text-secondary-text">原图与预览图在腾讯 COS 长期保存，美国原库存储保留备份。仅 ROOT 可修改配置。</p></div>
      <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">已同步 {info.mirrored} 张原图</span>
    </div>
    <section className="rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3 text-sm"><Database size={18} className="text-secondary-text" /><span>美国原库存储</span><ArrowRight size={14} className="text-muted" /><Cloud size={18} className="text-primary" /><span>腾讯 COS 长期图片存储</span><ArrowRight size={14} className="text-muted" /><span>用户浏览器</span></div>
      <p className="mt-4 text-xs leading-6 text-secondary-text">浏览器通过本站权限校验后直接读取 COS。新图与 320 / 640 / 1280 像素预览自动同步并长期保存，不再因时间到期重新回美国下载；旧图首次读取时按需同步。未同步或加载失败时自动回退原库并修复。</p>
    </section>
    <section className="space-y-5 rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-medium"><Cloud size={18} />腾讯云 COS</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} disabled={!info.canManage || Boolean(busy)} onChange={e => change("enabled", e.target.checked)} />启用 COS 长期存储与加速</label></div>
      <fieldset disabled={!info.canManage || Boolean(busy)} className="grid gap-5 sm:grid-cols-2">
        <Field label="存储桶名称（Bucket）" hint="复制完整桶名，必须包含末尾 APPID。"><input className={fieldClass} placeholder="letaidraw-1250000000" value={config.bucket} onChange={e => change("bucket", e.target.value)} /></Field>
        <Field label="所属地域（Region）" hint="香港填写 ap-hongkong；已有桶必须填写它的实际地域。"><input className={fieldClass} placeholder="ap-hongkong" value={config.region} onChange={e => change("region", e.target.value)} /></Field>
        <Field label="SecretId" hint={info.credentialsConfigured ? "凭据已配置。留空保留，更新时建议同时填写两项。" : "在腾讯云访问管理 CAM 中创建专用子用户密钥。"}><input className={fieldClass} type="password" autoComplete="new-password" value={config.secretId} onChange={e => change("secretId", e.target.value)} /></Field>
        <Field label="SecretKey" hint="仅在服务端使用，加密保存；不会返回到浏览器。"><input className={fieldClass} type="password" autoComplete="new-password" value={config.secretKey} onChange={e => change("secretKey", e.target.value)} /></Field>
        <Field label="专用目录前缀" hint="建议保留 letaidraw。更换桶或目录后旧副本不会自动搬迁或清除。"><input className={fieldClass} value={config.prefix} onChange={e => change("prefix", e.target.value)} /></Field>
        <Field label="签名链接有效期（秒）" hint="60–900 秒，默认 300 秒。仅访问链接过期，图片不会过期；再次访问会签发新链接。"><input className={fieldClass} type="number" min={60} max={900} step={1} value={config.signedUrlSeconds} onChange={e => change("signedUrlSeconds", Number(e.target.value))} /></Field>
      </fieldset>
      <p className="flex items-start gap-2 text-xs leading-6 text-secondary-text"><ShieldCheck size={16} className="mt-1 shrink-0 text-primary" />使用私有读写存储桶，保留所有权校验。关闭加速后仍可从原库读取图片；已签发链接在到期前仍然可用。</p>
      {error && <p role="alert" className="rounded-xl border border-error/25 bg-error/5 p-3 text-sm text-error">{error}</p>}
      {test && <p role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm text-primary">{test}</p>}
      <div className="flex flex-wrap gap-3"><button className="button compact" disabled={!info.canManage || Boolean(busy)} onClick={() => submit("test")}><PlugZap size={15} />{busy === "test" ? "正在检测读写与跨域…" : "测试连接与跨域"}</button><button className="button primary compact" disabled={!info.canManage || Boolean(busy)} onClick={() => submit("save")}><Save size={15} />{busy === "save" ? "保存中…" : "保存配置"}</button></div>
    </section>
    <section className="space-y-4 rounded-2xl border border-divider bg-bg-card p-5 sm:p-6">
      <h2 className="font-medium">首次配置</h2>
      <ol className="list-decimal space-y-3 pl-5 text-xs leading-6 text-secondary-text">
        <li>在腾讯 COS 控制台选择香港地域，新建「私有读写」存储桶；也可以使用已有私有桶。</li>
        <li>检查桶的生命周期规则：项目目录不要设置到期删除或转归档。图片持续保留，用户主动删除并完成回收站清理后才删除对应 COS 对象。</li>
        <li>在访问管理 CAM 创建专用子用户，授权本桶 ACL 读取与专用目录内对象的上传、读取、删除，再创建访问密钥。</li>
        <li>在桶的「安全管理 → 跨域访问 CORS」添加规则：来源 <code>*</code>，方法 GET、HEAD，允许 Headers <code>*</code>，暴露 Headers <code>ETag, Content-Length, Content-Range</code>，缓存 600 秒。私有对象仍必须携带签名才能读取。</li>
        <li>填写配置，先测试连接与跨域，再勾选启用并保存。刷新画布；旧图首次仍可能从美国加载，同步后走 COS。</li>
      </ol>
      <p className="text-xs leading-6 text-secondary-text">请确保美国 worker 已更新并运行。COS 加速图片传输，不会消除登录、页面与生成接口的跨洋耗时；存储和流量费用按腾讯云实际计费。</p>
    </section>
  </div>;
}
