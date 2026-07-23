"use client";

// ============================================================================
// /pricing — planes con toggle mensual/anual.
//
// El botón ya NO cambia el plan en la BD: abre Stripe Checkout. El plan sólo
// se concede desde el webhook, tras confirmar el cobro. Quien ya tiene
// suscripción ve "Gestionar suscripción", que abre el Customer Portal.
// ============================================================================

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/billing/plans";
import { IconCheck, Spinner, Skeleton, ToastStack, type ToastItem, type ToastVariant } from "@/components/ui";
import { SupportProject } from "@/components/support-project";
import { useToasts } from "@/lib/hooks/use-toasts";

interface AccountInfo {
  plan: PlanId;
  isTrial: boolean;
  trialDaysLeft: number;
  usage: { campaigns: number; leadsThisMonth: number };
  hasBillingAccount: boolean;
  eligibleForTrial: boolean;
}

function PricingContent() {
  const params = useSearchParams();
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const { toasts, notify, dismiss } = useToasts();

  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/account");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.plan) setAccount(data);
    } catch {
      /* la página sigue siendo útil sin el estado de la cuenta */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (params.get("checkout") === "cancelled") {
      notify("info", "Pago cancelado. No se ha realizado ningún cargo.");
    }
  }, [params, notify]);

  async function startCheckout(plan: PlanId) {
    if (busy) return;
    if (plan === "free") {
      notify("info", "El plan Free se aplica automáticamente al terminar tu suscripción.");
      return;
    }

    setBusy(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, cycle }),
      });
      const data = await res.json();

      if (!res.ok) {
        notify("error", data.error ?? "No se pudo iniciar el pago.");
        return;
      }
      // Redirección a Stripe: el plan se concede al volver, vía webhook
      window.location.href = data.url;
    } catch {
      notify("error", "No se pudo conectar con la pasarela de pago.");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    if (busy) return;
    setBusy("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data.error ?? "No se pudo abrir el portal de facturación.");
        return;
      }
      window.location.href = data.url;
    } catch {
      notify("error", "No se pudo conectar con la pasarela de pago.");
    } finally {
      setBusy(null);
    }
  }

  const planList = [PLANS.free, PLANS.pro, PLANS.agency];
  const hasPaidPlan = account !== null && account.plan !== "free" && !account.isTrial;

  return (
    <main className="min-h-screen pb-20">
      <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6 sm:pt-14">
        <div className="text-center">
          <Link href="/dashboard" className="text-xs font-medium text-teal-700 hover:underline">
            ← Volver al panel
          </Link>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Un agente que trabaja tu pipeline cada día
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-stone-500">
            {account?.eligibleForTrial !== false
              ? `Empieza con ${TRIAL_DAYS} días de Pro incluidos. Sin cargo hasta que termine el periodo de prueba.`
              : "Cambia de plan cuando quieras. Los cambios se prorratean automáticamente."}
          </p>

          {loading ? (
            <div className="mt-7 flex justify-center">
              <Skeleton className="h-10 w-56 rounded-full" />
            </div>
          ) : (
            <div
              role="group"
              aria-label="Ciclo de facturación"
              className="mt-7 inline-flex items-center rounded-full border border-stone-200 bg-white p-1 text-xs font-medium shadow-sm"
            >
              {(["monthly", "annual"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  aria-pressed={cycle === c}
                  className={`rounded-full px-4 py-1.5 transition-colors ${
                    cycle === c ? "bg-stone-900 text-white" : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  {c === "monthly" ? "Mensual" : "Anual"}
                  {c === "annual" && (
                    <span className={cycle === "annual" ? "ml-1 text-emerald-300" : "ml-1 text-emerald-600"}>−20%</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {hasPaidPlan && (
          <div className="animate-fade-in mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-stone-600">
              Tu plan actual es <strong className="font-medium text-stone-900">{PLANS[account.plan].name}</strong>.
            </p>
            <button
              onClick={openPortal}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
            >
              {busy === "portal" && <Spinner className="h-3.5 w-3.5" />}
              Gestionar suscripción
            </button>
          </div>
        )}

        {/* Tarjetas de planes */}
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {planList.map((plan) => {
            const price = cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
            const isCurrent = account !== null && !account.isTrial && account.plan === plan.id;

            return (
              <div
                key={plan.id}
                className={`animate-rise-in relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
                  plan.highlight ? "border-teal-700 shadow-teal-900/5" : "border-stone-200"
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-teal-700 px-3 py-1 text-[11px] font-semibold text-white">
                    Recomendado
                  </span>
                )}

                <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-stone-400">{plan.tagline}</p>

                <p className="mt-4">
                  <span className="text-3xl font-semibold tabular-nums tracking-tight">{price} €</span>
                  <span className="text-sm text-stone-400"> /mes</span>
                  {cycle === "annual" && plan.monthlyPrice > 0 && (
                    <span className="ml-2 text-xs text-stone-400 line-through">{plan.monthlyPrice} €</span>
                  )}
                </p>
                {cycle === "annual" && plan.monthlyPrice > 0 && (
                  <p className="mt-0.5 text-[11px] text-stone-400">Facturado anualmente ({price * 12} €/año)</p>
                )}

                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-stone-600">
                      <span className="mt-0.5 shrink-0 text-teal-700">
                        <IconCheck />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => (isCurrent ? openPortal() : startCheckout(plan.id))}
                  disabled={busy !== null || loading || (plan.id === "free" && !isCurrent)}
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
                    isCurrent
                      ? "border border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                      : plan.highlight
                        ? "bg-teal-700 text-white hover:bg-teal-600"
                        : "bg-stone-900 text-white hover:bg-stone-700"
                  }`}
                >
                  {busy === plan.id && <Spinner className="h-4 w-4" />}
                  {isCurrent
                    ? "Gestionar"
                    : plan.id === "free"
                      ? "Incluido"
                      : account?.eligibleForTrial
                        ? `Probar ${plan.name} gratis`
                        : `Cambiar a ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Comparativa */}
        <div className="mt-12 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Comparativa de funciones por plan</caption>
            <thead>
              <tr className="border-b border-stone-100 text-left text-[11px] font-medium uppercase tracking-wider text-stone-400">
                <th scope="col" className="px-5 py-3">Función</th>
                {planList.map((p) => (
                  <th key={p.id} scope="col" className={`px-5 py-3 ${p.highlight ? "text-teal-700" : ""}`}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-stone-600">
              {[
                { label: "Campañas activas", get: (p: typeof PLANS.free) => (p.limits.campaigns === Infinity ? "Ilimitadas" : String(p.limits.campaigns)) },
                { label: "Leads investigados / mes", get: (p: typeof PLANS.free) => p.limits.leadsPerMonth.toLocaleString("es-ES") },
                { label: "Redacción con IA + aprobación", get: () => "✓" },
                { label: "Clasificación de respuestas", get: () => "✓" },
                { label: "Follow-ups automáticos", get: (p: typeof PLANS.free) => (p.limits.followUps ? "✓" : "—") },
                { label: "Exportación CSV", get: (p: typeof PLANS.free) => (p.limits.csvExport ? "✓" : "—") },
              ].map((row) => (
                <tr key={row.label} className="border-b border-stone-100 last:border-0">
                  <th scope="row" className="px-5 py-3 text-left font-medium text-stone-700">{row.label}</th>
                  {planList.map((p) => (
                    <td key={p.id} className="px-5 py-3 tabular-nums">{row.get(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-stone-400">
          Pagos procesados por Stripe; no almacenamos datos de tarjeta. Puedes cancelar cuando quieras desde
          &ldquo;Gestionar suscripción&rdquo; y conservarás el acceso hasta el final del periodo pagado.
        </p>

        {/* Aportación voluntaria — independiente de los planes de pago */}
        <SupportProject />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingContent />
    </Suspense>
  );
}

export type { ToastItem, ToastVariant };
