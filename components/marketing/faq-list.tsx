"use client";

// ============================================================================
// Acordeón de preguntas frecuentes.
//
// Construido sobre <details>/<summary> nativos en lugar de estado de React:
// funciona sin JavaScript, es accesible por teclado de serie, y el contenido
// está en el HTML desde el principio —lo que importa porque estas respuestas
// alimentan el JSON-LD de FAQPage y Google necesita verlas.
//
// La única parte con JavaScript es cerrar las demás al abrir una, que es
// preferencia visual, no funcionalidad.
// ============================================================================

import { useRef } from "react";

export function FaqList({ items }: { items: readonly { question: string; answer: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Acordeón exclusivo: al abrir una respuesta se cierran las demás
  const closeOthers = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const opened = event.currentTarget;
    if (!opened.open) return;
    containerRef.current?.querySelectorAll("details[open]").forEach((element) => {
      if (element !== opened) (element as HTMLDetailsElement).open = false;
    });
  };

  return (
    <div ref={containerRef} className="divide-y divide-line rounded-card border border-line bg-canvas">
      {items.map((item) => (
        <details key={item.question} onToggle={closeOthers} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-line/25">
            <h3 className="text-[15px] font-medium text-ink">{item.question}</h3>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-ink-subtle transition-transform duration-200 group-open:rotate-45">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </summary>
          <div className="px-6 pb-5">
            <p className="max-w-3xl text-sm leading-relaxed text-ink-muted">{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
