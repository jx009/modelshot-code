import { defineRouting } from "next-intl/routing";

/**
 * i18n 路由配置 — 加新语言只需在这里加 + messages/ 加文件
 */
export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "always", // /en/studio /zh/studio，SEO 需要
});
