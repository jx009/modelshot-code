import Stripe from "stripe";
import { getSiteConfig } from "./site-config";

/**
 * Stripe 懒初始化（key 来源：DB SystemConfig > env；60s 缓存随 site-config）
 * 未配置时返回占位实例（调用会报错但不阻断构建——与原行为一致）
 */
let instance = null;
let instanceKey = null;

export async function getStripe() {
  const apiKey = (await getSiteConfig("stripe_secret_key")) || "sk_test_placeholder_key_for_build_purposes";
  if (!instance || instanceKey !== apiKey) {
    instance = new Stripe(apiKey, { apiVersion: "2023-10-16" });
    instanceKey = apiKey;
  }
  return instance;
}
