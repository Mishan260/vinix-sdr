// lib/agent/followups.ts
// ============================================================================
// Servicio de follow-ups: elige leads elegibles, genera el mensaje y lo envía.
//
// Se usa desde dos sitios con reglas distintas de autorización:
//   • /api/agent/followups (POST) — un usuario, sus campañas, cliente con RLS
//   • Vercel Cron — todas las cuentas, service role
// Por eso recibe el cliente y el ámbito como parámetros, en vez de decidirlos.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { completeJSON } from "./llm";
import { FOLLOW_UP_PROMPT } from "./prompts";
import { sendColdEmail } from "./tools/email";
import { createServiceClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export interface FollowUpReport {
  processed: number;
  sent: number;
  closed: number;
  skipped: string[];
}

interface CampaignRow {
  id: string;
  name: string;
  sender_name: string;
  sender_email: string;
  daily_send_limit: number;
  followups_enabled: boolean;
  followup_delay_days: number;
  followup_max_touches: number;
}

/** Cuántos follow-ups están listos para enviarse en una campaña. */
export async function countDueFollowUps(db: SupabaseClient, campaignId: string): Promise<number> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("followups_enabled, followup_delay_days, followup_max_touches")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign?.followups_enabled) return 0;

  const cutoff = new Date(Date.now() - campaign.followup_delay_days * 86_400_000).toISOString();

  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .lt("follow_ups_sent", campaign.followup_max_touches)
    .lt("last_contacted_at", cutoff);

  return count ?? 0;
}

export async function runFollowUps(
  db: SupabaseClient,
  options: { campaignIds?: string[]; userId?: string } = {}
): Promise<FollowUpReport> {
  const log = logger.child({ event: "agent.followups", userId: options.userId });
  const report: FollowUpReport = { processed: 0, sent: 0, closed: 0, skipped: [] };

  let query = db
    .from("campaigns")
    .select("id, name, sender_name, sender_email, daily_send_limit, followups_enabled, followup_delay_days, followup_max_touches")
    .eq("status", "active")
    .eq("followups_enabled", true);

  if (options.campaignIds?.length) query = query.in("id", options.campaignIds);

  const { data: campaigns, error } = await query;
  if (error) throw error;

  // Supresión global: quien pidió no ser contactado no recibe follow-ups
  // de ninguna cuenta. Requiere service role para cruzar tenants.
  const admin = createServiceClient();
  const { data: suppressed } = await admin
    .from("leads")
    .select("contact_email")
    .eq("status", "not_interested")
    .not("contact_email", "is", null)
    .limit(50_000);
  const suppression = new Set((suppressed ?? []).map((l) => String(l.contact_email).toLowerCase()));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const campaign of (campaigns ?? []) as CampaignRow[]) {
    const { count: sentToday } = await db
      .from("emails_sent")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .gte("sent_at", todayStart.toISOString());

    let budget = Math.max(0, campaign.daily_send_limit - (sentToday ?? 0));
    if (budget === 0) {
      report.skipped.push(`${campaign.name}: límite diario alcanzado`);
      continue;
    }

    const cutoff = new Date(Date.now() - campaign.followup_delay_days * 86_400_000).toISOString();

    const { data: dueLeads } = await db
      .from("leads")
      .select("id, company_name, contact_email, follow_ups_sent, research_pain_point")
      .eq("campaign_id", campaign.id)
      .eq("status", "sent")
      .lt("last_contacted_at", cutoff)
      .order("last_contacted_at", { ascending: true })
      .limit(50);

    for (const lead of dueLeads ?? []) {
      if (budget === 0) break;
      report.processed++;

      if (!lead.contact_email || suppression.has(String(lead.contact_email).toLowerCase())) {
        report.skipped.push(`${lead.company_name}: en lista de supresión`);
        continue;
      }

      // Secuencia agotada: cerrar con elegancia en vez de insistir
      if (lead.follow_ups_sent >= campaign.followup_max_touches) {
        await db.from("leads").update({ status: "out_of_scope" }).eq("id", lead.id);
        report.closed++;
        continue;
      }

      const { data: lastEmail } = await db
        .from("emails_sent")
        .select("subject, body")
        .eq("lead_id", lead.id)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastEmail) {
        report.skipped.push(`${lead.company_name}: sin email original registrado`);
        continue;
      }

      let followUp: { body: string };
      try {
        followUp = await completeJSON<{ body: string }>({
          system: FOLLOW_UP_PROMPT,
          temperature: 0.6,
          context: "followUp",
          user: [
            `EMPRESA: ${lead.company_name}`,
            `DOLOR DETECTADO: ${lead.research_pain_point ?? "no disponible"}`,
            `EMAIL ANTERIOR (asunto: ${lastEmail.subject}):\n${lastEmail.body}`,
            `NÚMERO DE FOLLOW-UP: ${lead.follow_ups_sent + 1} de ${campaign.followup_max_touches}`,
            `FIRMA CON: ${campaign.sender_name}`,
          ].join("\n\n"),
        });
      } catch (err) {
        report.skipped.push(`${lead.company_name}: la IA falló`);
        log.warn("agent.followups.ai_failed", { leadId: lead.id, error: err });
        continue;
      }

      if (!followUp.body?.trim()) {
        report.skipped.push(`${lead.company_name}: la IA devolvió un mensaje vacío`);
        continue;
      }

      const subject = lastEmail.subject.startsWith("Re: ") ? lastEmail.subject : `Re: ${lastEmail.subject}`;

      const sendResult = await sendColdEmail({
        to: lead.contact_email,
        subject,
        body: followUp.body,
        fromName: campaign.sender_name,
        fromEmail: campaign.sender_email,
      });

      if (!sendResult.success) {
        report.skipped.push(`${lead.company_name}: envío falló`);
        log.warn("agent.followups.send_failed", { leadId: lead.id, reason: sendResult.error });
        continue;
      }

      await db.from("emails_sent").insert({
        lead_id: lead.id,
        campaign_id: campaign.id,
        subject,
        body: followUp.body,
        provider: "resend",
        provider_message_id: sendResult.providerMessageId,
        word_count: followUp.body.trim().split(/\s+/).length,
      });

      await db
        .from("leads")
        .update({
          follow_ups_sent: lead.follow_ups_sent + 1,
          last_contacted_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      report.sent++;
      budget--;
    }
  }

  log.info("agent.followups.done", { sent: report.sent, closed: report.closed, processed: report.processed });
  return report;
}
