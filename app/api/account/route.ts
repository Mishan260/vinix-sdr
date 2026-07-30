// app/api/account/route.ts
// ============================================================================
// GET /api/account → plan efectivo, límites y uso del mes del usuario en sesión.
//
// El POST que cambiaba el plan directamente se ha ELIMINADO: permitía a
// cualquiera con acceso al panel auto-otorgarse el plan Agency sin pagar.
// El cambio de plan pasa ahora por /api/billing/checkout → Stripe → webhook.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { loadAccount, serializeAccount } from "@/lib/billing/account";

export const dynamic = "force-dynamic";

export const GET = authedRoute({ event: "account.get", rateLimit: "read" }, async ({ db, user }) => {
  const state = await loadAccount(db, user.id);
  return {
    ...serializeAccount(state),
    email: user.email ?? null,
  };
});
