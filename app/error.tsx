"use client";

// ============================================================================
// Límite de error de la aplicación. Sustituye la pantalla en blanco (o el
// stack trace de desarrollo) por algo accionable, sin filtrar internals.
// ============================================================================

import { useEffect } from "react";
import Link from "next/link";
import { IconAlert, IconRefresh } from "@/components/ui";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `digest` es el identificador que Next asigna al error en servidor: es lo
    // que permite localizarlo en los logs a partir de lo que ve el usuario.
    console.error("[app] Error no controlado", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="animate-rise-in w-full max-w-md rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <IconAlert />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Algo ha fallado</h1>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-stone-500">
          No hemos podido cargar esta pantalla. Tus datos están a salvo: nada de lo que estabas viendo se ha
          modificado.
        </p>

        {error.digest && (
          <p className="mb-6 rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-500">
            Referencia: {error.digest}
          </p>
        )}

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            <IconRefresh /> Reintentar
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
          >
            Volver al panel
          </Link>
        </div>
      </div>
    </main>
  );
}
