// components/brand.tsx
// ============================================================================
// Identidad de marca: logotipo, botones y superficies.
//
// Un solo sitio define cómo se ve un botón primario o una tarjeta. Cuando cada
// pantalla inventa sus propias clases, el producto acaba pareciendo cuatro
// productos distintos; esto es lo que evita ese deslizamiento.
//
// Es un módulo de servidor: no lleva "use client" para que los componentes que
// sólo pintan (logo, tarjetas, badges) no arrastren JavaScript al navegador.
// ============================================================================

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// ── Logotipo ────────────────────────────────────────────────────────────────
// La marca es una "V" formada por una lupa: investigar es lo que distingue al
// producto, así que el símbolo lo dice literalmente.
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Vinix" fill="none">
      <rect width="32" height="32" rx="8" className="fill-brand-700" />
      <path
        d="M9 10.5 14.2 21a1 1 0 0 0 1.8 0l2.2-4.5"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.5" cy="12.5" r="3.6" stroke="white" strokeWidth="2.1" />
      <path d="m24.4 15.4 2.1 2.1" stroke="white" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <Logo className="h-7 w-7" />
      <span className="text-[15px] font-semibold tracking-tight text-ink">Vinix</span>
    </span>
  );
}

// ── Botones ─────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white shadow-subtle hover:bg-brand-600 active:bg-brand-700 dark:bg-brand-500 dark:text-ink-inverted dark:hover:bg-brand-400",
  secondary:
    "border border-line bg-surface text-ink shadow-subtle hover:border-line-strong hover:bg-elevated",
  ghost: "text-ink-muted hover:bg-line/40 hover:text-ink",
  danger: "bg-critical text-white shadow-subtle hover:bg-critical-strong",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2.5 px-6 text-[15px]",
};

const BUTTON_BASE =
  "inline-flex select-none items-center justify-center rounded-lg font-medium transition-all " +
  // El desplazamiento de 1px al pulsar da sensación física sin ser aparatoso
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `${BUTTON_BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button className={buttonClass(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

// ── Superficies ─────────────────────────────────────────────────────────────
export function Card({
  className = "",
  children,
  interactive = false,
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface shadow-subtle ${
        interactive ? "transition-all hover:border-line-strong hover:shadow-raised" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

// ── Etiquetas ───────────────────────────────────────────────────────────────
type BadgeTone = "neutral" | "brand" | "positive" | "caution" | "critical" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-line/50 text-ink-muted",
  brand: "bg-brand-500/12 text-brand-700 dark:text-brand-400",
  positive: "bg-positive/12 text-positive-strong",
  caution: "bg-caution/14 text-caution-strong",
  critical: "bg-critical/12 text-critical-strong",
  info: "bg-info/12 text-info",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Etiqueta de sección: el texto pequeño en mayúsculas sobre cada título. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-micro font-semibold uppercase text-brand-600 dark:text-brand-400 ${className}`}>
      {children}
    </p>
  );
}

/** Contenedor de ancho máximo, coherente en todas las páginas públicas. */
export function Container({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}
