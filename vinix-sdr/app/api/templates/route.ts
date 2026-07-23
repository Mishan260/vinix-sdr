// app/api/templates/route.ts
// ============================================================================
// GET /api/templates?campaignId=... → configuración de la campaña
// PUT /api/templates                → actualiza plantilla y ajustes de envío
//
// NOTA SOBRE LA RUTA: el identificador viaja en el BODY (`campaignId`), no en
// un segmento dinámico. No existe `app/api/templates/[id]/route.ts`.
//
// NOMBRES DE COLUMNA — fuente de verdad = la tabla `campaigns` real:
//     followups_enabled      (boolean)   ← con S
//     followup_delay_days    (integer)
//     followup_max_touches   (integer)
//     daily_send_limit       (integer)
// El código usaba follow_up_enabled / follow_up_days / max_follow_ups, que no
// existen. PostgREST respondía PGRST204 "Could not find the 'follow_up_days'
// column … in the schema cache": un mensaje que culpa al cache cuando en
// realidad la columna no está. Por eso `NOTIFY pgrst, 'reload schema'` jamás
// lo arreglaba.
//
// RLS: se usa el cliente con la sesión del usuario (ctx.db), así que un
// campaignId ajeno no devuelve datos ni permite escribir; se traduce a 404.
// ============================================================================

import { z } from "zod";
import { authedRoute, fromDbError } from "@/lib/api/handler";
import { uuidSchema } from "@/lib/validation/schemas";
import { errors } from "@/lib/errors";

export const dynamic = "force-dynamic";

const CAMPAIGN_FIELDS =
  "id, name, base_template, value_proposition, sender_name, sender_email, " +
  "followups_enabled, followup_delay_days, followup_max_touches, daily_send_limit, status";

// ── Esquema estricto ────────────────────────────────────────────────────────
// `.strict()` rechaza claves desconocidas: si el cliente vuelve a enviar
// `follow_up_days`, falla con un 422 explícito en vez de descartarlo en
// silencio y hacer creer que se guardó.
const templateUpdateSchema = z
  .object({
    campaignId: uuidSchema,

    base_template: z.string().trim().max(4000, "La plantilla no puede superar los 4000 caracteres"),
    value_proposition: z
      .string()
      .trim()
      .max(2000, "La propuesta de valor no puede superar los 2000 caracteres"),

    followups_enabled: z.boolean({
      required_error: "followups_enabled es obligatorio",
      invalid_type_error: "followups_enabled debe ser true o false",
    }),
    followup_delay_days: z.coerce
      .number()
      .int("Los días de espera deben ser un número entero")
      .min(1, "Mínimo 1 día de espera")
      .max(30, "Máximo 30 días de espera"),
    followup_max_touches: z.coerce
      .number()
      .int("El máximo de follow-ups debe ser un número entero")
      .min(0, "No puede ser negativo")
      .max(5, "Máximo 5 follow-ups por lead"),
    daily_send_limit: z.coerce
      .number()
      .int("El límite diario debe ser un número entero")
      .min(1, "Mínimo 1 envío diario")
      .max(500, "Máximo 500 envíos diarios"),
  })
  .strict();

export type TemplateUpdate = z.infer<typeof templateUpdateSchema>;

// ── GET ─────────────────────────────────────────────────────────────────────
export const GET = authedRoute(
  { event: "templates.get", query: z.object({ campaignId: uuidSchema }), rateLimit: "read" },
  async ({ query, db, log }) => {
    const { data, error } = await db
      .from("campaigns")
      .select(CAMPAIGN_FIELDS)
      .eq("id", query.campaignId)
      .maybeSingle();

    if (error) {
      log.error("[templates:get] error", { error, campaignId: query.campaignId });
      throw fromDbError(error, "la campaña");
    }
    // RLS ya filtró: si no hay fila, o no existe o no es del usuario
    if (!data) throw errors.notFound("La campaña");

    return { campaign: data };
  }
);

// ── PUT ─────────────────────────────────────────────────────────────────────
export const PUT = authedRoute(
  { event: "templates.update", body: templateUpdateSchema, rateLimit: "mutation" },
  async ({ body, db, user, log }) => {
    const { campaignId, ...payload } = body;

    console.log("[templates:update] payload", { campaignId, userId: user.id, ...payload });

    const { data, error } = await db
      .from("campaigns")
      .update(payload)
      .eq("id", campaignId)
      .select(CAMPAIGN_FIELDS)
      .maybeSingle();

    if (error) {
      console.error("[templates:update] error", error);
      log.error("[templates:update] error", { error, campaignId });
      throw fromDbError(error, "la campaña");
    }

    // Sin fila devuelta: la campaña no existe o pertenece a otro usuario.
    // RLS lo hace indistinguible a propósito — confirmar la existencia de un
    // recurso ajeno ya es una fuga de información.
    if (!data) {
      log.warn("[templates:update] campaña no encontrada o ajena", { campaignId });
      throw errors.notFound("La campaña");
    }

    log.info("[templates:update] ok", { campaignId });

    // Se devuelve la fila guardada para que la UI refleje lo que hay en BD
    // (valores recortados a rango incluidos) en vez de lo que creyó enviar.
    return { status: "updated", campaign: data };
  }
);
