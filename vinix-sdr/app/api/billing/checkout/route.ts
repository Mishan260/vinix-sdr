// app/api/billing/checkout/route.ts
// ============================================================================
// POST /api/billing/checkout → { url } de Stripe Checkout.
// El plan NO se concede aquí: sólo se abre la sesión de pago. Quien concede
// el plan es el webhook, tras confirmar el cobro.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { checkoutSchema } from "@/lib/validation/schemas";
import { createCheckoutSession, ensureCustomer } from "@/lib/billing/stripe";
import { loadAccount } from "@/lib/billing/account";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/errors";

export const POST = authedRoute(
  { event: "billing.checkout", body: checkoutSchema, rateLimit: "mutation" },
  async ({ body, user, db, log }) => {
    if (!user.email) throw errors.validation("Tu cuenta no tiene email asociado.");

    const state = await loadAccount(db, user.id);
    const customerId = await ensureCustomer(db, { userId: user.id, email: user.email });

    const url = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      plan: body.plan as "pro" | "agency",
      cycle: body.cycle,
      customerId,
      siteUrl: getEnv().siteUrl,
      eligibleForTrial: state.eligibleForTrial,
    });

    log.info("billing.checkout.created", { plan: body.plan, cycle: body.cycle });
    return { url };
  }
);
