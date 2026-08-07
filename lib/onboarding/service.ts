// lib/onboarding/service.ts
// ============================================================================
// Acceso a datos del onboarding: lectura del estado, registro de eventos y
// creación de la campaña de ejemplo.
//
// Separado de las rutas HTTP para que la lógica se pueda probar sin levantar
// un servidor, igual que el resto de servicios del proyecto.
// ============================================================================

import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { errors } from "@/lib/errors";
import type { OnboardingSnapshot } from "./steps";

/** Fila que devuelve la función SQL `onboarding_overview`. */
interface OverviewRow {
  welcomed_at: string | null;
  dismissed_at: string | null;
  completed_at: string | null;
  value_proposition: string | null;
  target_audience: string | null;
  main_product: string | null;
  dismissed_tips: string[] | null;
  first_campaign_at: string | null;
  first_lead_at: string | null;
  first_research_at: string | null;
  first_draft_at: string | null;
  first_send_at: string | null;
  has_real_campaign: boolean;
  has_demo_campaign: boolean;
  lead_count: number;
  researched_count: number;
  draft_count: number;
  sent_count: number;
  has_sender_domain: boolean;
}

const EMPTY_SNAPSHOT: OnboardingSnapshot = {
  welcomedAt: null,
  dismissedAt: null,
  completedAt: null,
  valueProposition: null,
  targetAudience: null,
  mainProduct: null,
  dismissedTips: [],
  firstCampaignAt: null,
  firstLeadAt: null,
  firstResearchAt: null,
  firstDraftAt: null,
  firstSendAt: null,
  hasRealCampaign: false,
  hasDemoCampaign: false,
  leadCount: 0,
  researchedCount: 0,
  draftCount: 0,
  sentCount: 0,
  hasSenderDomain: false,
};

function toSnapshot(row: OverviewRow): OnboardingSnapshot {
  return {
    welcomedAt: row.welcomed_at,
    dismissedAt: row.dismissed_at,
    completedAt: row.completed_at,
    valueProposition: row.value_proposition,
    targetAudience: row.target_audience ?? null,
    mainProduct: row.main_product ?? null,
    dismissedTips: row.dismissed_tips ?? [],
    firstCampaignAt: row.first_campaign_at,
    firstLeadAt: row.first_lead_at,
    firstResearchAt: row.first_research_at,
    firstDraftAt: row.first_draft_at,
    firstSendAt: row.first_send_at,
    hasRealCampaign: row.has_real_campaign,
    hasDemoCampaign: row.has_demo_campaign,
    leadCount: row.lead_count,
    researchedCount: row.researched_count,
    draftCount: row.draft_count,
    sentCount: row.sent_count,
    hasSenderDomain: row.has_sender_domain,
  };
}

/**
 * Estado completo del onboarding en una consulta.
 *
 * Si la fila de progreso no existe (usuario anterior a la migración), devuelve
 * el estado vacío en lugar de fallar: el onboarding es una ayuda, nunca debe
 * impedir usar el producto.
 */
export async function loadOnboarding(db: TypedSupabaseClient, userId: string): Promise<OnboardingSnapshot> {
  const { data, error } = await db.rpc("onboarding_overview", { p_user_id: userId });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as OverviewRow | undefined;
    if (row) return toSnapshot(row);
    // Sin fila: el trigger de alta no llegó a crear el registro de progreso
    return ensureProgressRow(db, userId);
  }

  // La función agregada es una OPTIMIZACIÓN, no un requisito.
  //
  // Devolver estado vacío cuando falta hacía que `valueProposition` fuese
  // siempre null, y el usuario recibía «necesitamos saber qué vendes» aunque
  // ya lo hubiera rellenado. Se leen las tablas directamente en su lugar.
  logger.warn("onboarding.overview_unavailable", {
    userId,
    dbError: error.message,
    accion: "leyendo las tablas directamente",
    solucion: "aplicar supabase/migrations/0009_onboarding.sql para el camino rápido",
  });

  return loadOnboardingFallback(db, userId);
}

