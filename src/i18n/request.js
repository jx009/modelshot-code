import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.js";

/**
 * 服务端取当前 locale 的文案配置
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale)) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
