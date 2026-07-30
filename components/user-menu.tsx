"use client";

// ============================================================================
// Menú de cuenta: email, plan y cierre de sesión.
// El logout va por POST a /auth/signout — un GET permitiría desloguear al
// usuario incrustando la URL como imagen en cualquier página.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export function UserMenu({
  email,
  planLabel,
  planHref = "/pricing",
}: {
  email: string | null;
  planLabel: string;
  planHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (email?.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de cuenta"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-sm font-semibold text-stone-600 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-rise-in absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg shadow-stone-900/5"
        >
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-stone-900" title={email ?? undefined}>
              {email ?? "Sesión activa"}
            </p>
            <p className="mt-0.5 text-xs text-stone-400">{planLabel}</p>
          </div>

          <Link
            href={planHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-stone-700 transition-colors hover:bg-stone-50"
          >
            Plan y facturación
          </Link>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm text-stone-700 transition-colors hover:bg-stone-50"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
