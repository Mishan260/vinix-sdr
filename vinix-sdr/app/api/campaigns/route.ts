// app/api/campaigns/route.ts
// ============================================================================
// GET  /api/campaigns → campañas del usuario en sesión
// POST /api/campaigns → crea campaña, aplicando el límite del plan
//
// El aislamiento entre cuentas lo garantiza RLS: `db` es el cliente con la
// sesión del usuario, así que un SELECT sin filtros sólo devuelve lo suyo.
// ============================================================================

import { authedRoute, fromDbError } from "@/lib/api/handler";
import { createCampaignSchema } from "@/lib/validation/schemas";
import { assertCanCreateCampaign, loadAccount } from "@/lib/billing/account";

export const dynamic = "force-dynamic";

export const GET = authedRoute({ event: "campaigns.list", rateLimit: "read" }, async ({ db }) => {
  const { data, error } = await db
    .from("campaigns")
    .select("id, name, value_proposition, sender_name, sender_email, status, created_at")
    .order("created_at", { ascending: false });

  if (error) throw fromDbError(error, "las campañas");
  return { campaigns: data ?? [] };
});

export const POST = authedRoute(
  { event: "campaigns.create", body: createCampaignSchema, rateLimit: "mutation" },
  async ({ body, db, user, log }) => {
    const state = await loadAccount(db, user.id);
    assertCanCreateCampaign(state);

    const { data, error } = await db
      .from("campaigns")
      .insert({ ...body, user_id: user.id })
      .select("id, name")
      .single();

    if (error) throw fromDbError(error, "la campaña");

    log.info("campaigns.created", { campaignId: data.id });
    return Response.json({ campaign: data }, { status: 201 });
  }
);
