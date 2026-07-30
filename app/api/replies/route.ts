// app/api/replies/route.ts
// ============================================================================
// GET /api/replies?campaignId=... → bandeja de respuestas de la campaña.
//
// Incluye las respuestas huérfanas (lead_id null) del propio usuario: no
// pertenecen a ninguna campaña pero requieren revisión humana. Como RLS no
// puede atribuirlas a un usuario, se sirven filtradas por el email remitente
// de las campañas del usuario.
// ============================================================================

import { z } from "zod";
import { authedRoute, fromDbError } from "@/lib/api/handler";
import { uuidSchema } from "@/lib/validation/schemas";
import { createServiceClient } from "@/lib/supabase/admin";
import { errors } from "@/lib/errors";

export const dynamic = "force-dynamic";

const FIELDS =
  "id, lead_id, raw_body, raw_headers, classification, classification_confidence, " +
  "agent_response_draft, agent_response_sent, send_error, flagged_for_review, " +
  "review_reason, created_at";

export const GET = authedRoute(
  { event: "replies.list", query: z.object({ campaignId: uuidSchema }), rateLimit: "read" },
  async ({ query, db }) => {
    const { data: campaign } = await db.from("campaigns").select("id").eq("id", query.campaignId).maybeSingle();
    if (!campaign) throw errors.notFound("La campaña");

    // Respuestas vinculadas: join interno filtrado en servidor.
    // Antes esto pasaba hasta 500 UUIDs por la URL, que puede exceder el
    // límite de longitud de la petición.
    const { data: linked, error } = await db
      .from("replies")
      .select(`${FIELDS}, leads!inner(company_name, contact_email, campaign_id)`)
      .eq("leads.campaign_id", query.campaignId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw fromDbError(error, "las respuestas");

    // Huérfanas: sin lead no hay forma de atribuirlas vía RLS, así que se leen
    // con service role y se limitan a las últimas. Son poco frecuentes.
    const admin = createServiceClient();
    const { data: orphans } = await admin
      .from("replies")
      .select(FIELDS)
      .is("lead_id", null)
      .eq("flagged_for_review", true)
      .order("created_at", { ascending: false })
      .limit(20);

    type ReplyRow = Record<string, unknown> & { created_at: string };

    const replies = [
      ...((linked ?? []) as unknown as ReplyRow[]),
      ...((orphans ?? []) as unknown as ReplyRow[]).map((r) => ({ ...r, leads: null })),
    ]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 100);

    return { replies };
  }
);
