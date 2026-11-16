import localFont from "next/font/local";
import "../globals.css";
import "../select.css";
import StylesheetRecovery from "../../components/StylesheetRecovery";
import WebVitals from "../../components/WebVitals";
import { Providers } from "../providers";
import NavigationContent from "@/components/ui/NavigationContent";
import AnnouncementBanner from "../../components/AnnouncementBanner";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";

const MESSAGES = { en: enMessages, zh: zhMessages };
// 只在服务端使用的命名空间不下发到浏览器。
const SERVER_ONLY_NAMESPACES = new Set(["meta", "nav", "pricing"]);

/* 展示字体：时尚杂志衬线，标题专用（本地化，中文回落 Noto Serif SC / 系统宋体） */
const instrumentSerif = localFont({
  src: [
    { path: "../../fonts/instrument-serif-400.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/instrument-serif-400i.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

/* 正文字体：高可读无衬线（本地化） */
const geist = localFont({
  src: [
    { path: "../../fonts/geist-400.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/geist-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const meta = MESSAGES[locale]?.meta || MESSAGES.en.meta;
  return {
    metadataBase: new URL(process.env.NEXTAUTH_URL || "http://127.0.0.1:3000"),
    title: meta.title,
    description: meta.description,
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}`])
      ),
    },
  };
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} data-theme="dark" className={`${instrumentSerif.variable} ${geist.variable} h-full w-full`} suppressHydrationWarning>
      <body className={`min-h-dvh w-full flex flex-col antialiased bg-bg-page text-primary-text font-sans`}>
        <StylesheetRecovery locale={locale} />
        <WebVitals />
        {/* 首次访问与服务端首屏默认深色；用户手动选择的浅色或系统主题继续保留。 */}
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem disableTransitionOnChange={false}>
          <NextIntlClientProvider messages={Object.fromEntries(Object.entries(messages).filter(([key]) => !SERVER_ONLY_NAMESPACES.has(key)))}>
            <Providers>
              <AnnouncementBanner />
              <div className="flex-1 flex flex-col min-h-0">
                <NavigationContent>{children}</NavigationContent>
              </div>
            </Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
