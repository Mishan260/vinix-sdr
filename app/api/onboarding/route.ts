// app/api/onboarding/route.ts
// ============================================================================
// GET  /api/onboarding → estado, lista de tareas y paso por el que retomar
// POST /api/onboarding → registra progreso y eventos del embudo
// ============================================================================

import { z } from "zod";
import { authedRoute } from "@/lib/api/handler";
import { loadOnboarding, recordStep, updateProgress, type OnboardingStep } from "@/lib/onboarding/service";
import { buildTasks, isComplete, progressOf, resumeAt, shouldRedirectToGuide } from "@/lib/onboarding/steps";

export const dynamic = "force-dynamic";

const ONBOARDING_STEPS = [
  "welcome_viewed",
  "offer_submitted",
  "sample_requested",
  "first_company_submitted",
  "research_started",
  "research_succeeded",
  "research_failed",
  "draft_viewed",
  "onboarding_completed",
  "onboarding_dismissed",
  "demo_data_created",
  "demo_data_removed",
] as const satisfies readonly OnboardingStep[];

const progressSchema = z
  .object({
    /** Paso del embudo que se acaba de dar. */
    event: z.enum(ONBOARDING_STEPS).optional(),
    /** Momento en que arrancó el recorrido, para medir la duración. */
    startedAt: z.string().datetime().optional(),

    markWelcomed: z.boolean().optional(),
    dismiss: z.boolean().optional(),
    complete: z.boolean().optional(),
    valueProposition: z.string().trim().max(2000, "Máximo 2000 caracteres").optional(),
    targetAudience: z.string().trim().max(2000, "Máximo 2000 caracteres").optional(),
    mainProduct: z.string().trim().max(2000, "Máximo 2000 caracteres").optional(),
    dismissTip: z.string().trim().max(60).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No hay nada que registrar");

export const GET = authedRoute({ event: "onboarding.get", rateLimit: "read" }, async ({ db, user }) => {
  const snapshot = await loadOnboarding(db, user.id);
  const tasks = buildTasks(snapshot);

  return {
    snapshot,
    tasks,
    progress: progressOf(tasks),
    resumeAt: resumeAt(snapshot),
    shouldRedirect: shouldRedirectToGuide(snapshot),
    complete: isComplete(snapshot),
  };
});

export const POST = authedRoute(
  { event: "onboarding.progress", body: progressSchema, rateLimit: "mutation" },
  async ({ body, db, user }) => {
    await updateProgress(db, user.id, {
      welcomedAt: body.markWelcomed,
      dismissedAt: body.dismiss,
      completedAt: body.complete,
      valueProposition: body.valueProposition,
      targetAudience: body.targetAudience,
      mainProduct: body.mainProduct,
      dismissTip: body.dismissTip,
    });

    if (body.event) {
      await recordStep(user.id, body.event, { startedAt: body.startedAt });
    }

    // Se devuelve el estado recalculado para que el cliente no tenga que
    // encadenar una segunda petición tras cada acción.
    const snapshot = await loadOnboarding(db, user.id);
    const tasks = buildTasks(snapshot);

    return {
      snapshot,
      tasks,
      progress: progressOf(tasks),
      resumeAt: resumeAt(snapshot),
      complete: isComplete(snapshot),
    };
  }
);
