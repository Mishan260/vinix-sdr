// lib/onboarding/steps.ts
// ============================================================================
// Modelo del onboarding.
//
// DECISIÓN DE PRODUCTO: el primer resultado real NO es «enviar un email».
// Enviar exige un dominio verificado en Resend, que son registros DNS y puede
// tardar días. Un onboarding que prometa un envío fracasa para casi todo el
// mundo en el último paso, que es el peor sitio donde fracasar.
//
// El resultado que sí se alcanza en menos de cinco minutos, sin configurar
// nada, es ver a Vinix leer una empresa real y escribir un email que merezca
// tu firma. Ese es el momento en que se entiende el producto.
//
// De ahí que el recorrido guiado pida sólo DOS datos:
//   1. Qué vendes  → lo único que el agente no puede deducir leyendo webs
//   2. Una empresa → sobre la que demostrar el trabajo
//
// Todo lo demás (remitente, dominio, CSV, límites) se aplaza a la lista de
// tareas del panel, donde el usuario ya sabe para qué sirve cada cosa.
// ============================================================================

/** Pasos del recorrido guiado inicial (pantalla /bienvenida). */
export type GuidedStep = "welcome" | "offer" | "company" | "result";

export const GUIDED_STEPS: readonly GuidedStep[] = ["welcome", "offer", "company", "result"];

/** Identificadores de la lista de tareas del panel. */
export type TaskId =
  | "account"
  | "offer"
  | "first_research"
  | "sender"
  | "real_leads"
  | "first_send";

export interface OnboardingSnapshot {
  welcomedAt: string | null;
  dismissedAt: string | null;
  completedAt: string | null;
  valueProposition: string | null;
  /** A quién se dirige la oferta. Opcional; mejora la puntería del agente. */
  targetAudience: string | null;
  /** Producto o servicio principal. Opcional. */
  mainProduct: string | null;
  dismissedTips: string[];

  firstCampaignAt: string | null;
  firstLeadAt: string | null;
  firstResearchAt: string | null;
  firstDraftAt: string | null;
  firstSendAt: string | null;

  hasRealCampaign: boolean;
  hasDemoCampaign: boolean;
  leadCount: number;
  researchedCount: number;
  draftCount: number;
  sentCount: number;
  hasSenderDomain: boolean;
}

export interface Task {
  id: TaskId;
  title: string;
  /** Por qué importa este paso. Sin esto la lista es burocracia. */
  reason: string;
  done: boolean;
  /** Adónde lleva la acción. null = no hay acción, se completa solo. */
  action: { label: string; href?: string; intent?: string } | null;
  /** Los opcionales no bloquean la finalización del onboarding. */
  optional?: boolean;
}

/**
 * Construye la lista de tareas a partir del estado real.
 *
 * Nada aquí se guarda como booleano: todo se deduce de los datos. Si el
 * usuario borra su única campaña, el paso vuelve a estar pendiente solo. Un
 * flag persistido se habría quedado marcado y la lista mentiría.
 */
export function buildTasks(snapshot: OnboardingSnapshot): Task[] {
  return [
    {
      id: "account",
      title: "Cuenta creada",
      reason: "Tus campañas y leads son sólo tuyos: el aislamiento lo impone la base de datos.",
      done: true,
      action: null,
    },
    {
      id: "offer",
      title: "Contar qué vendes",
      reason:
        "Es lo único que el agente no puede averiguar leyendo webs ajenas. Sin esto no puede conectar el dolor del prospecto con tu solución.",
      done: Boolean(snapshot.valueProposition?.trim()),
      action: { label: "Definir mi oferta", href: "/bienvenida?paso=offer" },
    },
    {
      id: "first_research",
      title: "Ver a Vinix investigar una empresa",
      reason:
        "El momento en que se entiende el producto: lee su web, encuentra un motivo real para escribir y redacta. O te dice que no lo hay.",
      done: snapshot.researchedCount > 0 || snapshot.draftCount > 0,
      action: { label: "Probar con una empresa", href: "/bienvenida?paso=company" },
    },
    {
      id: "sender",
      title: "Conectar tu dominio de envío",
      reason:
        "Los emails salen desde tu dominio, no desde el nuestro. Es lo que hace que lleguen a la bandeja de entrada y no a spam.",
      done: snapshot.hasSenderDomain,
      action: { label: "Configurar remitente", intent: "open-sender" },
    },
    {
      id: "real_leads",
      title: "Importar tus leads",
      reason:
        "Un CSV con el nombre de la empresa basta. Detecta el separador, limpia el formato de Excel y descarta duplicados.",
      done: snapshot.leadCount >= 2,
      action: { label: "Importar CSV", intent: "open-import" },
    },
    {
      id: "first_send",
      title: "Aprobar y enviar tu primer email",
      reason: "Tú lees el borrador y decides. Ningún email sale sin que lo hayas visto.",
      done: snapshot.sentCount > 0,
      action: { label: "Revisar borradores", intent: "filter-drafts" },
      optional: true,
    },
  ];
}

