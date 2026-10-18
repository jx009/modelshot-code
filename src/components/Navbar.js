"use client";
import CreditIcon from "@/components/ui/CreditIcon";

import { useState } from "react";
import { CreditCard, Coins, Menu, X, LogOut } from "lucide-react";
import BrandLogo from "./BrandLogo";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import Link from "@/components/ui/NavigationLink";
import ThemeSwitcher from "./ThemeSwitcher";
import LocaleSwitcher from "./LocaleSwitcher";
import UserMenu from "./UserMenu";

import { useRecharge } from "./billing/RechargeProvider";

export default function Navbar() {
  const recharge = useRecharge();
  const { data: session } = useSession();
  const t = useTranslations("workspace");
  const tn = useTranslations("nav");
  const f = useTranslations("flow");
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (path === "/admin" || path.startsWith("/admin/") || path === "/" || path === "/projects" || path === "/assets" || path === "/commerce" || path === "/explore" || path.startsWith("/explore/") || path === "/studio-v2") return null;
  const links = [
    { href: "/pricing", label: tn("pricing"), icon: CreditCard },
    { href: "/account", label: f("account"), icon: Coins },
  ];
  return (
    <header className="site-nav">
      <Link href="/" className="brand" aria-label="来塔绘梦"><BrandLogo /></Link>
      <nav className="desktop-nav" aria-label={t("menu")}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined}><Icon size={16} />{label}</Link>)}
      </nav>
      <div className="nav-actions">
        <span className="desktop-control"><LocaleSwitcher /></span><ThemeSwitcher />
        {session?.user ? <><button onClick={recharge.open} className="balance desktop-control" title={t("credits")}><CreditIcon /><span>{session.user.credits ?? 0}</span></button><UserMenu user={session.user} /></> : <Link href="/login" className="button primary compact">{t("signIn")}</Link>}
        <button className="icon-button mobile-menu-button" onClick={() => setOpen(!open)} aria-label={t("menu")} aria-expanded={open}>{open ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
      {open && <nav className="mobile-nav" aria-label={t("menu")}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={path === href ? "page" : undefined}><Icon size={17} />{label}</Link>)}
        <div className="flex items-center justify-between pt-3 border-t border-divider"><LocaleSwitcher />{session?.user && <button className="button compact" onClick={() => signOut()}><LogOut size={15} />{t("signOut")}</button>}</div>
      </nav>}
    </header>
  );
}
