"use client";

// ============================================================================
// Lista de tareas del panel.
//
// Nunca es estática: cada tarea se deriva del estado real de los datos, así
// que borrar una campaña vuelve a marcar su paso como pendiente. Cada tarea
// explica POR QUÉ importa; una lista sin motivos es burocracia que el usuario
// descarta sin leer.
//
// Se pliega sola cuando está todo hecho y se puede descartar para siempre.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/brand";
import type { Task } from "@/lib/onboarding/steps";

interface ChecklistProps {
  tasks: Task[];
  progress: { done: number; total: number; percent: number };
  onDismiss: () => void;
  /** Acciones que ocurren dentro del panel (abrir importador, filtrar…). */
  onIntent: (intent: string) => void;
}

export function OnboardingChecklist({ tasks, progress, onDismiss, onIntent }: ChecklistProps) {
  const complete = progress.done === progress.total;
  const [expanded, setExpanded] = useState(!complete);
  const [celebrated, setCelebrated] = useState(false);
  const previousDone = useRef(progress.done);

  // Celebración al completar: se dispara una sola vez, en la transición.
  // Comprobar sólo `complete` la relanzaría en cada render.
  useEffect(() => {
    if (progress.done > previousDone.current && progress.done === progress.total) {
      setCelebrated(true);
      const timer = setTimeout(() => setCelebrated(false), 4000);
      return () => clearTimeout(timer);
    }
    previousDone.current = progress.done;
  }, [progress.done, progress.total]);

  const nextTask = tasks.find((t) => !t.done && !t.optional);

  return (
    <section
      aria-labelledby="checklist-title"
      className={`overflow-hidden rounded-card border bg-surface transition-colors ${
        celebrated ? "border-positive/50" : "border-line"
      }`}
    >
      {/* Cabecera */}
      <div className="flex items-center gap-4 px-5 py-4">
        <ProgressRing percent={progress.percent} complete={complete} />

        <div className="min-w-0 flex-1">
          <h2 id="checklist-title" className="text-sm font-medium text-ink">
            {complete ? "Todo listo" : celebrated ? "¡Completado!" : "Primeros pasos"}
          </h2>
          <p className="mt-0.5 truncate text-xs text-ink-subtle">
            {complete
              ? "Tu cuenta está configurada para trabajar"
              : nextTask
                ? `Siguiente: ${nextTask.title}`
                : `${progress.done} de ${progress.total} completados`}
          </p>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="checklist-items"
          className="rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-line/40 hover:text-ink"
        >
          <span className="sr-only">{expanded ? "Plegar lista" : "Desplegar lista"}</span>
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* Tareas */}
      {expanded && (
        <ul id="checklist-items" className="divide-y divide-line border-t border-line">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-0.5 shrink-0">
                {task.done ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-positive/15 text-positive-strong">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                ) : (
                  <span className="block h-5 w-5 rounded-full border-2 border-line-strong" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${task.done ? "text-ink-subtle line-through" : "font-medium text-ink"}`}>
                    {task.title}
                  </p>
                  {task.optional && !task.done && (
                    <Badge tone="neutral" className="px-2 py-0.5 text-[10px]">
                      opcional
                    </Badge>
                  )}
                </div>

                {!task.done && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{task.reason}</p>
                )}

                {!task.done && task.action && (
                  <div className="mt-2.5">
                    {task.action.href ? (
                      <Link
                        href={task.action.href}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
                      >
                        {task.action.label}
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </Link>
                    ) : (
                      <button
                        onClick={() => task.action?.intent && onIntent(task.action.intent)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
                      >
                        {task.action.label}
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {complete && expanded && (
        <div className="border-t border-line px-5 py-3">
          <button onClick={onDismiss} className="text-xs text-ink-subtle underline-offset-4 hover:text-ink hover:underline">
            Ocultar esta lista
          </button>
        </div>
      )}
    </section>
  );
}

/** Anillo de progreso. Comunica avance mejor que un porcentaje suelto. */
function ProgressRing({ percent, complete }: { percent: number; complete: boolean }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-line" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-700 ${complete ? "text-positive" : "text-brand-500"}`}
        />
      </svg>

      <span className="absolute text-[10px] font-semibold tabular-nums text-ink">
        {complete ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-positive-strong" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          `${percent}%`
        )}
      </span>
    </div>
  );
}
