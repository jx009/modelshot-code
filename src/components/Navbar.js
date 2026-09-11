"use client";

import { useState } from "react";
import { Aperture, Camera, Images, CreditCard, Coins, Menu, X, LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import ThemeSwitcher from "./ThemeSwitcher";
import LocaleSwitcher from "./LocaleSwitcher";
import UserMenu from "./UserMenu";

export default function Navbar() {
  const { data: session } = useSession();
  const t = useTranslations("workspace");
  const tn = useTranslations("nav");
  const f = useTranslations("flow");
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/studio", label: tn("studio"), icon: Camera },
    { href: "/gallery", label: t("gallery"), icon: Images },
    { href: "/pricing", label: tn("pricing"), icon: CreditCard },
    { href: "/account", label: f("account"), icon: Coins },
  ];
  return (
    <header className="site-nav">
      <Link href="/studio" className="brand"><Aperture size={25} className="text-primary" /><span>ModelShot<span className="brand-dot">.</span></span></Link>
      <nav className="desktop-nav" aria-label={t("menu")}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={path === href ? "page" : undefined}><Icon size={16} />{label}</Link>)}
      </nav>
      <div className="nav-actions">
        <span className="desktop-control"><LocaleSwitcher /></span><ThemeSwitcher />
        {session?.user ? <><Link href="/pricing" className="balance desktop-control" title={t("credits")}><Coins size={15} /><span>{session.user.credits ?? 0}</span></Link><UserMenu user={session.user} /></> : <Link href="/login" className="button primary compact">{t("signIn")}</Link>}
        <button className="icon-button mobile-menu-button" onClick={() => setOpen(!open)} aria-label={t("menu")} aria-expanded={open}>{open ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
      {open && <nav className="mobile-nav" aria-label={t("menu")}>
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={path === href ? "page" : undefined}><Icon size={17} />{label}</Link>)}
        <div className="flex items-center justify-between pt-3 border-t border-divider"><LocaleSwitcher />{session?.user && <button className="button compact" onClick={() => signOut()}><LogOut size={15} />{t("signOut")}</button>}</div>
      </nav>}
    </header>
  );
}
