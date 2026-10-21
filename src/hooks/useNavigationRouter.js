"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useNavigationFeedback } from "@/components/ui/NavigationFeedback";

export function useNavigationRouter() {
  const router = useRouter();
  const locale = useLocale();
  const navigation = useNavigationFeedback();
  return useMemo(() => {
    const navigate = (method, href, options) => {
      let id;
      if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
        const localized = /^\/(?:zh|en)(?=\/|\?|#|$)/.test(href) ? href : `/${options?.locale || locale}${href}`;
        id = navigation?.begin(new URL(localized, window.location.href).href);
      }
      try { return router[method](href, options); }
      catch (error) { if (id) navigation?.finish(id); throw error; }
    };
    return { ...router, push: (href, options) => navigate("push", href, options), replace: (href, options) => navigate("replace", href, options) };
  }, [router, locale, navigation]);
}
