// lib/billing/account.ts
// ============================================================================
// Servicio de cuenta: plan efectivo, uso del mes y comprobación de límites.
//
// Centralizar esto evita el patrón que había antes — cada ruta repetía la
// consulta a `account`, el resolvePlan y su propia idea de qué es "el mes en
// curso". Un cambio de política tenía que replicarse en 4 sitios.
// ============================================================================

import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  resolvePlan,
  FALLBACK_ACCOUNT,
  type AccountRow,
  type EffectivePlan,
  type PlanLimits,
} from "./plans";

export interface AccountUsage {
  campaigns: number;
  leadsThisMonth: number;
}

export interface AccountState {
  effective: EffectivePlan;
  usage: AccountUsage;
  stripeCustomerId: string | null;
  /** true si nunca ha tenido una suscripción de pago (elegible para trial). */
  eligibleForTrial: boolean;
}

/**
 * Inicio del mes natural en curso, en UTC.
 *
 * El recuento de leads del mes lo hace ahora Postgres dentro de
 * `account_overview()`, pero esta función define la convención que esa consulta
 * debe reproducir (`date_trunc('month', now() at time zone 'UTC')`). Los tests
 * la usan para fijar el límite esperado: si alguien cambia la zona horaria en
 * el SQL, el desajuste se detecta aquí.
 */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Plan efectivo y uso del mes de un usuario.
 *
 * RENDIMIENTO: una única llamada a la función SQL `account_overview`
 * (migración 0006). La versión anterior hacía 5 round-trips —uno de ellos
 * duplicado sobre `campaigns`— y esta función se invoca en 5 endpoints, así
 * que su coste multiplicaba todo el tráfico de escritura de la plataforma.
 *
 * El recuento de leads del mes se resuelve en Postgres con un join sobre
 * `campaigns`, lo que además elimina el patrón `.in("campaign_id", [...ids])`
 * que metía cientos de UUID en la query string y podía exceder el límite de
 * longitud de la URL en cuentas con muchas campañas.
 */
export async function loadAccount(db: TypedSupabaseClient, userId: string): Promise<AccountState> {
  const { data, error } = await db.rpc("account_overview", { p_user_id: userId });

  if (error) {
    logger.error("billing.account.overview_failed", {
      userId,
      dbError: error.message,
      dbErrorCode: error.code,
      solucion: "aplicar supabase/migrations/0006_account_overview.sql",
    });
    throw errors.internal(error);
  }

  // La función devuelve siempre exactamente una fila (LEFT JOIN sobre un ancla)
  const overview = Array.isArray(data) ? data[0] : data;

  if (!overview) {
    logger.error("billing.account.overview_empty", {
      userId,
      impacto: "no se pudo determinar el plan; se aplica el más restrictivo",
    });
    return {
      effective: resolvePlan(FALLBACK_ACCOUNT),
      usage: { campaigns: 0, leadsThisMonth: 0 },
      stripeCustomerId: null,
      eligibleForTrial: true,
    };
  }

  // `plan` llega como 'free' cuando no existe fila en `accounts`. Distinguir
  // ese caso importa: significa que el alta automática no se ejecutó, y sin
  // aviso se traduce en un 402 "no puedes crear campañas" indescifrable.
  if (!overview.stripe_customer_id && overview.plan === "free" && overview.campaigns_count > 0) {
    logger.warn("billing.account.possibly_missing_row", {
      userId,
      campaigns: overview.campaigns_count,
      impacto: "plan Free con campañas ya creadas; revisar que exista la fila en accounts",
    });
  }

  const account: Pick<AccountRow, "plan" | "trial_ends_at"> = {
    plan: overview.plan as AccountRow["plan"],
    trial_ends_at: overview.trial_ends_at,
  };

  return {
    effective: resolvePlan(account),
    usage: {
      campaigns: overview.campaigns_count ?? 0,
      leadsThisMonth: overview.leads_this_month ?? 0,
    },
    stripeCustomerId: overview.stripe_customer_id ?? null,
    eligibleForTrial: !overview.has_subscription,
  };
}

// ── Comprobaciones de límite: lanzan AppError 402 con mensaje accionable ────
export function assertCanCreateCampaign(state: AccountState): void {
  if (state.usage.campaigns >= state.effective.limits.campaigns) {
    const limit = state.effective.limits.campaigns;
    throw errors.planLimit(
      `Tu plan permite ${limit === Infinity ? "campañas ilimitadas" : `${limit} campaña${limit === 1 ? "" : "s"}`}. ` +
        `Amplía tu plan para crear más.`
    );
  }
}

export function assertFeature(limits: PlanLimits, feature: keyof PlanLimits, label: string): void {
  if (!limits[feature]) {
    throw errors.planLimit(`${label} es una función del plan Pro. Actívalo desde la página de precios.`);
  }
}

export function remainingLeadQuota(state: AccountState): number {
  return Math.max(0, state.effective.limits.leadsPerMonth - state.usage.leadsThisMonth);
}

/** Serialización estable para el cliente (Infinity no sobrevive a JSON). */
export function serializeAccount(state: AccountState) {
  return {
    plan: state.effective.planId,
    isTrial: state.effective.isTrial,
    trialDaysLeft: state.effective.trialDaysLeft,
    limits: {
      campaigns: state.effective.limits.campaigns === Infinity ? null : state.effective.limits.campaigns,
      leadsPerMonth: state.effective.limits.leadsPerMonth,
      followUps: state.effective.limits.followUps,
      csvExport: state.effective.limits.csvExport,
    },
    usage: state.usage,
    hasBillingAccount: Boolean(state.stripeCustomerId),
    eligibleForTrial: state.eligibleForTrial,
  };
}
