import { safeNext } from "./client-api";

export function authDestination(value, locale, fallback = `/${locale}`) {
  const path = safeNext(value, fallback);
  // Authentication callbacks must never reopen an authentication entry route.
  if (/^\/(?:zh\/|en\/)?(?:login|api\/auth)(?:[/?#]|$)/.test(path)) return fallback;
  return /^\/(zh|en)(?:[/?#]|$)/.test(path) ? path : `/${locale}${path === "/" ? "" : path}`;
}