/** Porcentaje completado, contando sólo lo obligatorio. */
export function progressOf(tasks: Task[]): { done: number; total: number; percent: number } {
  const required = tasks.filter((t) => !t.optional);
  const done = required.filter((t) => t.done).length;
  return {
    done,
    total: required.length,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
  };
}

/**
 * Paso del recorrido guiado por el que debe entrar el usuario.
 *
 * Implementa el «sáltate lo que ya está hecho»: quien vuelve tras abandonar
 * no repite pantallas que ya completó.
 */
export function resumeAt(snapshot: OnboardingSnapshot): GuidedStep {
  if (!snapshot.welcomedAt) return "welcome";
  if (!snapshot.valueProposition?.trim()) return "offer";
  if (snapshot.researchedCount === 0 && snapshot.draftCount === 0) return "company";
  return "result";
}

/**
 * ¿Hay que llevar al usuario al recorrido guiado al abrir el panel?
 *
 * Sólo si no lo ha terminado NI lo ha descartado. Descartarlo es una decisión
 * del usuario que se respeta: la lista de tareas sigue disponible en el panel.
 */
export function shouldRedirectToGuide(snapshot: OnboardingSnapshot): boolean {
  if (snapshot.dismissedAt || snapshot.completedAt) return false;
  return resumeAt(snapshot) !== "result";
}

/** El onboarding se considera completo cuando el usuario ha visto un borrador. */
export function isComplete(snapshot: OnboardingSnapshot): boolean {
  return Boolean(snapshot.completedAt) || snapshot.draftCount > 0;
}

// ── Empresas sugeridas para la demostración ─────────────────────────────────
// Sitios públicos, estables y con contenido corporativo real: el objetivo es
// que la demostración funcione a la primera aunque el usuario no tenga a mano
// la web de un cliente potencial.
export const SUGGESTED_COMPANIES = [
  { name: "Stripe", url: "stripe.com", hint: "Pasarela de pagos" },
  { name: "Figma", url: "figma.com", hint: "Diseño colaborativo" },
  { name: "Notion", url: "notion.com", hint: "Espacio de trabajo" },
] as const;

// ── Consejos contextuales ───────────────────────────────────────────────────
// Se muestran de uno en uno y sólo cuando la condición se cumple: nunca un
// tour que tape la pantalla ni todos a la vez.
export type TipId = "pipeline_bar" | "research_failed" | "draft_review" | "demo_banner";

export interface Tip {
  id: TipId;
  title: string;
  body: string;
}

export const TIPS: Record<TipId, Tip> = {
  pipeline_bar: {
    id: "pipeline_bar",
    title: "Filtra por estado",
    body: "Cada tramo de la barra es un estado del pipeline. Pulsa uno para ver sólo esos leads.",
  },
  research_failed: {
    id: "research_failed",
    title: "Esto es lo que nos diferencia",
    body: "Vinix no ha encontrado nada verificable en esa web, así que no ha escrito nada. Otras herramientas habrían rellenado el hueco con un halago genérico.",
  },
  draft_review: {
    id: "draft_review",
    title: "Tú tienes la última palabra",
    body: "Puedes editar el asunto y el cuerpo antes de enviar. El contador de palabras te avisa si el email se alarga.",
  },
  demo_banner: {
    id: "demo_banner",
    title: "Datos de ejemplo",
    body: "Esta campaña es una demostración: sus leads son ficticios y no se enviará ningún email. Bórrala cuando ya no la necesites.",
  },
};
