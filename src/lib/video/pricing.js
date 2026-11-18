import { z } from "zod";

/**
 * 视频计费：按秒 × 分辨率
 *   费用 = 该清晰度每秒积分 × 视频时长
 * 官方对同一模型的不同输出分辨率给出不同单价，所以每秒积分按清晰度分开填写；
 * 只填统一每秒积分时所有清晰度共用该价格。
 */

export const RESOLUTIONS = ["480p", "720p", "1080p", "4K"];

const credits = z.number().int().min(0).max(200000);

export const videoPricingSchema = z.object({
  creditPerSecond: credits.optional(), // 不分清晰度的每秒积分
  creditPerSecondByResolution: z.record(z.enum(RESOLUTIONS), credits).optional(), // 分清晰度的每秒积分，优先于上一项
}).strict().optional();

export function parseVideoPricing(config) {
  return videoPricingSchema.safeParse(config?.videoPricing).success ? config.videoPricing || null : null;
}

/** 该清晰度每秒的积分：分档价优先，其次统一每秒价。 */
export function perSecondCredits(pricing, resolution) {
  if (!pricing) return 0;
  const tiered = resolution ? pricing.creditPerSecondByResolution?.[resolution] : undefined;
  if (Number.isFinite(tiered)) return tiered;
  return pricing.creditPerSecond ?? 0;
}

/** 一次生成的积分：配了按秒价就乘时长，否则沿用通道的单次固定价。 */
export function videoJobCost(pricing, fallbackCost, duration, resolution) {
  const rate = perSecondCredits(pricing, resolution);
  if (rate > 0) return Math.round(rate * Math.max(1, Math.round(Number(duration) || 0)));
  return fallbackCost;
}

/** 可供用户选择的清晰度：只列出有价可算的档位。 */
export function pricedResolutions(pricing) {
  if (!pricing) return [];
  return RESOLUTIONS.filter(resolution => perSecondCredits(pricing, resolution) > 0);
}

/** 用户没有选择时使用的最低档清晰度，保证报价与扣费使用同一口径。 */
export function defaultResolution(pricing) {
  return pricedResolutions(pricing)[0];
}
