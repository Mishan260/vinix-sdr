// app/api/leads/route.ts
// ============================================================================
// GET    /api/leads?campaignId=... → pipeline del usuario
// PATCH  /api/leads?id=...         → edita un lead
// DELETE /api/leads?id=...         → elimina un lead (cascada a emails/replies)
// ============================================================================

import { z } from "zod";
import { authedRoute, fromDbError } from "@/lib/api/handler";
import { listLeadsQuerySchema, updateLeadSchema, uuidSchema } from "@/lib/validation/schemas";
import { errors } from "@/lib/errors";

export const dynamic = "force-dynamic";

const LEAD_FIELDS =
  "id, campaign_id, company_name, company_url, contact_name, contact_email, status, " +
  "research_sector, research_pain_point, research_error, draft_subject, draft_body, " +
  "follow_ups_sent, last_contacted_at, updated_at";

export const GET = authedRoute(
  { event: "leads.list", query: listLeadsQuerySchema, rateLimit: "read" },
  async ({ query, db }) => {
    let request = db.from("leads").select(LEAD_FIELDS).order("updated_at", { ascending: false }).limit(query.limit);

    if (query.campaignId) request = request.eq("campaign_id", query.campaignId);
    if (query.status) request = request.eq("status", query.status);

    const { data, error } = await request;
    if (error) throw fromDbError(error, "los leads");

    return { leads: data ?? [] };
  }
);

export const PATCH = authedRoute(
  {
    event: "leads.update",
    body: updateLeadSchema,
    query: z.object({ id: uuidSchema }),
    rateLimit: "mutation",
  },
  async ({ body, query, db }) => {
    const { resetForResearch, ...fields } = body;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      // Cadena vacía → NULL: el usuario está limpiando el campo, no guardando ""
      patch[key] = value === "" ? null : value;
    }

    if (resetForResearch) {
      patch.status = "pending";
      patch.research_error = null;
    }

    if (Object.keys(patch).length === 0) {
      throw errors.validation("No hay ningún campo que actualizar");
    }

    const { data, error } = await db.from("leads").update(patch).eq("id", query.id).select("id").maybeSingle();

    if (error) throw fromDbError(error, "el lead");
    if (!data) throw errors.notFound("El lead");

    return { status: "updated" };
  }
);

export const DELETE = authedRoute(
  { event: "leads.delete", query: z.object({ id: uuidSchema }), rateLimit: "mutation" },
  async ({ query, db }) => {
    const { data, error } = await db.from("leads").delete().eq("id", query.id).select("id").maybeSingle();

    if (error) throw fromDbError(error, "el lead");
    if (!data) throw errors.notFound("El lead");

    return { status: "deleted" };
  }
);
