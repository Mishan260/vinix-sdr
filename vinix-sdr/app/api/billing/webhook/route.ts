// app/api/billing/webhook/route.ts
// ============================================================================
// POST /api/billing/webhook — eventos de Stripe.
//
// ÚNICO lugar donde se concede o revoca un plan de pago. Garantías:
//
//   • Firma verificada con STRIPE_WEBHOOK_SECRET antes de leer nada.
//   • Idempotente: claim_webhook_event() reserva el evento por su id; un
//     reintento de Stripe sobre un evento ya procesado no vuelve a aplicarlo.
//   • Tolerante a fallos: si el procesamiento revienta, se marca 'failed' y se
//     devuelve 500 para que Stripe reintente (hasta 3 días).
//   • Service role: el webhook no tiene sesión de usuario, así que escribe
//     saltándose RLS a propósito.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { getStripe, syncSubscription } from "@/lib/billing/stripe";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";

// El cuerpo debe llegar crudo para poder verificar la firma
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Eventos que nos interesan. El resto se marca 'ignored' y se responde 200
// para que Stripe deje de reintentarlo.
const HANDLED = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const log = logger.child({ requestId, event: "stripe.webhook" });

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    log.error("stripe.webhook.not_configured");
    return NextResponse.json({ error: "Webhook de Stripe no configurado" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Falta la cabecera stripe-signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    // Firma inválida: puede ser un atacante intentando otorgarse un plan
    log.warn("stripe.webhook.invalid_signature", { error });
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  const db = createServiceClient();
  const scoped = logger.child({ requestId, event: "stripe.webhook", stripeEventId: event.id, type: event.type });

  if (!HANDLED.has(event.type)) {
    scoped.debug("stripe.webhook.ignored");
    return NextResponse.json({ received: true, status: "ignored" });
  }

  // ── Reserva atómica: evita procesar dos veces el mismo evento ─────────────
  const { data: claimed, error: claimError } = await db.rpc("claim_webhook_event", {
    p_id: event.id,
    p_provider: "stripe",
    p_event_type: event.type,
    p_payload: null, // el payload completo puede contener PII; guardamos sólo el id
  });

  if (claimError) {
    scoped.error("stripe.webhook.claim_failed", { error: claimError });
    return NextResponse.json({ error: "No se pudo registrar el evento" }, { status: 500 });
  }

  if (!claimed) {
    scoped.info("stripe.webhook.duplicate");
    return NextResponse.json({ received: true, status: "duplicate" });
  }

  try {
    await handleEvent(db, event, scoped);
    await db.rpc("complete_webhook_event", { p_id: event.id, p_status: "processed" });
    return NextResponse.json({ received: true, status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    scoped.error("stripe.webhook.failed", { error });
    await db.rpc("complete_webhook_event", { p_id: event.id, p_status: "failed", p_error: message });
    // 500 → Stripe reintenta con backoff. El evento queda 'failed' y
    // claim_webhook_event permitirá reclamarlo de nuevo.
    return NextResponse.json({ error: "Procesamiento fallido" }, { status: 500 });
  }
}

/**
 * Id de la suscripción asociada a una factura.
 * La API movió este campo: en versiones antiguas era `invoice.subscription`;
 * desde 2025-03 vive en `invoice.parent.subscription_details.subscription`.
 * Se comprueban ambas para que un cambio de versión no rompa los cobros.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;

  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  }).parent;

  const current = parent?.subscription_details?.subscription;
  if (current) return typeof current === "string" ? current : current.id;

  return null;
}

async function handleEvent(
  db: ReturnType<typeof createServiceClient>,
  event: Stripe.Event,
  log: ReturnType<typeof logger.child>
): Promise<void> {
  const stripe = getStripe();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) {
        log.info("stripe.checkout.not_subscription");
        return;
      }

      // Recuperamos la suscripción completa: el objeto de la sesión no trae
      // el estado ni las fechas del periodo.
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // client_reference_id es el enlace fiable con nuestro usuario
      if (session.client_reference_id && !subscription.metadata?.supabase_user_id) {
        await stripe.subscriptions.update(subscriptionId, {
          metadata: { ...subscription.metadata, supabase_user_id: session.client_reference_id },
        });
        subscription.metadata = { ...subscription.metadata, supabase_user_id: session.client_reference_id };
      }

      await syncSubscription(db, subscription);
      log.info("stripe.checkout.completed", { subscriptionId });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(db, event.data.object as Stripe.Subscription);
      return;
    }

    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdOf(invoice);

      if (!subscriptionId) return;

      // Releemos la suscripción: Stripe ya ha actualizado su status
      // ('past_due' tras un fallo, 'active' tras un cobro correcto).
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscription(db, subscription);

      if (event.type === "invoice.payment_failed") {
        log.warn("stripe.payment_failed", {
          subscriptionId,
          attemptCount: invoice.attempt_count,
          customerEmail: invoice.customer_email ? "[REDACTADO]" : null,
        });
      }
      return;
    }

    default:
      return;
  }
}
