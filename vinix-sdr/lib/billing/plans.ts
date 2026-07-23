// lib/billing/plans.ts
// ============================================================================
// ÚNICA FUENTE DE VERDAD de planes y límites.
// La API la usa para aplicar límites; /pricing la usa para pintar la
// comparativa; Stripe la usa para resolver el price id de cada plan/ciclo.
// Cambiar un número aquí lo cambia en todas partes.
// ============================================================================

export type PlanId = "free" | "pro" | "agency";
export type BillingCycle = "monthly" | "annual";

export interface PlanLimits {
  campaigns: number; // Infinity = ilimitado
  leadsPerMonth: number;
  followUps: boolean;
  csvExport: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  limits: PlanLimits;
  features: string[];
  highlight?: boolean;
}

export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Para probar el agente con tus primeros leads",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    limits: { campaigns: 1, leadsPerMonth: 50, followUps: false, csvExport: false },
    features: [
      "1 campaña activa",
      "50 leads investigados al mes",
      "Redacción con IA y aprobación manual",
      "Clasificación automática de respuestas",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Para operar tu prospección en serio",
    monthlyPrice: 29,
    annualMonthlyPrice: 23,
    limits: { campaigns: 5, leadsPerMonth: 1000, followUps: true, csvExport: true },
    features: [
      "5 campañas activas",
      "1.000 leads investigados al mes",
      "Follow-ups automáticos a leads sin respuesta",
      "Exportación CSV para informes",
      "Límite diario de envío configurable",
    ],
    highlight: true,
  },
  agency: {
    id: "agency",
    name: "Agency",
    tagline: "Para gestionar la prospección de varios clientes",
    monthlyPrice: 79,
    annualMonthlyPrice: 63,
    limits: { campaigns: Infinity, leadsPerMonth: 10000, followUps: true, csvExport: true },
    features: [
      "Campañas ilimitadas (una por cliente)",
      "10.000 leads investigados al mes",
      "Todo lo del plan Pro",
      "Pensado para facturar el servicio a terceros",
    ],
  },
};

// ── Estado de la cuenta tal como vive en la tabla `accounts` ────────────────
export interface AccountRow {
  user_id: string;
  plan: "trial" | PlanId;
  billing_cycle: BillingCycle | null;
  trial_ends_at: string;
  stripe_customer_id: string | null;
}

export interface EffectivePlan {
  planId: PlanId;
  isTrial: boolean;
  trialDaysLeft: number;
  limits: PlanLimits;
}

/**
 * Plan efectivo de una cuenta.
 * Durante el trial se disfrutan los límites de Pro; al caducar cae a Free
 * sin perder datos. Un plan de pago (fijado por el webhook de Stripe) manda
 * siempre sobre el trial.
 */
export function resolvePlan(account: Pick<AccountRow, "plan" | "trial_ends_at">): EffectivePlan {
  if (account.plan === "trial") {
    const msLeft = new Date(account.trial_ends_at).getTime() - Date.now();
    const daysLeft = Number.isFinite(msLeft) ? Math.max(0, Math.ceil(msLeft / 86_400_000)) : 0;
    if (daysLeft > 0) {
      return { planId: "pro", isTrial: true, trialDaysLeft: daysLeft, limits: PLANS.pro.limits };
    }
    return { planId: "free", isTrial: false, trialDaysLeft: 0, limits: PLANS.free.limits };
  }

  const plan = PLANS[account.plan] ?? PLANS.free;
  return { planId: plan.id, isTrial: false, trialDaysLeft: 0, limits: plan.limits };
}

/** Cuenta por defecto para usuarios sin fila en `accounts` (no debería ocurrir). */
export const FALLBACK_ACCOUNT: Pick<AccountRow, "plan" | "trial_ends_at"> = {
  plan: "free",
  trial_ends_at: new Date(0).toISOString(),
};

// ── Mapeo plan+ciclo → price id de Stripe ──────────────────────────────────
const PRICE_ENV_KEYS: Record<Exclude<PlanId, "free">, Record<BillingCycle, string>> = {
  pro: { monthly: "STRIPE_PRICE_PRO_MONTHLY", annual: "STRIPE_PRICE_PRO_ANNUAL" },
  agency: { monthly: "STRIPE_PRICE_AGENCY_MONTHLY", annual: "STRIPE_PRICE_AGENCY_ANNUAL" },
};

export function priceIdFor(plan: Exclude<PlanId, "free">, cycle: BillingCycle): string | undefined {
  const key = PRICE_ENV_KEYS[plan][cycle];
  return process.env[key]?.trim() || undefined;
}

/** Resuelve el plan y ciclo a partir de un price id (para el webhook). */
export function planFromPriceId(priceId: string): { plan: PlanId; cycle: BillingCycle } | null {
  for (const plan of ["pro", "agency"] as const) {
    for (const cycle of ["monthly", "annual"] as const) {
      if (priceIdFor(plan, cycle) === priceId) return { plan, cycle };
    }
  }
  return null;
}
