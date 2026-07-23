"use client";

// ============================================================================
// Carcasa compartida de las pantallas de autenticación.
// Login, registro, recuperación y cambio de contraseña comparten estructura,
// espaciado y estados; extraerlo evita cuatro copias que se desincronizan.
// ============================================================================

import Link from "next/link";
import type { ReactNode } from "react";
import { Spinner, IconAlert, IconCheck } from "./ui";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">
            V
          </span>
          <span className="text-sm font-semibold tracking-tight">Vinix SDR</span>
        </Link>

        <div className="animate-rise-in rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight text-stone-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm leading-relaxed text-stone-500">{subtitle}</p>
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-sm text-stone-500">{footer}</div>}
      </div>
    </main>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = props.id ?? props.name;
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-stone-600">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={`w-full rounded-xl border p-3 text-sm transition-colors placeholder:text-stone-300 focus:outline-none ${
          error ? "border-rose-300 focus:border-rose-500" : "border-stone-200 focus:border-teal-700"
        }`}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-stone-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-teal-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function FormAlert({ variant, children }: { variant: "error" | "success"; children: ReactNode }) {
  const styles =
    variant === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`animate-fade-in mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug ${styles}`}
    >
      <span className="mt-0.5 shrink-0">{variant === "error" ? <IconAlert /> : <IconCheck />}</span>
      <p>{children}</p>
    </div>
  );
}
