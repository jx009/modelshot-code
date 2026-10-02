"use client";
import Image from "next/image";
import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import Link from "@/components/ui/NavigationLink";
import { ArrowUp, ImagePlus, LoaderCircle, X } from "lucide-react";
import { requestKey } from "@/lib/client-api";

export default function CommerceLauncher({ initialDescription = "" }) {
  const locale = useLocale(), zh = locale === "zh", router = useRouter(), { data: session, status } = useSession();
  const t = (cn, en) => zh ? cn : en;
  const [brief, setBrief] = useState({ product: "", brand: "", platform: "taobao", region: "CN", language: locale, description: initialDescription });
  const [assets, setAssets] = useState({ product: null, reference: null });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const files = useRef({}), lock = useRef(false);
  const change = (key, value) => setBrief(b => ({ ...b, [key]: value }));
  function stash() {
    const token = requestKey();
    sessionStorage.setItem(`commerce-start:${token}`, JSON.stringify({ owner: session?.user?.id || "guest", brief, ...assets }));
    return token;
  }
  function start(signIn = false) {
    try {
      const path = `/${locale}/commerce?draft=${stash()}`;
      router.push(signIn ? `/login?callbackUrl=${encodeURIComponent(path)}` : path.replace(`/${locale}`, ""));
    } catch { setNotice(t("浏览器无法保存资料，请打开电商工作台继续。", "Browser storage is unavailable. Open Commerce Studio to continue.")); }
  }
  async function upload(kind, file) {
    if (!file || lock.current) return;
    if (!session?.user) { setNotice(t("请先登录上传图片，商品资料会带入下一步。", "Sign in to upload images. Your brief carries over.")); return; }
    if (file.size > 10 * 1024 * 1024) { setNotice(t("图片不能超过 10 MB。", "Images must be under 10 MB.")); return; }
    lock.current = true; setBusy(true); setNotice("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body }); const asset = await response.json();
      if (!response.ok) throw new Error(asset.code || "UPLOAD_FAILED");
      setAssets(current => ({ ...current, [kind]: asset }));
    } catch (e) { setNotice(t("上传失败，请重试：", "Upload failed: ") + e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <fieldset disabled={busy || status === "loading"} className="cr-commerce-launcher">
    <div className="cr-home-images">{[["product", "商品图", "Product image"], ["reference", "风格参考图", "Style reference"]].map(([kind, cn, en]) => <div key={kind}>
      <button className="cr-home-image" aria-label={zh ? cn : en} onClick={() => session?.user ? files.current[kind]?.click() : setNotice(t("请先登录上传图片，商品资料会带入下一步。", "Sign in to upload images. Your brief carries over."))}>
        {assets[kind] ? <Image src={`/api/assets/${assets[kind].assetId}`} unoptimized fill sizes="110px" alt={zh ? cn : en} /> : <ImagePlus size={21} strokeWidth={1.2} />}
        <span>{zh ? cn : en}</span>
      </button>
      {assets[kind] && <button className="cr-home-remove" aria-label={t("移除", "Remove ") + (zh ? cn : en)} onClick={() => setAssets(a => ({ ...a, [kind]: null }))}><X size={12} /></button>}
      <input hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("上传", "Upload ") + (zh ? cn : en.toLowerCase())} ref={el => { files.current[kind] = el; }} onChange={e => { upload(kind, e.target.files[0]); e.target.value = ""; }} />
    </div>)}<p>{t("商品图决定产品外观", "Product image defines identity")}<br />{t("参考图决定视觉风格", "Reference guides the visual style")}</p></div>
    <div className="cr-home-fields"><label>{t("产品名称", "Product name")}<input value={brief.product} maxLength={80} onChange={e => change("product", e.target.value)} placeholder={t("例如：休闲椅", "e.g. Lounge chair")} /></label><label>{t("品牌名", "Brand")}<input value={brief.brand} maxLength={60} onChange={e => change("brand", e.target.value)} placeholder={t("可选", "Optional")} /></label></div>
    <div className="cr-home-fields three"><label>{t("目标平台", "Platform")}<select aria-label={t("目标平台", "Platform")} value={brief.platform} onChange={e => change("platform", e.target.value)}><option value="taobao">淘宝 / 天猫</option><option value="amazon">Amazon A+</option><option value="shopify">Shopify</option></select></label><label>{t("地区", "Region")}<select aria-label={t("地区", "Region")} value={brief.region} onChange={e => change("region", e.target.value)}><option value="CN">{t("中国", "China")}</option><option value="US">{t("美国", "US")}</option><option value="EU">{t("欧洲", "Europe")}</option></select></label><label>{t("文案语言", "Copy language")}<select aria-label={t("文案语言", "Copy language")} value={brief.language} onChange={e => change("language", e.target.value)}><option value="zh">中文</option><option value="en">English</option></select></label></div>
    <textarea aria-label={t("产品信息与创作要求", "Product facts & creative direction")} value={brief.description} maxLength={2400} onChange={e => change("description", e.target.value)} placeholder={t("描述产品、真实卖点与想要的风格，让 AI 帮你策划一整套商品视觉…", "Describe your product, verified features and art direction…")} />
    {notice && <div className="cr-home-notice" role="status">{notice}{!session?.user && <button onClick={() => start(true)}>{t("登录并继续", "Sign in & continue")}</button>}<Link href="/commerce">{t("打开工作台", "Open studio")}</Link></div>}
    <div className="cr-composer-bottom"><span className="cr-model-label">{t("看图理解 · 按需策划 · 对话修改", "Understand · Plan · Refine")}</span><button className="cr-send" aria-label={t("开始电商创作", "Start product story")} onClick={() => start()}>{busy ? <LoaderCircle size={19} /> : <ArrowUp size={22} />}</button></div>
  </fieldset>;
}
