// app/api/agent/webhook/inbound/route.ts
// ============================================================================
// POST /api/agent/webhook/inbound — respuestas entrantes (Paso 3).
//
// Garantías:
//   • Firma Svix verificada antes de leer nada. Sin ella, cualquiera que
//     descubra la URL podría inyectar respuestas falsas y hacer que el agente
//     agende reuniones o marque leads como perdidos.
//   • Idempotente por svix-id: un reintento del proveedor no duplica la
//     respuesta ni reenvía la propuesta de horarios.
//   • El contenido del email es NO CONFIABLE: se delimita en el prompt y se
//     filtra por patrones de inyección antes de pasarlo al LLM.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { classifyReply } from "@/lib/agent/graph";
import { sendColdEmail } from "@/lib/agent/tools/email";
import { logger } from "@/lib/logger";
import { check, RATE_LIMITS } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface InboundEmail {
  fromEmail: string;
  subject: string;
  text: string;
  inReplyToMessageId: string | null;
}

const SUSPICIOUS_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous)/i,
  /you\s+are\s+now\s+a?/i,
  /system\s+prompt/i,
  /olvida\s+(tus\s+)?instrucciones/i,
  /act[úu]a\s+como\s+si/i,
];

function verifyAndNormalize(rawBody: string, headers: Headers): InboundEmail | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("RESEND_WEBHOOK_SECRET no configurado");

  const svixHeaders = {
    "svix-id": headers.get("svix-id") ?? "",
    "svix-timestamp": headers.get("svix-timestamp") ?? "",
    "svix-signature": headers.get("svix-signature") ?? "",
  };

  if (!svixHeaders["svix-id"] || !svixHeaders["svix-timestamp"] || !svixHeaders["svix-signature"]) {
    throw new Error("Faltan cabeceras de firma Svix");
  }

  // Lanza si la firma no valida
  const payload = new Webhook(secret).verify(rawBody, svixHeaders) as {
    type: string;
    data: { from?: string; subject?: string; text?: string; headers?: Record<string, string> };
  };

  if (payload.type !== "email.received" && payload.type !== "email.replied") return null;

  return {
    fromEmail: payload.data.from ?? "",
    subject: payload.data.subject ?? "",
    text: payload.data.text ?? "",
    inReplyToMessageId: payload.data.headers?.["in-reply-to"]?.replace(/[<>]/g, "").trim() || null,
  };
}

function getNextTwoBusinessSlots(): [string, string] {
  const slots: string[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() + 1);

  while (slots.length < 2) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const label = cursor.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      slots.push(`${label} a las ${slots.length === 0 ? "10:00" : "16:00"} (CET)`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots as [string, string];
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const log = logger.child({ requestId, event: "webhook.inbound" });

  // Rate limit por IP: la firma es cara de verificar, no queremos gastar CPU
  // en una avalancha de peticiones no firmadas.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!check(`inbound:${ip}`, RATE_LIMITS.webhook).allowed) {
    return NextResponse.json({ error: "Rate limit excedido" }, { status: 429 });
  }

  const rawBody = await req.text();
  if (!rawBody.trim()) {
    return NextResponse.json({ error: "Cuerpo vacío" }, { status: 400 });
  }

  let inbound: InboundEmail | null;
  try {
    inbound = verifyAndNormalize(rawBody, req.headers);
  } catch (error) {
    log.warn("webhook.inbound.verification_failed", { error });
    return NextResponse.json({ error: "Verificación fallida" }, { status: 401 });
  }

  // Evento válido pero irrelevante (email.delivered, etc.): 200 para que el
  // proveedor deje de reintentarlo.
  if (!inbound) return NextResponse.json({ status: "ignored" });

  if (!inbound.text.trim()) {
    return NextResponse.json({ status: "empty_email" });
  }

  const db = createServiceClient();
  const eventId = req.headers.get("svix-id")!;

  // ── Idempotencia: un reintento no vuelve a clasificar ni a responder ──────
  const { data: claimed, error: claimError } = await db.rpc("claim_webhook_event", {
    p_id: eventId,
    p_provider: "resend",
    p_event_type: "email.received",
    p_payload: null,
  });

  if (claimError) {
    log.error("webhook.inbound.claim_failed", { error: claimError });
    return NextResponse.json({ error: "No se pudo registrar el evento" }, { status: 500 });
  }
  if (!claimed) {
    log.info("webhook.inbound.duplicate", { eventId });
    return NextResponse.json({ status: "duplicate" });
  }

  try {
    const result = await processInbound(db, inbound, log);
    await db.rpc("complete_webhook_event", { p_id: eventId, p_status: "processed" });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    log.error("webhook.inbound.failed", { error });
    await db.rpc("complete_webhook_event", { p_id: eventId, p_status: "failed", p_error: message });
    return NextResponse.json({ error: "Procesamiento fallido" }, { status: 500 });
  }
}