/**
 * Columnas del progreso persistido.
 * Literal en una sola línea a propósito: concatenar con `+` impide que
 * supabase-js infiera los tipos de las columnas seleccionadas.
 */
const PROGRESS_COLUMNS =
  "welcomed_at, dismissed_at, completed_at, value_proposition, target_audience, main_product, dismissed_tips, first_campaign_at, first_lead_at, first_research_at, first_draft_at, first_send_at";

/**
 * Crea la fila de progreso si el trigger de alta no llegó a ejecutarse.
 *
 * Se usa el cliente de servicio a propósito: `onboarding_progress` sólo tiene
 * políticas de SELECT y UPDATE, así que el cliente del usuario no puede crear
 * su propia fila. Sin esto, quien se registró sin el trigger `handle_new_user`
 * se quedaba sin fila para siempre y TODO lo que escribía se perdía.
 *
 * No debilita nada: `userId` viene de la sesión ya verificada en `authedRoute`,
 * nunca del cuerpo de la petición, y la fila creada está vacía.
 */
async function ensureProgressRow(db: TypedSupabaseClient, userId: string): Promise<OnboardingSnapshot> {
  const { error } = await db.from("onboarding_progress").insert({ user_id: userId });
  if (!error) return EMPTY_SNAPSHOT;

  // 23505 = clave duplicada: otra petición simultánea ya la creó
  if (error.code === "23505") return EMPTY_SNAPSHOT;

  try {
    const { error: adminError } = await createServiceClient()
      .from("onboarding_progress")
      .upsert({ user_id: userId }, { onConflict: "user_id" });

    if (adminError) throw adminError;
  } catch (adminError) {
    logger.warn("onboarding.progress_create_failed", {
      userId,
      dbError: error.message,
      adminError,
      consecuencia: "el progreso del usuario no se podrá guardar",
    });
  }

  return EMPTY_SNAPSHOT;
}

/**
 * Camino lento: reconstruye el estado leyendo las tablas.
 *
 * Más consultas que la función agregada, pero sólo se recorre cuando esa
 * función no está disponible. Preferible a dejar el producto inutilizable.
 */
async function loadOnboardingFallback(
  db: TypedSupabaseClient,
  userId: string
): Promise<OnboardingSnapshot> {
  const [progressResult, campaignsResult] = await Promise.all([
    db.from("onboarding_progress").select(PROGRESS_COLUMNS).eq("user_id", userId).maybeSingle(),
    db.from("campaigns").select("id, is_demo, sender_email").eq("user_id", userId),
  ]);

  const progress = progressResult.data;
  if (!progress) return ensureProgressRow(db, userId);

  const campaigns = campaignsResult.data ?? [];
  const realCampaigns = campaigns.filter((c) => !c.is_demo);
  const realIds = realCampaigns.map((c) => c.id);

  let leadCount = 0;
  let researchedCount = 0;
  let draftCount = 0;
  let sentCount = 0;

  if (realIds.length > 0) {
    const [leads, sent] = await Promise.all([
      db.from("leads").select("status, draft_body").in("campaign_id", realIds),
      db.from("emails_sent").select("id", { count: "exact", head: true }).in("campaign_id", realIds),
    ]);

    for (const lead of leads.data ?? []) {
      leadCount++;
      if (lead.status !== "pending" && lead.status !== "researching") researchedCount++;
      if (lead.draft_body) draftCount++;
    }
    sentCount = sent.count ?? 0;
  }

  return {
    welcomedAt: progress.welcomed_at,
    dismissedAt: progress.dismissed_at,
    completedAt: progress.completed_at,
    valueProposition: progress.value_proposition,
    targetAudience: progress.target_audience ?? null,
    mainProduct: progress.main_product ?? null,
    dismissedTips: progress.dismissed_tips ?? [],
    firstCampaignAt: progress.first_campaign_at,
    firstLeadAt: progress.first_lead_at,
    firstResearchAt: progress.first_research_at,
    firstDraftAt: progress.first_draft_at,
    firstSendAt: progress.first_send_at,
    hasRealCampaign: realCampaigns.length > 0,
    hasDemoCampaign: campaigns.some((c) => c.is_demo),
    leadCount,
    researchedCount,
    draftCount,
    sentCount,
    hasSenderDomain: realCampaigns.some((c) => (c.sender_email ?? "") !== ""),
  };
}

