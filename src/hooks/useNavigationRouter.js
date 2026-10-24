"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useNavigationFeedback } from "@/components/ui/NavigationFeedback";
import { useLocalNavigation } from "@/components/ui/LocalNavigation";
import { deferNavigation } from "@/lib/navigation-guard";

export function useNavigationRouter() {
  const router = useRouter();
  const locale = useLocale();
  const navigation = useNavigationFeedback();
  const visit = useLocalNavigation()?.visit;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useMemo(() => {
    const navigate = (method, href, options) => {
      if (!mounted.current) return;
      if (deferNavigation(() => navigate(method, href, options))) return;
      if (!navigation?.isNavigating() && visit?.(href, { ...options, replace: method === "replace" })) return;
      let id;
      if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
        const localized = /^\/(?:zh|en)(?=\/|\?|#|$)/.test(href) ? href : `/${options?.locale || locale}${href}`;
        id = navigation?.begin(new URL(localized, window.location.href).href);
      }
      try { return router[method](href, options); }
      catch (error) { if (id) navigation?.finish(id); throw error; }
    };
    const history = method => {
      if (!mounted.current) return;
      if (deferNavigation(() => { if (mounted.current) router[method](); })) return;
      return router[method]();
    };
    return { ...router, push: (href, options) => navigate("push", href, options), replace: (href, options) => navigate("replace", href, options), back: () => history("back"), forward: () => history("forward") };
  }, [router, locale, navigation, visit]);
}
