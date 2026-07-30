"use client";

// ============================================================================
// Demostración del producto en el hero.
//
// POR QUÉ ESTE VISUAL Y NO UNA CAPTURA: la característica que diferencia a
// Vinix es invisible en una captura estática — que el agente se niegue a
// escribir cuando no encuentra nada real. Esta animación la muestra: tres
// leads avanzan y uno se detiene en «sin gancho verificable». Ese fotograma
// es el argumento de venta.
//
// Coste: no usa librerías de animación. Un temporizador y clases de Tailwind.
// ============================================================================

import { useEffect, useRef, useState } from "react";

interface DemoLead {
  company: string;
  domain: string;
  /** Lo que el agente encuentra al leer su web. */
  finding: string;
  /** null = no encontró nada aprovechable y se detiene aquí. */
  draft: string | null;
}

const LEADS: DemoLead[] = [
  {
    company: "Northwind Studio",
    domain: "northwind.example",
    finding: "Abrieron oficina en Lisboa y buscan 2 comerciales",
    draft: "vuestra apertura en Lisboa",
  },
  {
    company: "Meridian Labs",
    domain: "meridian.example",
    finding: "Web corporativa sin contenido reciente",
    draft: null,
  },
  {
    company: "Kestrel Digital",
    domain: "kestrel.example",
    finding: "Publicaron que rechazan proyectos por falta de capacidad",
    draft: "los proyectos que estáis rechazando",
  },
];

type Stage = "queued" | "researching" | "found" | "drafted" | "blocked";

/** Milisegundos que dura cada paso. Lo bastante lento para leerse. */
const STEP_MS = 1150;

export function PipelineDemo() {
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // La animación se detiene fuera de la pantalla: no tiene sentido gastar
  // ciclos animando algo que nadie está mirando.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { threshold: 0.15 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setTick((t) => (t + 1) % 14), STEP_MS);
    return () => clearInterval(timer);
  }, [paused]);

  /** Estado de cada lead según el momento de la animación. */
  function stageOf(index: number): Stage {
    const progress = tick - index * 2;
    if (progress < 1) return "queued";
    if (progress < 2) return "researching";
    if (progress < 3) return "found";
    return LEADS[index].draft === null ? "blocked" : "drafted";
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-panel border border-line bg-surface shadow-floating"
      // Es decorativo: el mensaje ya está en el texto del hero
      role="img"
      aria-label="Demostración: Vinix investiga tres empresas y se detiene en la que no tiene información aprovechable"
    >
      {/* Barra de ventana */}
      <div className="flex items-center gap-2 border-b border-line bg-elevated px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="ml-2 text-xs font-medium text-ink-subtle">Pipeline · Agencias Lisboa</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-positive-strong">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-positive" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
          </span>
          En vivo
        </span>
      </div>

      {/* Filas */}
      <div className="divide-y divide-line">
        {LEADS.map((lead, index) => (
          <DemoRow key={lead.company} lead={lead} stage={stageOf(index)} />
        ))}
      </div>

      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-elevated px-4 py-3 text-[11px]">
        <span className="text-ink-subtle">
          <strong className="font-semibold text-ink">2</strong> borradores listos
        </span>
        <span className="text-ink-subtle">
          <strong className="font-semibold text-caution-strong">1</strong> requiere revisión
        </span>
        <span className="ml-auto font-medium text-ink-subtle">0 emails inventados</span>
      </div>
    </div>
  );
}

function DemoRow({ lead, stage }: { lead: DemoLead; stage: Stage }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 transition-colors">
      {/* Indicador de estado */}
      <div className="mt-0.5 shrink-0">
        {stage === "queued" && <span className="block h-4 w-4 rounded-full border-2 border-line-strong" />}
        {stage === "researching" && (
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-brand-500" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {stage === "found" && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-info/15 text-info">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </span>
        )}
        {stage === "drafted" && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-positive/15 text-positive-strong">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
        {stage === "blocked" && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-caution/18 text-caution-strong">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
              <path d="M12 8v5M12 17h.01" />
            </svg>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[13px] font-medium text-ink">{lead.company}</p>
          <p className="font-mono text-[11px] text-ink-subtle">{lead.domain}</p>
        </div>

        {/* El texto cambia con el estado; la altura mínima evita saltos de layout */}
        <div className="mt-1 min-h-[32px]">
          {stage === "queued" && <p className="text-xs text-ink-subtle">En cola</p>}

          {stage === "researching" && (
            <p className="animate-fade-in text-xs text-ink-muted">Leyendo su web…</p>
          )}

          {(stage === "found" || stage === "drafted" || stage === "blocked") && (
            <p className="animate-fade-in text-xs leading-relaxed text-ink-muted">{lead.finding}</p>
          )}

          {stage === "drafted" && (
            <p className="animate-rise-in mt-1.5 text-xs text-ink">
              <span className="text-ink-subtle">Asunto: </span>
              <span className="font-medium">{lead.draft}</span>
            </p>
          )}

          {stage === "blocked" && (
            <p className="animate-rise-in mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-caution-soft px-2 py-1 text-[11px] font-medium text-caution-strong">
              Sin gancho verificable · no se redacta
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
