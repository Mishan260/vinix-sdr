"use client";

// ============================================================================
// Primitivas de UI — sin dependencias externas (iconos SVG inline de 16px).
// Mantienen la consistencia visual: mismo grosor de trazo, mismos radios,
// mismas transiciones en todo el panel.
// ============================================================================

import { memo } from "react";

// ── Iconos (stroke 1.75, 16px) ──────────────────────────────────────────────
const icon = "h-4 w-4 shrink-0";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconCheck = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconX = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconAlert = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
export const IconUpload = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M12 3v12M7 8l5-5 5 5M5 21h14" /></svg>
);
export const IconDownload = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
);
export const IconPlus = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconSearch = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconSend = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="m22 2-11 11M22 2 15 22l-4-9-9-4Z" /></svg>
);
export const IconTrash = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
);
export const IconRefresh = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" /></svg>
);
export const IconMail = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>
);
export const IconEdit = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></svg>
);
export const IconHeart = () => (
  <svg viewBox="0 0 24 24" className={icon} {...stroke}><path d="M19 14c1.5-1.5 3-3.4 3-5.5A5.5 5.5 0 0 0 12 5.5 5.5 5.5 0 0 0 2 8.5c0 2.1 1.5 4 3 5.5l7 7Z" /></svg>
);
export const IconExternal = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" {...stroke}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>
);

export const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// ── Skeleton loader ─────────────────────────────────────────────────────────
export const Skeleton = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-md bg-stone-200/70 ${className}`} />
);

// ── Toasts ──────────────────────────────────────────────────────────────────
export type ToastVariant = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

const TOAST_STYLE: Record<ToastVariant, { wrap: string; icon: React.ReactNode }> = {
  success: { wrap: "border-emerald-200 bg-white text-stone-800", icon: <span className="text-emerald-600"><IconCheck /></span> },
  error:   { wrap: "border-rose-200 bg-white text-stone-800",    icon: <span className="text-rose-600"><IconAlert /></span> },
  info:    { wrap: "border-stone-200 bg-white text-stone-800",   icon: <span className="text-stone-500"><IconMail /></span> },
};

export const ToastStack = memo(function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-stone-900/5 ${TOAST_STYLE[t.variant].wrap}`}
        >
          <span className="mt-0.5">{TOAST_STYLE[t.variant].icon}</span>
          <p className="flex-1 text-sm leading-snug">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            aria-label="Cerrar aviso"
            className="rounded-md p-0.5 text-stone-400 transition-colors hover:text-stone-700"
          >
            <IconX />
          </button>
        </div>
      ))}
    </div>
  );
});
