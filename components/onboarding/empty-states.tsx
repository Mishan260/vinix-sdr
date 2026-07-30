"use client";

// ============================================================================
// Estados vacíos y consejos contextuales.
//
// PRINCIPIO: una pantalla vacía es una oportunidad de enseñar, no un hueco que
// rellenar con «No hay datos». Cada estado de aquí explica qué falta, por qué
// importa y ofrece la acción concreta para resolverlo.
//
// Los consejos aparecen de uno en uno, sólo cuando su condición se cumple, y
// se descartan para siempre. Nunca un tour que tape la pantalla.
// ============================================================================

import Link from "next/link";
import { Button } from "@/components/brand";
import { Spinner } from "@/components/ui";
import { TIPS, type TipId } from "@/lib/onboarding/steps";

// ── Estado vacío: sin ningún lead ───────────────────────────────────────────
export function NoLeadsYet({
  onImport,
  onCreateDemo,
  creatingDemo,
}: {
  onImport: () => void;
  onCreateDemo: () => void;
  creatingDemo: boolean;
}) {
  return (
    <div className="mx-auto max-w-md px-6 py-14 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>

      <h3 className="mt-4 text-heading text-ink">Aún no hay nada que investigar</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Sube un CSV con tus empresas objetivo. Basta con una columna{" "}
        <code className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-xs">company_name</code>; si
        añades <code className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-xs">company_url</code>{" "}
        el agente podrá investigarlas.
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <Button onClick={onImport} className="w-full sm:w-auto">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />
          </svg>
          Importar CSV
        </Button>

        <button
          onClick={onCreateDemo}
          disabled={creatingDemo}
          className="inline-flex items-center gap-2 text-xs text-ink-subtle underline-offset-4 hover:text-ink hover:underline disabled:opacity-60"
        >
          {creatingDemo && <Spinner className="h-3 w-3" />}
          {creatingDemo ? "Creando ejemplo…" : "O carga una campaña de ejemplo para curiosear"}
        </button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-ink-subtle">
        Acepta separador coma o punto y coma, y el formato que exporta Excel en español.
      </p>
    </div>
  );
}

// ── Estado vacío: hay leads pero el filtro no devuelve ninguno ──────────────
export function NoLeadsForFilter({ statusLabel, onClear }: { statusLabel: string; onClear: () => void }) {
  return (
    <div className="mx-auto max-w-sm px-6 py-12 text-center">
      <h3 className="text-sm font-medium text-ink">Ningún lead en «{statusLabel}»</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        Tus leads están en otros estados del pipeline.
      </p>
      <button
        onClick={onClear}
        className="mt-4 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
      >
        Ver todos los leads
      </button>
    </div>
  );
}

// ── Estado vacío: sin respuestas todavía ────────────────────────────────────
export function NoRepliesYet({ hasSent }: { hasSent: boolean }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <h3 className="text-sm font-medium text-ink">
        {hasSent ? "Todavía no ha respondido nadie" : "Aquí aparecerán las respuestas"}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink-muted">
        {hasSent
          ? "Cuando alguien conteste, Vinix clasificará la respuesta y propondrá dos huecos en tu agenda si hay interés real."
          : "Cuando envíes tu primer email y el prospecto conteste, la respuesta se clasificará automáticamente aquí."}
      </p>
    </div>
  );
}

// ── Aviso de campaña de ejemplo ─────────────────────────────────────────────
export function DemoCampaignBanner({ onRemove, removing }: { onRemove: () => void; removing: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-caution/30 bg-caution-soft px-4 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-caution/20 text-caution-strong">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 8v5M12 17h.01" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Estás viendo una campaña de ejemplo</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          Los leads son ficticios y no se enviará ningún email. Sirve para ver cómo queda el pipeline
          con datos dentro.
        </p>
      </div>

      <button
        onClick={onRemove}
        disabled={removing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-caution/40 px-3 py-1.5 text-xs font-medium text-caution-strong transition-colors hover:bg-caution/10 disabled:opacity-60"
      >
        {removing && <Spinner className="h-3 w-3" />}
        {removing ? "Eliminando…" : "Eliminar ejemplo"}
      </button>
    </div>
  );
}

// ── Consejo contextual ──────────────────────────────────────────────────────
export function ContextualTip({ id, onDismiss }: { id: TipId; onDismiss: (id: TipId) => void }) {
  const tip = TIPS[id];

  return (
    <div
      role="note"
      className="animate-rise-in flex items-start gap-3 rounded-card border border-brand-500/25 bg-brand-500/[0.06] px-4 py-3"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-400">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink">{tip.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{tip.body}</p>
      </div>

      <button
        onClick={() => onDismiss(id)}
        aria-label="Entendido, no volver a mostrar"
        className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-line/40 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Celebración del primer borrador ─────────────────────────────────────────
export function FirstDraftCelebration({ companyName, onDismiss }: { companyName: string; onDismiss: () => void }) {
  return (
    <div className="animate-rise-in flex flex-wrap items-center gap-3 rounded-card border border-positive/30 bg-positive-soft px-4 py-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-positive/20 text-positive-strong">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Tu primer borrador está listo</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          Vinix investigó {companyName} y escribió un email basado en lo que encontró. Revísalo antes
          de enviarlo.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/bienvenida?paso=company"
          className="text-xs font-medium text-positive-strong hover:underline"
        >
          Probar otra empresa
        </Link>
        <button
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-line/40 hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
