import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing.js";

/**
 * 带 locale 前缀的导航 — 页面里用这个替代 next/link 和 next/navigation
 * 用法与 Link/useRouter 完全一致，href 不带 locale 前缀
 */
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
