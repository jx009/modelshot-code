import { z } from "zod";
import { getSiteConfig, getSiteConfigs } from "../../site-config.js";
import { AppError } from "../../http.js";

export const packageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(40), nameEn: z.string().trim().max(60).default(""),
  description: z.string().trim().max(180).default(""), descriptionEn: z.string().trim().max(180).default(""),
  credits: z.number().int().min(1).max(100_000_000),
  cnyMinor: z.number().int().min(1).max(100_000_000), usdMinor: z.number().int().min(1).max(100_000_000),
  active: z.boolean(), recommended: z.boolean(), sort: z.number().int().min(0).max(9999),
}).strict();
export const packagesSchema = z.array(packageSchema).min(1).max(12).refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
export const DEFAULT_PACKAGES = [
  { id: "basic", name: "灵感起步", nameEn: "Starter", credits: 1000, cnyMinor: 1990, usdMinor: 500, description: "给新灵感一次轻盈的开始", descriptionEn: "A little room for your next idea", active: true, recommended: false, sort: 0 },
  { id: "standard", name: "日常创作", nameEn: "Creator", credits: 3000, cnyMinor: 4900, usdMinor: 1500, description: "为持续的创作留足空间", descriptionEn: "Keep your creative rhythm going", active: true, recommended: true, sort: 1 },
  { id: "pro", name: "专业进阶", nameEn: "Professional", credits: 7000, cnyMinor: 9900, usdMinor: 3000, description: "从一张好图到一整套作品", descriptionEn: "From one great image to a complete collection", active: true, recommended: false, sort: 2 },
  { id: "business", name: "工作室之选", nameEn: "Studio", credits: 24000, cnyMinor: 29900, usdMinor: 9000, description: "让团队的好想法持续发生", descriptionEn: "More possibilities for ambitious teams", active: true, recommended: false, sort: 3 },
];

export async function getCreditPackages(db) {
  const raw = await getSiteConfig("credit_packages", db);
  if (!raw) return DEFAULT_PACKAGES;
  try { return packagesSchema.parse(JSON.parse(raw)); }
  catch { throw new AppError("INVALID_PACKAGE_CONFIGURATION", 503); }
}

export function localizePackage(row, locale) {
  const zh = ["zh", "cn", "zh-CN"].includes(locale);
  return { ...row, name: zh ? row.name : row.nameEn || row.name, description: zh ? row.description : row.descriptionEn || row.description,
    type: "credits", currency: zh ? "cny" : "usd", amountMinor: zh ? row.cnyMinor : row.usdMinor };
}

export function validateGateway(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch { throw new AppError("INVALID_PAYMENT_URL"); }
}

export async function getPaymentConfig(db) {
  const cfg = await getSiteConfigs(["payments_enabled", "epay_enabled", "epay_gateway", "epay_merchant_id", "epay_merchant_key", "epay_methods", "payment_public_url", "stripe_secret_key", "stripe_webhook_secret"], db);
  const enabled = ["1", "true"].includes(cfg.payments_enabled);
  const methods = (cfg.epay_methods || "alipay,wxpay").split(",").map(s => s.trim()).filter(s => ["alipay", "wxpay", "qqpay"].includes(s));
  return { enabled, gateway: cfg.epay_gateway, merchantId: cfg.epay_merchant_id, merchantKey: cfg.epay_merchant_key,
    publicUrl: cfg.payment_public_url || process.env.NEXTAUTH_URL,
    epayReady: enabled && ["1", "true"].includes(cfg.epay_enabled) && !!(cfg.epay_gateway && cfg.epay_merchant_id && cfg.epay_merchant_key && methods.length),
    stripeReady: enabled && !!(cfg.stripe_secret_key && cfg.stripe_webhook_secret), methods: [...new Set(methods)] };
}

export function paymentMethods(cfg, currency) {
  return [
    ...(currency === "cny" && cfg.epayReady ? cfg.methods.map(id => ({ id, provider: "epay" })) : []),
    ...(cfg.stripeReady ? [{ id: "stripe", provider: "stripe" }] : []),
  ];
}
