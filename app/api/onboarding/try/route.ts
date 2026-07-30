// app/api/onboarding/try/route.ts
// ============================================================================
// POST /api/onboarding/try
//
// El paso que produce el primer resultado real: crea la campaña del usuario si
// no existe, añade una empresa y ejecuta la investigación completa.
//
// DECISIÓN: la campaña que se crea aquí es REAL, no un sandbox. Cuando el
// usuario termina el recorrido ya tiene una campaña operativa con su propuesta
// de valor dentro, en lugar de un juguete que hay que rehacer. Reducir pasos
// futuros es más valioso que aislar la prueba.
//
// Un fallo de investigación NO es un error de esta ruta: es la característica
// que diferencia al producto. Se devuelve 200 con el motivo para que la
// interfaz pueda explicarlo como lo que es.
// ============================================================================

import { z } from "zod";
import { authedRoute, fromDbError } from "@/lib/api/handler";
import { companyUrlSchema } from "@/lib/validation/schemas";
import { researchAndDraft } from "@/lib/agent/graph";
import { loadOnboarding, markMilestone, recordStep } from "@/lib/onboarding/service";
import { assertCanCreateCampaign, loadAccount } from "@/lib/billing/account";
import { errors } from "@/lib/errors";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const trySchema = z
  .object({
    companyUrl: companyUrlSchema.refine((v) => v.length > 0, "Necesitamos la web de la empresa"),
    companyName: z.string().trim().max(300).optional(),
    startedAt: z.string().datetime().optional(),
  })
  .strict();

/** Nombre legible a partir del dominio cuando el usuario no lo indica. */
function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Empresa";
  }
}

export const POST = authedRoute(
  { event: "onboarding.try", body: trySchema, rateLimit: "ai" },
  async ({ body, db, user, log }) => {
    const onboarding = await loadOnboarding(db, user.id);

    const valueProposition = onboarding.valueProposition?.trim();
    if (!valueProposition) {
      throw errors.validation(
        "Antes de investigar necesitamos saber qué vendes: es lo único que el agente no puede deducir leyendo la web de otra empresa."
      );
    }

    await recordStep(user.id, "first_company_submitted", { startedAt: body.startedAt });

    // ── Campaña: se reutiliza la real si ya existe ──────────────────────────
    const { data: existing } = await db
      .from("campaigns")
      .select("id, sender_name, sender_email")
      .eq("user_id", user.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let campaignId = existing?.id;

    if (!campaignId) {
      const account = await loadAccount(db, user.id);
      assertCanCreateCampaign(account);

      const { data: created, error } = await db
        .from("campaigns")
        .insert({
          user_id: user.id,
          name: "Mi primera campaña",
          value_proposition: valueProposition,
          // El remitente se configura más tarde, cuando el usuario verifique
          // su dominio: pedirlo ahora bloquearía el recorrido.
          sender_name: user.email?.split("@")[0] ?? "",
          sender_email: "",
          base_template: "",
        })
        .select("id")
        .single();

      if (error || !created) throw fromDbError(error ?? { message: "sin datos" }, "la campaña");

      campaignId = created.id;
      await markMilestone(user.id, "first_campaign_at");
      log.info("onboarding.campaign_created", { campaignId });
    }

    // ── Lead ────────────────────────────────────────────────────────────────
    const companyName = body.companyName?.trim() || nameFromUrl(body.companyUrl);

    const { data: lead, error: leadError } = await db
      .from("leads")
      .insert({
        campaign_id: campaignId,
        company_name: companyName,
        company_url: body.companyUrl,
        status: "pending",
      })
      .select("id, company_name")
      .single();

    if (leadError || !lead) throw fromDbError(leadError ?? { message: "sin datos" }, "el lead");

    await markMilestone(user.id, "first_lead_at");
    await recordStep(user.id, "research_started", { startedAt: body.startedAt });

    // ── Investigación ───────────────────────────────────────────────────────
    const result = await researchAndDraft({ leadId: lead.id, db });
    await markMilestone(user.id, "first_research_at");

    if (result.status === "research_failed") {
      // No es un fallo de la petición: es el producto haciendo su trabajo.
      // El motivo se devuelve para que la interfaz lo explique como la
      // garantía que es.
      await recordStep(user.id, "research_failed", {
        startedAt: body.startedAt,
        // Se guarda una categoría, nunca el texto ni la empresa del usuario
        detail: { reason: result.error?.slice(0, 60).includes("Scraping") ? "scraping" : "sin_gancho" },
      });

      log.info("onboarding.research_failed", { leadId: lead.id });

      return {
        outcome: "no_hook" as const,
        campaignId,
        leadId: lead.id,
        companyName: lead.company_name,
        reason: result.error ?? "No se encontró información aprovechable en su web.",
      };
    }

    await markMilestone(user.id, "first_draft_at");
    await recordStep(user.id, "research_succeeded", { startedAt: body.startedAt });

    // Los datos de la investigación se devuelven junto al borrador: enseñar el
    // porqué del email es lo que demuestra que no está inventado.
    const { data: enriched } = await db
      .from("leads")
      .select("research_sector, research_size, research_pain_point, research_decision_maker")
      .eq("id", lead.id)
      .maybeSingle();

    log.info("onboarding.draft_ready", { leadId: lead.id, words: result.draft?.wordCount });

    return {
      outcome: "drafted" as const,
      campaignId,
      leadId: lead.id,
      companyName: lead.company_name,
      research: {
        sector: enriched?.research_sector ?? null,
        size: enriched?.research_size ?? null,
        painPoint: enriched?.research_pain_point ?? null,
        decisionMaker: enriched?.research_decision_maker ?? null,
      },
      draft: result.draft,
    };
  }
);