// ── Registro de eventos ─────────────────────────────────────────────────────
export type OnboardingStep =
  | "welcome_viewed"
  | "offer_submitted"
  | "sample_requested"
  | "first_company_submitted"
  | "research_started"
  | "research_succeeded"
  | "research_failed"
  | "draft_viewed"
  | "onboarding_completed"
  | "onboarding_dismissed"
  | "demo_data_created"
  | "demo_data_removed";

/**
 * Registra un paso del embudo.
 *
 * PRIVACIDAD: nunca se guarda texto escrito por el usuario ni las empresas que
 * investiga. Sólo el nombre del paso, cuánto tardó y un detalle acotado a
 * valores del propio sistema (por ejemplo, el motivo de un fallo).
 *
 * Nunca lanza: perder una métrica no puede romper el flujo del usuario.
 */
export async function recordStep(
  userId: string,
  step: OnboardingStep,
  options: { startedAt?: string | null; detail?: Record<string, string | number | boolean> } = {}
): Promise<void> {
  try {
    const elapsedMs = options.startedAt
      ? Math.max(0, Date.now() - new Date(options.startedAt).getTime())
      : null;

    // Service role: los eventos son de analítica y la tabla no tiene políticas
    // de escritura para el usuario, a propósito.
    await createServiceClient()
      .from("onboarding_events")
      .insert({
        user_id: userId,
        step,
        elapsed_ms: elapsedMs,
        detail: options.detail ?? null,
      });
  } catch (error) {
    logger.warn("onboarding.event_failed", { userId, step, error });
  }
}

// ── Actualización del progreso ──────────────────────────────────────────────
export interface ProgressPatch {
  welcomedAt?: boolean;
  dismissedAt?: boolean;
  completedAt?: boolean;
  valueProposition?: string;
  targetAudience?: string;
  mainProduct?: string;
  dismissTip?: string;
}

/**
 * Guarda el progreso del usuario.
 *
 * Devuelve `true` sólo si la escritura llegó realmente a la base de datos.
 *
 * REGRESIÓN QUE CIERRA: antes hacía `update().eq()`. Un UPDATE sobre una fila
 * inexistente afecta a CERO filas y PostgREST lo devuelve como éxito, sin
 * error. Como el trigger de alta no existía en este proyecto, ningún usuario
 * tenía fila, así que cada escritura se descartaba en silencio:
 *
 *   · «Continuar» en el perfil → la oferta no se guardaba → la investigación
 *     volvía a pedir el perfil → la misma pantalla en bucle.
 *   · «Saltar» → `dismissed_at` seguía nulo → el panel rebotaba al recorrido.
 *
 * Ambos síntomas eran esta única línea.
 */
