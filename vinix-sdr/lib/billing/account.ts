// lib/billing/account.ts
// ============================================================================
// Servicio de cuenta: plan efectivo, uso del mes y comprobación de límites.
//
// Centralizar esto evita el patrón que había antes — cada ruta repetía la
// consulta a `account`, el resolvePlan y su propia idea de qué es "el mes en
// curso". Un cambio de política tenía que replicarse en 4 sitios.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/errors";
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

/** Inicio del mes natural en curso, en UTC. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function loadAccount(db: SupabaseClient, userId: string): Promise<AccountState> {
  const [accountResult, campaignsResult, leadsResult, subscriptionResult] = await Promise.all([
    db.from("accounts").select("user_id, plan, billing_cycle, trial_ends_at, stripe_customer_id").eq("user_id", userId).maybeSingle(),
    db.from("campaigns").select("id", { count: "exact", head: true }).eq("user_id", userId),
    countLeadsThisMonth(db, userId),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  const account = (accountResult.data as AccountRow | null) ?? null;

  return {
    effective: resolvePlan(account ?? FALLBACK_ACCOUNT),
    usage: {
      campaigns: campaignsResult.count ?? 0,
      leadsThisMonth: leadsResult,
    },
    stripeCustomerId: account?.stripe_customer_id ?? null,
    eligibleForTrial: (subscriptionResult.count ?? 0) === 0,
  };
}

/**
 * Leads creados este mes por el usuario.
 * Se cuenta con un join implícito sobre campaigns porque `leads` no guarda
 * user_id: la propiedad es transitiva a través de la campaña.
 */
async function countLeadsThisMonth(db: SupabaseClient, userId: string): Promise<number> {
  const { data: campaigns } = await db.from("campaigns").select("id").eq("user_id", userId);
  const ids = (campaigns ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;

  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .in("campaign_id", ids)
    .gte("created_at", monthStart().toISOString());

  return count ?? 0;
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
