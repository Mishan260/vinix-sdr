// lib/billing/stripe.ts
// ============================================================================
// Integración real con Stripe: Checkout, Customer Portal y sincronización de
// suscripciones hacia la BD.
//
// REGLA DE ORO: el plan de un usuario NUNCA se cambia desde una petición del
// navegador. El cliente sólo puede abrir un Checkout; quien concede el plan es
// el webhook de Stripe, que es la única fuente que puede confirmar el cobro.
// ============================================================================

import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { TRIAL_DAYS, planFromPriceId, priceIdFor, type BillingCycle, type PlanId } from "./plans";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw errors.config(
      "STRIPE_SECRET_KEY no configurada. Añádela a .env.local (dashboard.stripe.com → Developers → API keys) y reinicia el servidor."
    );
  }
  cached = new Stripe(key, {
    // Fijar la versión evita que un cambio en el dashboard de Stripe altere la
    // forma de los objetos que este código espera.
    apiVersion: "2026-06-24.dahlia",
    typescript: true,
    maxNetworkRetries: 2, // reintentos automáticos ante fallos de red/5xx
    timeout: 20_000,
  });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

// ── Cliente de Stripe asociado al usuario ───────────────────────────────────
/**
 * Devuelve el stripe_customer_id del usuario, creándolo la primera vez.
 * Se guarda en `accounts` para que el portal y los webhooks puedan resolver
 * el usuario a partir del customer sin buscar por email (que puede cambiar).
 */
export async function ensureCustomer(
  db: SupabaseClient,
  params: { userId: string; email: string }
): Promise<string> {
  const { data: account, error } = await db
    .from("accounts")
    .select("stripe_customer_id")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) throw errors.internal(error);
  if (account?.stripe_customer_id) return account.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: params.email,
    metadata: { supabase_user_id: params.userId },
  });

  const { error: updateError } = await db
    .from("accounts")
    .update({ stripe_customer_id: customer.id })
    .eq("user_id", params.userId);

  if (updateError) {
    // El customer ya existe en Stripe pero no se pudo persistir: lo borramos
    // para no dejar clientes huérfanos acumulándose en cada reintento.
    await stripe.customers.del(customer.id).catch(() => {});
    throw errors.internal(updateError);
  }

  logger.info("stripe.customer.created", { userId: params.userId, customerId: customer.id });
  return customer.id;
}

// ── Checkout ────────────────────────────────────────────────────────────────
export interface CheckoutParams {
  userId: string;
  email: string;
  plan: Exclude<PlanId, "free">;
  cycle: BillingCycle;
  customerId: string;
  siteUrl: string;
  /** true si el usuario aún no ha consumido su trial. */
  eligibleForTrial: boolean;
}

export async function createCheckoutSession(params: CheckoutParams): Promise<string> {
  const priceId = priceIdFor(params.plan, params.cycle);
  if (!priceId) {
    throw errors.config(
      `Falta el price id de Stripe para el plan ${params.plan} (${params.cycle}). ` +
        `Créalo en Stripe → Products y añádelo a las variables de entorno.`
    );
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: params.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // client_reference_id sobrevive a todo el flujo: es como el webhook
    // identifica al usuario aunque el customer se haya creado fuera de banda.
    client_reference_id: params.userId,
    subscription_data: {
      metadata: { supabase_user_id: params.userId, plan: params.plan, cycle: params.cycle },
      ...(params.eligibleForTrial && { trial_period_days: TRIAL_DAYS }),
    },
    metadata: { supabase_user_id: params.userId, plan: params.plan, cycle: params.cycle },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    success_url: `${params.siteUrl}/dashboard?checkout=success`,
    cancel_url: `${params.siteUrl}/pricing?checkout=cancelled`,
  });

  if (!session.url) throw errors.upstream("Stripe");
  return session.url;
}

// ── Customer Portal (cancelar, cambiar tarjeta, ver facturas) ───────────────
export async function createPortalSession(customerId: string, siteUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${siteUrl}/pricing`,
  });
  return session.url;
}

// ── Sincronización suscripción → BD ─────────────────────────────────────────
function toIso(seconds: number | null | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Fechas del periodo de facturación.
 * A partir de la API 2025-03 dejaron de estar en la suscripción y viven en
 * cada item; se leen del primero, que es el único que usamos.
 */
function periodOf(subscription: Stripe.Subscription): { start: number | null; end: number | null } {
  const item = subscription.items?.data?.[0] as (Stripe.SubscriptionItem & {
    current_period_start?: number;
    current_period_end?: number;
  }) | undefined;

  return {
    start: item?.current_period_start ?? null,
    end: item?.current_period_end ?? null,
  };
}

/**
 * Refleja en `subscriptions` el estado exacto de una suscripción de Stripe.
 * El trigger sync_account_plan (migración 0003) recalcula accounts.plan.
 *
 * Idempotente: puede llamarse tantas veces como haga falta con el mismo
 * objeto y el resultado es el mismo.
 */
export async function syncSubscription(
  db: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<{ userId: string; plan: PlanId; status: string } | null> {
  const userId =
    subscription.metadata?.supabase_user_id ??
    (await resolveUserFromCustomer(db, subscription.customer));

  if (!userId) {
    logger.error("stripe.sync.user_not_found", {
      subscriptionId: subscription.id,
      customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    });
    return null;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const resolved = priceId ? planFromPriceId(priceId) : null;

  // Si el price no está en nuestro mapa (cambiado en el dashboard sin
  // actualizar el entorno), caemos a los metadatos del checkout.
  const plan = (resolved?.plan ?? (subscription.metadata?.plan as PlanId | undefined) ?? "free") as PlanId;
  const cycle = (resolved?.cycle ??
    (subscription.metadata?.cycle as BillingCycle | undefined) ??
    (item?.price?.recurring?.interval === "year" ? "annual" : "monthly")) as BillingCycle;

  if (!resolved && priceId) {
    logger.warn("stripe.sync.unknown_price", { priceId, subscriptionId: subscription.id, fallbackPlan: plan });
  }

  const period = periodOf(subscription);

  const { error } = await db.from("subscriptions").upsert(
    {
      id: subscription.id,
      user_id: userId,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripe_price_id: priceId ?? null,
      status: subscription.status,
      plan,
      billing_cycle: cycle,
      current_period_start: toIso(period.start),
      current_period_end: toIso(period.end),
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: toIso(subscription.canceled_at),
      trial_ends_at: toIso(subscription.trial_end),
    },
    { onConflict: "id" }
  );

  if (error) throw errors.internal(error);

  logger.info("stripe.sync.ok", { userId, subscriptionId: subscription.id, status: subscription.status, plan });
  return { userId, plan, status: subscription.status };
}

async function resolveUserFromCustomer(
  db: SupabaseClient,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
): Promise<string | null> {
  const customerId = typeof customer === "string" ? customer : customer.id;
  const { data } = await db.from("accounts").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}
