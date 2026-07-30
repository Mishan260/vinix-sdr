"use client";

// ============================================================================
// Cabecera y pie de las páginas públicas.
//
// La cabecera se vuelve opaca al hacer scroll: sobre el hero es transparente
// para no cortar el degradado, y sólida en cuanto hay contenido debajo, que es
// cuando el texto necesita fondo para leerse.
// ============================================================================

import Link from "next/link";
import { useEffect, useState } from "react";
import { ButtonLink, Container, Logo, Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { FOOTER_LINKS } from "@/lib/marketing/content";
import { SITE } from "@/lib/seo";

const NAV = [
  { label: "Cómo funciona", href: "/#como-funciona" },
  { label: "Diferencias", href: "/#diferencias" },
  { label: "Casos de uso", href: "/#casos" },
  { label: "Precios", href: "/pricing" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    // passive: el listener no llama a preventDefault, así el navegador no
    // bloquea el scroll esperando a ver si lo hace.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Con el menú móvil abierto se bloquea el scroll del fondo
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b border-line bg-canvas/85 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <Container>
        <div className="flex h-16 items-center gap-8">
          <Link href="/" className="shrink-0" aria-label="Vinix, inicio">
            <Wordmark />
          </Link>

          <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-line/40 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink sm:inline-block"
            >
              Iniciar sesión
            </Link>
            <ButtonLink href="/signup" size="sm" className="hidden sm:inline-flex">
              Empezar gratis
            </ButtonLink>

            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-line/40 md:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 12h18M3 6h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {menuOpen && (
        <div className="animate-fade-in border-t border-line bg-canvas md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-line/40 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-4">
              <ButtonLink href="/signup" size="sm" className="flex-1">
                Empezar gratis
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="sm" className="flex-1">
                Iniciar sesión
              </ButtonLink>
            </div>
            <div className="mt-3 flex justify-center">
              <ThemeToggle />
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:pr-8">
            <Logo className="h-8 w-8" />
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">{SITE.tagline}.</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
              Menos emails, mejor investigados, cero inventados.
            </p>
          </div>

          {FOOTER_LINKS.map((group) => (
            <div key={group.title}>
              <h2 className="text-micro font-semibold uppercase text-ink-subtle">{group.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-subtle">
            © {new Date().getFullYear()} {SITE.fullName}. Hecho en España.
          </p>
          <p className="text-xs text-ink-subtle">
            Tú apruebas cada email antes de que salga.
          </p>
        </div>
      </Container>
    </footer>
  );
}
