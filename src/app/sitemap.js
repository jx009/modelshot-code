import { routing } from "@/i18n/routing";
import { CASES } from "@/lib/commerce/catalog";

/**
 * 多语言 sitemap — 全 locale × 页面组合
 */
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://modelshot.app";

const PATHS = ["", "/explore", ...CASES.map(item => `/explore/${item.id}`), "/commerce", "/studio-v2", "/projects", "/assets", "/pricing", "/login"];

export default function sitemap() {
  const entries = [];
  const now = new Date();

  for (const locale of routing.locales) {
    for (const path of PATHS) {
      entries.push({
        url: `${BASE_URL}/${locale}${path}`,
        lastModified: now,
        changeFrequency: path === "" ? "weekly" : "monthly",
        priority: path === "" ? 1.0 : 0.7,
      });
    }
  }
  return entries;
}
