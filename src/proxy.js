import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.js";

/**
 * locale 路由代理：
 * - / → 按 Accept-Language 重定向到 /en 或 /zh
 * - /studio → /en/studio（补默认前缀）
 * - api / uploads / _next 静态资源不处理
 */
const localeProxy = createMiddleware(routing);
export default function proxy(request) {
  if (request.nextUrl.pathname.startsWith("/uploads/")) return new Response(null, { status: 404 });
  return localeProxy(request);
}

export const config = {
  matcher: ["/uploads/:path*", "/((?!api|_next|_vercel|uploads|presets|.*\\..*).*)"],
};