export async function updateProgress(
  db: TypedSupabaseClient,
  userId: string,
  patch: ProgressPatch
): Promise<ProgressWriteResult> {
  // Tipado contra la tabla real: un nombre de columna equivocado no compila
  const update: TablesUpdate<"onboarding_progress"> = {};
  const now = new Date().toISOString();

  if (patch.welcomedAt) update.welcomed_at = now;
  if (patch.dismissedAt) update.dismissed_at = now;
  if (patch.completedAt) update.completed_at = now;
  if (patch.valueProposition !== undefined) update.value_proposition = patch.valueProposition;
  if (patch.targetAudience !== undefined) update.target_audience = patch.targetAudience;
  if (patch.mainProduct !== undefined) update.main_product = patch.mainProduct;

  if (patch.dismissTip) {
    // array_append en SQL evitaría leer antes, pero PostgREST no lo expone;
    // leer y escribir es aceptable para una acción tan poco frecuente.
    const { data } = await db
      .from("onboarding_progress")
      .select("dismissed_tips")
      .eq("user_id", userId)
      .maybeSingle();

    const current = (data?.dismissed_tips as string[] | null) ?? [];
    if (!current.includes(patch.dismissTip)) {
      update.dismissed_tips = [...current, patch.dismissTip];
    }
  }

  if (Object.keys(update).length === 0) return { ok: true };

  // `.select()` es lo que convierte «no ha fallado» en «se ha escrito»: sin él
  // no hay forma de distinguir un UPDATE correcto de uno que no tocó nada.
  const { data, error } = await db
    .from("onboarding_progress")
    .update(update)
    .eq("user_id", userId)
    .select("user_id");

  if (!error && data && data.length > 0) return { ok: true };

  // Cero filas: la fila de progreso no existe. Se crea y se reintenta con el
  // cliente de servicio, porque la tabla no tiene política de INSERT para el
  // usuario. Ver `ensureProgressRow` para por qué esto no abre ningún agujero.
  let adminError: unknown = null;
  try {
    const { error: upsertError } = await createServiceClient()
      .from("onboarding_progress")
      .upsert({ user_id: userId, ...update }, { onConflict: "user_id" })
      .select("user_id")
      .single();

    if (!upsertError) return { ok: true };
    adminError = upsertError;
  } catch (thrown) {
    adminError = thrown;
  }

  const reason = classifyWriteFailure(error ?? adminError);

  logger.error("onboarding.progress_update_failed", {
    userId,
    campos: Object.keys(update),
    motivo: reason,
    dbError: error?.message ?? "el UPDATE no afectó a ninguna fila",
    adminError,
  });

  return { ok: false, reason };
}

/**
 * Por qué no se pudo escribir.
 *
 * Importa distinguirlo porque cambia lo que se le puede pedir al usuario:
 * ante un fallo pasajero tiene sentido decirle «inténtalo otra vez», pero si
 * falta la tabla reintentar no servirá nunca y decírselo es engañarle.
 */
export type ProgressWriteFailure = "schema_missing" | "denied" | "unknown";
export type ProgressWriteResult = { ok: true } | { ok: false; reason: ProgressWriteFailure };

function classifyWriteFailure(error: unknown): ProgressWriteFailure {
  const code = (error as { code?: string } | null)?.code ?? "";
  const message = ((error as { message?: string } | null)?.message ?? "").toLowerCase();

  // PGRST205/PGRST204: PostgREST no encuentra la tabla o la columna.
  // 42P01/42703: Postgres dice lo mismo. 0002–0011 sin aplicar.
  if (["PGRST205", "PGRST204", "42P01", "42703"].includes(code)) return "schema_missing";
  if (message.includes("schema cache") || message.includes("does not exist")) return "schema_missing";

  // 42501: RLS. La política de INSERT de la migración 0011 no está.
  if (code === "42501" || message.includes("row-level security")) return "denied";

  return "unknown";
}

/**
 * Marca el primer hito si aún no estaba marcado.
 *
 * Se llama desde los flujos reales (crear campaña, investigar, enviar) para
 * poder medir «tiempo hasta el primer X». `coalesce` en SQL evitaría la
 * lectura previa, pero requeriría una función; para una escritura que ocurre
 * una vez por usuario y por hito, esto es más simple de mantener.
 */
export async function markMilestone(
  userId: string,
  milestone: "first_campaign_at" | "first_lead_at" | "first_research_at" | "first_draft_at" | "first_send_at"
): Promise<void> {
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("onboarding_progress")
      .select(milestone)
      .eq("user_id", userId)
      .maybeSingle();

    if (data && (data as Record<string, unknown>)[milestone]) return;

    const patch: TablesUpdate<"onboarding_progress"> = { [milestone]: new Date().toISOString() };
    await admin.from("onboarding_progress").update(patch).eq("user_id", userId);
  } catch (error) {
    logger.warn("onboarding.milestone_failed", { userId, milestone, error });
  }
}

