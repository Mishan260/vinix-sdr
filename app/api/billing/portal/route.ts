// app/api/billing/portal/route.ts
// ============================================================================
// POST /api/billing/portal → { url } del Customer Portal de Stripe.
// Desde ahí el usuario cancela, cambia de plan, actualiza la tarjeta y
// descarga facturas, sin que tengamos que construir esas pantallas.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { createPortalSession, ensureCustomer } from "@/lib/billing/stripe";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/errors";

export const POST = authedRoute({ event: "billing.portal", rateLimit: "mutation" }, async ({ user, db }) => {
  if (!user.email) throw errors.validation("Tu cuenta no tiene email asociado.");

  const customerId = await ensureCustomer(db, { userId: user.id, email: user.email });
  const url = await createPortalSession(customerId, getEnv().siteUrl);

  return { url };
});
