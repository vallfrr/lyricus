"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { LOCALES, LOCALE_META } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function NavBar() {
  const { user, logout, loading } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const links = [
    { href: "/leaderboard", key: "nav.leaderboard" },
    { href: "/history",     key: "nav.history" },
    { href: "/settings",    key: "nav.settings" },
  ];

  function NavLink({ href, label }) {
    return (
      <Link
        href={href}
        onClick={() => setOpen(false)}
        className={cn(
          "transition-colors",
          pathname === href ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </Link>
    );
  }

  return (
    <>
      <nav className="border-b border-border px-4 h-10 flex items-center justify-between shrink-0">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:opacity-70 transition-opacity">
          lyricus
        </Link>

        <div className="flex items-center gap-3 text-xs">
          {/* Desktop links */}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "transition-colors hidden sm:inline",
                pathname === l.href ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(l.key)}
            </Link>
          ))}

          <div className="relative">
            <button
              onClick={() => setLangOpen((o) => !o)}
              className="h-7 px-1.5 text-[10px] border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors tabular-nums flex items-center"
            >
              {LOCALE_META[locale]?.flag} {locale.toUpperCase()}
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border min-w-[120px] shadow-md">
                  {LOCALES.map((l) => (
                    <button
                      key={l}
                      onClick={() => { setLocale(l); setLangOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-accent transition-colors",
                        l === locale ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      <span>{LOCALE_META[l].flag}</span>
                      <span>{LOCALE_META[l].label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <ThemeToggle />

          {!loading && (
            user ? (
              <Link
                href={user.name ? `/u/${encodeURIComponent(user.name)}` : "/settings"}
                className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline truncate max-w-[120px]"
              >
                {user.name || user.email}
              </Link>
            ) : (
              <Link href="/login" className="h-7 flex items-center border border-border px-2.5 text-xs hover:border-foreground transition-colors">
                {t("nav.login")}
              </Link>
            )
          )}

          {/* Hamburger (mobile only) */}
          <button
            className="sm:hidden flex items-center justify-center h-7 w-7 border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen((o) => !o)}
            aria-label="menu"
          >
            {open ? <X size={13} /> : <Menu size={13} />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="sm:hidden border-b border-border bg-background flex flex-col text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cn(
                "px-4 py-3 border-b border-border transition-colors",
                pathname === l.href ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(l.key)}
            </Link>
          ))}
          {!loading && user && (
            <>
              <Link
                href={user.name ? `/u/${encodeURIComponent(user.name)}` : "/settings"}
                onClick={() => setOpen(false)}
                className="px-4 py-3 border-b border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                {user.name || user.email}
              </Link>
              <button onClick={() => { logout(); setOpen(false); }} className="px-4 py-3 text-left text-muted-foreground hover:text-foreground transition-colors">
                {t("nav.logout")}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