async function processInbound(
  db: ReturnType<typeof createServiceClient>,
  inbound: InboundEmail,
  log: ReturnType<typeof logger.child>
): Promise<{ status: string; classification?: string }> {
  const headers = { from: inbound.fromEmail, subject: inbound.subject };

  // ── Filtro de inyección de prompts ───────────────────────────────────────
  if (SUSPICIOUS_PATTERNS.some((p) => p.test(inbound.text))) {
    log.warn("webhook.inbound.suspicious");
    await db.from("replies").insert({
      lead_id: null,
      raw_body: inbound.text,
      raw_headers: headers,
      classification: "unclear",
      classification_confidence: 0,
      flagged_for_review: true,
      review_reason: "suspicious_content",
    });
    return { status: "flagged_for_review" };
  }

  // ── Vinculación con el envío original ────────────────────────────────────
  let original = null;
  if (inbound.inReplyToMessageId) {
    const { data, error } = await db
      .from("emails_sent")
      .select("id, lead_id, body, leads(company_name, contact_email), campaigns(sender_name, sender_email)")
      .eq("provider_message_id", inbound.inReplyToMessageId)
      .maybeSingle();

    if (error) throw error;
    original = data;
  }

  if (!original) {
    await db.from("replies").insert({
      lead_id: null,
      raw_body: inbound.text,
      raw_headers: headers,
      classification: "unclear",
      classification_confidence: 0,
      flagged_for_review: true,
      review_reason: "orphaned_reply",
    });
    return { status: "orphaned" };
  }

  const lead = original.leads as unknown as { company_name: string; contact_email: string };
  const sender = original.campaigns as unknown as { sender_name: string; sender_email: string } | null;
  const slots = getNextTwoBusinessSlots();

  // ── Clasificación ────────────────────────────────────────────────────────
  let classification;
  try {
    classification = await classifyReply({
      replyText: inbound.text,
      companyName: lead.company_name,
      originalEmailBody: original.body,
      availableSlots: slots,
    });
  } catch (error) {
    // La IA fallando no debe romper el webhook: se guarda para revisión y el
    // lead pasa a 'replied' para que el humano lo vea en el panel.
    log.warn("webhook.inbound.classify_failed", { error });
    await db.from("replies").insert({
      lead_id: original.lead_id,
      email_sent_id: original.id,
      raw_body: inbound.text,
      raw_headers: headers,
      classification: "unclear",
      classification_confidence: 0,
      flagged_for_review: true,
      review_reason: "ai_classification_failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
    await db.from("leads").update({ status: "replied" }).eq("id", original.lead_id);
    return { status: "ai_failed" };
  }

  const { data: replyRow, error: insertError } = await db
    .from("replies")
    .insert({
      lead_id: original.lead_id,
      email_sent_id: original.id,
      raw_body: inbound.text,
      raw_headers: headers,
      classification: classification.classification,
      classification_confidence: classification.confidence,
      agent_response_draft: classification.suggested_response,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  const STATUS_BY_CLASSIFICATION: Record<string, string> = {
    interested: "interested",
    not_interested: "not_interested",
    out_of_scope: "out_of_scope",
    unclear: "replied",
  };

  await db
    .from("leads")
    .update({ status: STATUS_BY_CLASSIFICATION[classification.classification] })
    .eq("id", original.lead_id);

  // ── Auto-respuesta: sólo con interés claro y alta confianza ──────────────
  const CONFIDENCE_THRESHOLD = 0.75;
  if (
    classification.classification === "interested" &&
    classification.confidence >= CONFIDENCE_THRESHOLD &&
    classification.suggested_response
  ) {
    const sendResult = await sendColdEmail({
      to: lead.contact_email,
      subject: inbound.subject.startsWith("Re: ") ? inbound.subject : `Re: ${inbound.subject}`,
      body: classification.suggested_response,
      fromName: sender?.sender_name || undefined,
      fromEmail: sender?.sender_email || undefined,
    });

    if (sendResult.success) {
      await db.from("replies").update({ agent_response_sent: true }).eq("id", replyRow.id);
      await db.from("leads").update({ status: "meeting_booked" }).eq("id", original.lead_id);
    } else {
      // El envío fallido no invalida la clasificación: se registra el motivo
      // y el borrador queda visible en el panel para enviarlo a mano.
      log.warn("webhook.inbound.autoreply_failed", { reason: sendResult.error });
      await db
        .from("replies")
        .update({ agent_response_sent: false, send_error: sendResult.error })
        .eq("id", replyRow.id);
    }
  }

  return { status: "processed", classification: classification.classification };
}
