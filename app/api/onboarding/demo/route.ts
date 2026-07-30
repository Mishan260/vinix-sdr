// app/api/onboarding/demo/route.ts
// ============================================================================
// POST   /api/onboarding/demo → crea la campaña de ejemplo
// DELETE /api/onboarding/demo → la elimina
//
// Permite evaluar el producto sin preparar un CSV. La campaña queda marcada
// como `is_demo` y en estado `paused`; una restricción de la base de datos
// garantiza que jamás enviará un email real.
// ============================================================================

import { authedRoute } from "@/lib/api/handler";
import { createDemoData, recordStep, removeDemoData } from "@/lib/onboarding/service";

export const dynamic = "force-dynamic";

export const POST = authedRoute({ event: "onboarding.demo.create", rateLimit: "mutation" }, async ({ db, user, log }) => {
  const { campaignId } = await createDemoData(db, user.id);
  await recordStep(user.id, "demo_data_created");

  log.info("onboarding.demo.created", { campaignId });
  return { campaignId, status: "created" };
});

export const DELETE = authedRoute({ event: "onboarding.demo.remove", rateLimit: "mutation" }, async ({ db, user }) => {
  const removed = await removeDemoData(db, user.id);
  if (removed > 0) await recordStep(user.id, "demo_data_removed");

  return { removed, status: "deleted" };
});
