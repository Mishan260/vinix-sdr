// lib/validation/schemas.ts
// ============================================================================
// Esquemas Zod: única fuente de verdad de qué acepta cada endpoint.
//
// Todo input externo (body, query, formData) se valida aquí antes de tocar la
// BD. Los mensajes están en español porque acaban en la UI del usuario.
//
// Además del tipado, la validación es una capa de seguridad: limita longitudes
// (evita payloads gigantes), rechaza tipos inesperados y normaliza (trim) antes
// de persistir.
// ============================================================================

import { z } from "zod";

// ── Primitivas reutilizables ────────────────────────────────────────────────
export const uuidSchema = z.string().uuid("Identificador inválido");

/** Validación de email en un solo sitio: la comparten Zod y el envío directo. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "El email es obligatorio")
  .max(320, "Email demasiado largo")
  .regex(EMAIL_REGEX, "Formato de email inválido");

export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede superar los 72 caracteres");

/** URL http(s) pública. Acepta dominios sin protocolo y los normaliza. */
export const companyUrlSchema = z
  .string()
  .trim()
  .max(2048, "URL demasiado larga")
  .transform((v) => (v.length === 0 ? "" : /^https?:\/\//i.test(v) ? v : `https://${v}`))
  .refine((v) => v === "" || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v), "URL inválida");

const trimmedText = (max: number, label: string) =>
  z.string().trim().max(max, `${label}: máximo ${max} caracteres`);

// ── Auth ────────────────────────────────────────────────────────────────────
export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ password: passwordSchema });

// ── Campañas ────────────────────────────────────────────────────────────────
export const createCampaignSchema = z.object({
  name: trimmedText(200, "Nombre").min(1, "El nombre de la campaña es obligatorio"),
  value_proposition: trimmedText(2000, "Propuesta de valor").min(
    1,
    "La propuesta de valor es obligatoria: el agente la necesita para redactar"
  ),
  sender_name: trimmedText(120, "Nombre del remitente").min(1, "El nombre del remitente es obligatorio: firma los emails"),
  sender_email: emailSchema,
  base_template: trimmedText(4000, "Plantilla").optional().default(""),
});

export const updateCampaignSchema = z
  .object({
    campaignId: uuidSchema,
    base_template: trimmedText(4000, "Plantilla").optional(),
    value_proposition: trimmedText(2000, "Propuesta de valor").optional(),
    sender_name: trimmedText(120, "Nombre del remitente").optional(),
    sender_email: emailSchema.optional(),
    followups_enabled: z.boolean().optional(),
    followup_delay_days: z.coerce.number().int().min(1, "Mínimo 1 día").max(30, "Máximo 30 días").optional(),
    followup_max_touches: z.coerce.number().int().min(0).max(5, "Máximo 5 follow-ups").optional(),
    daily_send_limit: z.coerce.number().int().min(1).max(500, "Máximo 500 envíos diarios").optional(),
  })
  .refine((v) => Object.keys(v).length > 1, "No hay ningún campo que actualizar");

// ── Leads ───────────────────────────────────────────────────────────────────
export const updateLeadSchema = z
  .object({
    company_name: trimmedText(300, "Nombre de la empresa").min(1, "El nombre de la empresa no puede quedar vacío").optional(),
    company_url: companyUrlSchema.optional(),
    contact_name: trimmedText(200, "Nombre del contacto").optional(),
    contact_email: z.union([emailSchema, z.literal("")]).optional(),
    contact_role: trimmedText(200, "Cargo").optional(),
    resetForResearch: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No hay ningún campo que actualizar");

export const listLeadsQuerySchema = z.object({
  campaignId: uuidSchema.optional(),
  status: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(500),
});

// ── Agente ──────────────────────────────────────────────────────────────────
export const researchSchema = z.object({ leadId: uuidSchema });

export const sendEmailSchema = z.object({
  leadId: uuidSchema,
  subject: trimmedText(300, "Asunto").min(1, "El asunto no puede estar vacío").optional(),
  body: trimmedText(10_000, "Cuerpo").min(1, "El cuerpo no puede estar vacío").optional(),
});

export const followUpsSchema = z.object({ campaignId: uuidSchema.optional() });

// ── Facturación ─────────────────────────────────────────────────────────────
export const planIdSchema = z.enum(["free", "pro", "agency"], {
  errorMap: () => ({ message: "Plan inválido. Opciones: free, pro, agency" }),
});

export const billingCycleSchema = z.enum(["monthly", "annual"]).default("monthly");

export const checkoutSchema = z.object({
  plan: planIdSchema.refine((p) => p !== "free", "El plan Free no requiere pago"),
  cycle: billingCycleSchema,
});

// ── Utilidad: primer mensaje de error legible ───────────────────────────────
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos";
  const path = issue.path.filter((p) => typeof p === "string").join(".");
  return path && !issue.message.toLowerCase().includes(path.toLowerCase())
    ? `${path}: ${issue.message}`
    : issue.message;
}