// ── Datos de ejemplo ────────────────────────────────────────────────────────
/**
 * Campaña de demostración con leads en todos los estados del pipeline.
 *
 * Existe para que alguien pueda evaluar el producto sin preparar un CSV ni
 * esperar a que termine una investigación. Va marcada con `is_demo` y en
 * estado `paused`, lo que garantiza por restricción de la base de datos que
 * nunca enviará un email real.
 */
export async function createDemoData(db: TypedSupabaseClient, userId: string): Promise<{ campaignId: string }> {
  const { data: existing } = await db
    .from("campaigns")
    .select("id")
    .eq("user_id", userId)
    .eq("is_demo", true)
    .maybeSingle();

  if (existing) return { campaignId: existing.id };

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      user_id: userId,
      name: "Ejemplo · Agencias de diseño",
      value_proposition:
        "Llenamos el calendario de reuniones cualificadas de agencias de diseño, sin que el equipo pierda tiempo prospectando.",
      sender_name: "Tu nombre",
      sender_email: "",
      base_template: "",
      is_demo: true,
      // `paused` es obligatorio para las demo: la restricción
      // campaigns_demo_never_sends lo impone en la base de datos.
      status: "paused",
    })
    .select("id")
    .single();

  if (error || !campaign) throw errors.internal(error);

  const leads = [
    {
      company_name: "Estudio Nórdico",
      company_url: "https://estudionordico.example",
      contact_name: "Marta Puig",
      contact_email: "marta@estudionordico.example",
      status: "ready_to_send" as const,
      research_sector: "Agencia de diseño de marca",
      research_size: "pyme, ~12 personas",
      research_pain_point: "Acaban de abrir oficina en Madrid y buscan dos perfiles comerciales",
      draft_subject: "lo de vuestra oficina en Madrid",
      draft_body:
        "Marta, he visto que acabáis de abrir en Madrid y estáis buscando perfiles comerciales.\n\n" +
        "Mientras esos fichajes llegan, nosotros llenamos el calendario de reuniones de agencias como la vuestra.\n\n" +
        "¿Es algo relevante para vosotros ahora mismo?\n\nTu nombre",
    },
    {
      company_name: "Taller Gráfico Sur",
      company_url: "https://tallergraficosur.example",
      contact_name: null,
      contact_email: "hola@tallergraficosur.example",
      status: "research_failed" as const,
      research_error:
        "Investigación sin hook específico ni dolor detectado; revisar manualmente.",
      research_sector: null,
      research_size: null,
      research_pain_point: null,
      draft_subject: null,
      draft_body: null,
    },
    {
      company_name: "Mediterrani Apps",
      company_url: "https://mediterrani.example",
      contact_name: null,
      contact_email: "dir@mediterrani.example",
      status: "interested" as const,
      research_sector: "Desarrollo de aplicaciones",
      research_size: "scale-up en expansión",
      research_pain_point: "Anunciaron expansión al mercado francés en su blog",
      draft_subject: null,
      draft_body: null,
    },
    {
      company_name: "Pixel & Co",
      company_url: "https://pixelco.example",
      contact_name: "Anna Serra",
      contact_email: "anna@pixelco.example",
      status: "pending" as const,
      research_sector: null,
      research_size: null,
      research_pain_point: null,
      draft_subject: null,
      draft_body: null,
    },
  ];

  const { error: leadsError } = await db
    .from("leads")
    .insert(leads.map((lead) => ({ ...lead, campaign_id: campaign.id })));

  if (leadsError) {
    // Sin leads la campaña de ejemplo no enseña nada: se deshace para no
    // dejar una campaña vacía y confusa.
    await db.from("campaigns").delete().eq("id", campaign.id);
    throw errors.internal(leadsError);
  }

  logger.info("onboarding.demo_created", { userId, campaignId: campaign.id });
  return { campaignId: campaign.id };
}

export async function removeDemoData(db: TypedSupabaseClient, userId: string): Promise<number> {
  // Los leads caen en cascada al borrar la campaña
  const { data, error } = await db
    .from("campaigns")
    .delete()
    .eq("user_id", userId)
    .eq("is_demo", true)
    .select("id");

  if (error) throw errors.internal(error);
  return data?.length ?? 0;
}
