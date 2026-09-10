"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Footer() {
  const t = useTranslations("footer");
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-divider/40 bg-bg-page py-8 text-xs text-secondary-text mt-auto">
      <div className="mx-auto w-full max-w-content px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          &copy; {currentYear} {t("copyright")}
        </div>
        <div className="flex gap-5">
          <Link href="/terms" className="hover:text-primary-text transition-colors">
            {t("terms")}
          </Link>
          <Link href="/privacy" className="hover:text-primary-text transition-colors">
            {t("privacy")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
