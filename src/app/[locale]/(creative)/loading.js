"use client";
import { useLocale } from "next-intl";
import BrandLoader from "@/components/ui/BrandLoader";

export default function CreativeLoading() {
  return <BrandLoader className="route-loading creative-loading" label={useLocale() === "zh" ? "正在打开" : "Opening"} />;
}
