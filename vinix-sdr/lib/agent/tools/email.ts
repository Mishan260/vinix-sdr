// lib/agent/tools/email.ts
// ============================================================================
// Envío vía Resend. Devuelve providerMessageId: es la clave que permite
// vincular la respuesta entrante (webhook, header In-Reply-To) con este envío.
// Texto plano deliberado: mejor entregabilidad y parece escrito a mano.
//
// FIABILIDAD: los fallos transitorios (429, 5xx, red) se reintentan con
// backoff exponencial y jitter. Los permanentes (email inválido, dominio no
// verificado, credenciales) se devuelven de inmediato: reintentarlos sólo
// gasta cuota y retrasa al resto de la cola.
// ============================================================================

import { Resend } from "resend";
import { EMAIL_REGEX } from "@/lib/validation/schemas";
import { PermanentError, RetryableError, withRetry } from "@/lib/queue/retry";
import { logger } from "@/lib/logger";

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
  /** Clave de idempotencia: Resend descarta reenvíos con la misma clave. */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  /** `permanent` indica que reintentar no va a servir de nada. */
  failureKind?: "transient" | "permanent";
  /** Reintentos consumidos antes de resolverse. */
  attempts?: number;
}

let cachedClient: { key: string; client: Resend } | null = null;

/** Reutiliza el cliente entre envíos en vez de construirlo en cada llamada. */
function getResend(apiKey: string): Resend {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new Resend(apiKey) };
  }
  return cachedClient.client;
}

/**
 * Clasifica un fallo del proveedor.
 *
 * Resend devuelve `name` y a veces `statusCode`. Se usan ambos porque el
 * conjunto de nombres no está garantizado entre versiones del SDK.
 */
function classifyProviderError(error: { message: string; name?: string; statusCode?: number }): Error {
  const status = error.statusCode;
  const name = (error.name ?? "").toLowerCase();
  const message = error.message ?? "Error desconocido del proveedor";

  // Límite de velocidad o caída del proveedor: reintentar tiene sentido
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return new RetryableError(message);
  }
  if (name.includes("rate_limit") || name.includes("internal_server")) {
    return new RetryableError(message);
  }

  // 4xx restantes: la petición es incorrecta y lo seguirá siendo
  if (typeof status === "number" && status >= 400) {
    return new PermanentError(message);
  }
  if (
    name.includes("validation") ||
    name.includes("invalid") ||
    name.includes("missing") ||
    name.includes("not_found") ||
    name.includes("restricted")
  ) {
    return new PermanentError(message);
  }

  // Sin señal clara se asume transitorio: es preferible reintentar un envío
  // recuperable que descartarlo por una clasificación incompleta.
  return new RetryableError(message);
}

export async function sendColdEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY no configurada", failureKind: "permanent" };
  }

  const fromEmail = input.fromEmail ?? process.env.SENDER_EMAIL;
  const fromName = input.fromName ?? process.env.SENDER_NAME ?? "Vinix";
  if (!fromEmail) {
    return { success: false, error: "SENDER_EMAIL no configurado", failureKind: "permanent" };
  }

  // Validación antes de quemar cuota con basura del CSV
  if (!EMAIL_REGEX.test(input.to)) {
    return { success: false, error: `Email de destino inválido: ${input.to}`, failureKind: "permanent" };
  }
  if (!input.subject?.trim() || !input.body?.trim()) {
    return { success: false, error: "Asunto o cuerpo vacíos", failureKind: "permanent" };
  }

  const resend = getResend(apiKey);
  let attempts = 0;

  try {
    const messageId = await withRetry(
      async () => {
        attempts++;
        const { data, error } = await resend.emails.send(
          {
            from: `${fromName} <${fromEmail}>`,
            to: input.to,
            subject: input.subject,
            text: input.body,
          },
          // Con la misma clave, un reintento tras un timeout no duplica el envío
          input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
        );

        if (error) throw classifyProviderError(error as { message: string; name?: string; statusCode?: number });
        if (!data?.id) throw new RetryableError("Resend no devolvió ID de mensaje");

        return data.id;
      },
      {
        attempts: 3,
        baseDelayMs: 600,
        maxDelayMs: 10_000,
        onRetry: ({ attempt, delayMs, error }) => {
          logger.warn("email.send.retry", {
            attempt,
            delayMs,
            reason: error instanceof Error ? error.message : String(error),
          });
        },
      }
    );

    return { success: true, providerMessageId: messageId, attempts };
  } catch (err) {
    const permanent = err instanceof PermanentError;
    logger.error("email.send.failed", {
      attempts,
      permanent,
      reason: err instanceof Error ? err.message : String(err),
    });

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      failureKind: permanent ? "permanent" : "transient",
      attempts,
    };
  }
}
