// app/api/agent/send/route.ts
// ============================================================================
// POST /api/agent/send — aprueba y envía el borrador de un lead.
//
// Protecciones antes de enviar: propiedad (RLS), estado correcto, email
// presente, lista de supresión global y límite diario de la campaña.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { sendEmailSchema } from "@/lib/validation/schemas";
import { sendColdEmail } from "@/lib/agent/tools/email";
import { createServiceClient } from "@/lib/supabase/admin";
import { errors } from "@/lib/errors";

export const maxDuration = 30;

export const POST = authedRoute(
  { event: "agent.send", body: sendEmailSchema, rateLimit: "send" },
  async ({ body, db, log }) => {
    const { data: lead } = await db
      .from("leads")
      .select("id, campaign_id, company_name, contact_email, status, draft_subject, draft_body, campaigns(sender_name, sender_email, daily_send_limit)")
      .eq("id", body.leadId)
      .maybeSingle();

    if (!lead) throw errors.notFound("El lead");

    if (lead.status !== "ready_to_send") {
      throw errors.conflict(`El lead está en estado '${lead.status}', no tiene un borrador listo para enviar.`);
    }
    if (!lead.contact_email) {
      throw errors.validation("Este lead no tiene email de contacto. Añádelo antes de enviar.");
    }

    const subject = body.subject ?? lead.draft_subject;
    const emailBody = body.body ?? lead.draft_body;
    if (!subject || !emailBody) {
      throw errors.validation("El lead no tiene borrador guardado.");
    }

    const campaign = lead.campaigns as unknown as {
      sender_name: string;
      sender_email: string;
      daily_send_limit: number;
    } | null;

    if (!campaign?.sender_email) {
      throw errors.validation("La campaña no tiene remitente configurado.");
    }

    // ── Supresión GLOBAL: cruza tenants a propósito ─────────────────────────
    // Si alguien pidió no ser contactado, ningún usuario debe escribirle.
    const admin = createServiceClient();
    const { count: optedOut } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "not_interested")
      .ilike("contact_email", lead.contact_email);

    if ((optedOut ?? 0) > 0) {
      throw errors.conflict("Este contacto pidió no ser contactado en una campaña anterior. Envío bloqueado.");
    }

    // ── Límite diario de la campaña: protege la reputación del dominio ──────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: sentToday } = await db
      .from("emails_sent")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", lead.campaign_id)
      .gte("sent_at", todayStart.toISOString());

    const dailyLimit = campaign.daily_send_limit ?? 20;
    if ((sentToday ?? 0) >= dailyLimit) {
      throw errors.rateLimited(
        `Límite diario de ${dailyLimit} envíos alcanzado en esta campaña. El borrador queda guardado para mañana.`
      );
    }

    const result = await sendColdEmail({
      to: lead.contact_email,
      subject,
      body: emailBody,
      fromName: campaign.sender_name,
      fromEmail: campaign.sender_email,
    });

    if (!result.success) {
      log.error("agent.send.provider_failed", { leadId: lead.id, reason: result.error });
      throw errors.upstream("de email");
    }

    // El registro del envío es lo que permite vincular la respuesta entrante,
    // así que se escribe ANTES de mover el estado del lead.
    await db.from("emails_sent").insert({
      lead_id: lead.id,
      campaign_id: lead.campaign_id,
      subject,
      body: emailBody,
      provider: "resend",
      provider_message_id: result.providerMessageId,
      word_count: emailBody.trim().split(/\s+/).length,
    });

    await db
      .from("leads")
      .update({ status: "sent", last_contacted_at: new Date().toISOString() })
      .eq("id", lead.id);

    log.info("agent.send.ok", { leadId: lead.id, messageId: result.providerMessageId });
    return { status: "sent" };
  }
);
