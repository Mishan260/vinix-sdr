// lib/agent/tools/email.ts
// ============================================================================
// Envío vía Resend. Devuelve providerMessageId: es la clave que permite
// vincular la respuesta entrante (webhook, header In-Reply-To) con este envío.
// Texto plano deliberado: mejor entregabilidad y parece escrito a mano.
// ============================================================================

import { Resend } from "resend";
import { EMAIL_REGEX } from "@/lib/validation/schemas";

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export async function sendColdEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { success: false, error: "RESEND_API_KEY no configurada" };

  const fromEmail = input.fromEmail ?? process.env.SENDER_EMAIL;
  const fromName = input.fromName ?? process.env.SENDER_NAME ?? "Vinix";
  if (!fromEmail) return { success: false, error: "SENDER_EMAIL no configurado" };

  // Validación antes de quemar cuota con basura del CSV
  if (!EMAIL_REGEX.test(input.to)) {
    return { success: false, error: `Email de destino inválido: ${input.to}` };
  }
  if (!input.subject?.trim() || !input.body?.trim()) {
    return { success: false, error: "Asunto o cuerpo vacíos" };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });

    if (error) return { success: false, error: error.message };
    if (!data?.id) return { success: false, error: "Resend no devolvió ID de mensaje" };

    return { success: true, providerMessageId: data.id };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
