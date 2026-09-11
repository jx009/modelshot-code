import Stripe from "stripe";
import { getSiteConfig } from "./site-config.js";

/**
 * Stripe 懒初始化（key 来源：DB SystemConfig > env；60s 缓存随 site-config）
 * 未配置时返回占位实例（调用会报错但不阻断构建——与原行为一致）
 */
let instance = null;
let instanceKey = null;

export async function getStripe() {
  const apiKey = await getSiteConfig("stripe_secret_key");
  if (!apiKey) throw new Error("Stripe is not configured");
  if (!instance || instanceKey !== apiKey) {
    instance = new Stripe(apiKey, { apiVersion: "2023-10-16", maxNetworkRetries: 0, timeout: 15_000 });
    instanceKey = apiKey;
  }
  return instance;
}
