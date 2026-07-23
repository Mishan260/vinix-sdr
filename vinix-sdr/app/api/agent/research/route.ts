// app/api/agent/research/route.ts
// ============================================================================
// POST /api/agent/research — pasos 1+2 sobre un lead del usuario.
// La máquina de estados vive en researchAndDraft; aquí sólo se comprueba la
// propiedad, el cupo del plan, y se traduce el resultado a HTTP.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { researchSchema } from "@/lib/validation/schemas";
import { researchAndDraft } from "@/lib/agent/graph";
import { errors } from "@/lib/errors";

export const maxDuration = 60; // scraping + 2 llamadas al LLM

export const POST = authedRoute(
  { event: "agent.research", body: researchSchema, rateLimit: "ai" },
  async ({ body, db, log }) => {
    // RLS: si el lead es de otro usuario, esto devuelve null
    const { data: lead } = await db
      .from("leads")
      .select("id, status")
      .eq("id", body.leadId)
      .maybeSingle();

    if (!lead) throw errors.notFound("El lead");

    // Evita lanzar dos investigaciones simultáneas sobre el mismo lead
    if (lead.status === "researching") {
      throw errors.conflict("Este lead ya se está investigando. Espera a que termine.");
    }

    const result = await researchAndDraft({ leadId: body.leadId, db });

    if (result.status === "research_failed") {
      // 200 deliberado: el pipeline funcionó, es el LEAD el que falló.
      // El motivo ya está registrado en la BD y se muestra en su fila.
      log.info("agent.research.lead_failed", { leadId: body.leadId, reason: result.error });
      return {
        status: "research_failed",
        error: result.error,
        note: "Lead marcado para revisión manual.",
      };
    }

    log.info("agent.research.ok", { leadId: body.leadId, words: result.draft?.wordCount });
    return { status: "ready_to_send", draft: result.draft };
  }
);
