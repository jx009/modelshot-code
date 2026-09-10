import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.js";

/**
 * locale 路由中间件：
 * - / → 按 Accept-Language 重定向到 /en 或 /zh
 * - /studio → /en/studio（补默认前缀）
 * - api / uploads / _next 静态资源不处理
 */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next|_vercel|uploads|presets|.*\\..*).*)"],
};
