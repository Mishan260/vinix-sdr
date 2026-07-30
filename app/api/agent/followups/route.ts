// app/api/agent/followups/route.ts
// ============================================================================
// GET  /api/agent/followups?campaignId=... → cuántos hay listos (contador)
// POST /api/agent/followups                → los envía
//
// El cron de Vercel llama con GET + Authorization: Bearer CRON_SECRET, y en
// ese caso procesa TODAS las cuentas con service role.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authedRoute, NO_PARAMS } from "@/lib/api/handler";
import { followUpsSchema, uuidSchema } from "@/lib/validation/schemas";
import { countDueFollowUps, runFollowUps } from "@/lib/agent/followups";
import { assertFeature, loadAccount } from "@/lib/billing/account";
import { createServiceClient } from "@/lib/supabase/admin";
import { errors } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ── Ejecución programada (Vercel Cron) ──────────────────────────────────────
async function runScheduled(): Promise<NextResponse> {
  const requestId = randomUUID();
  const log = logger.child({ requestId, event: "cron.followups" });
  const startedAt = Date.now();

  try {
    const db = createServiceClient();

    // Sólo cuentas cuyo plan incluye follow-ups automáticos. Se filtra aquí y
    // no dentro del servicio para que el cron no gaste llamadas al LLM en
    // cuentas Free.
    const { data: eligible } = await db
      .from("accounts")
      .select("user_id, plan, trial_ends_at")
      .in("plan", ["trial", "pro", "agency"]);

    const userIds = (eligible ?? [])
      .filter((a) => a.plan !== "trial" || new Date(a.trial_ends_at).getTime() > Date.now())
      .map((a) => a.user_id as string);

    if (userIds.length === 0) {
      log.info("cron.followups.no_eligible_accounts");
      return NextResponse.json({ sent: 0, closed: 0, processed: 0, accounts: 0 });
    }

    const { data: campaigns } = await db
      .from("campaigns")
      .select("id")
      .in("user_id", userIds)
      .eq("status", "active")
      .eq("followups_enabled", true);

    const campaignIds = (campaigns ?? []).map((c) => c.id as string);
    if (campaignIds.length === 0) {
      return NextResponse.json({ sent: 0, closed: 0, processed: 0, accounts: userIds.length });
    }

    const report = await runFollowUps(db, { campaignIds });

    log.info("cron.followups.ok", {
      accounts: userIds.length,
      campaigns: campaignIds.length,
      sent: report.sent,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ...report, accounts: userIds.length });
  } catch (error) {
    log.error("cron.followups.failed", { error, durationMs: Date.now() - startedAt });
    // 500 → Vercel lo marca como ejecución fallida y queda visible en el panel
    return NextResponse.json({ error: "La ejecución programada falló" }, { status: 500 });
  }
}

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

// ── GET: contador para el panel, o ejecución del cron ───────────────────────
const handleGet = authedRoute(
  { event: "followups.count", query: z.object({ campaignId: uuidSchema }), rateLimit: "read" },
  async ({ query, db }) => {
    const { data: campaign } = await db.from("campaigns").select("id").eq("id", query.campaignId).maybeSingle();
    if (!campaign) throw errors.notFound("La campaña");

    return { due: await countDueFollowUps(db, query.campaignId) };
  }
);

export async function GET(req: NextRequest) {
  if (isCronRequest(req)) return runScheduled();
  return handleGet(req, NO_PARAMS);
}

// ── POST: envío manual desde el panel ───────────────────────────────────────
const handlePost = authedRoute(
  { event: "followups.send", body: followUpsSchema, rateLimit: "ai" },
  async ({ body, db, user }) => {
    const account = await loadAccount(db, user.id);
    assertFeature(account.effective.limits, "followUps", "Los follow-ups automáticos");

    let campaignIds: string[] | undefined;
    if (body.campaignId) {
      const { data: campaign } = await db.from("campaigns").select("id").eq("id", body.campaignId).maybeSingle();
      if (!campaign) throw errors.notFound("La campaña");
      campaignIds = [body.campaignId];
    }

    return runFollowUps(db, { campaignIds, userId: user.id });
  }
);

export async function POST(req: NextRequest) {
  if (isCronRequest(req)) return runScheduled();
  return handlePost(req, NO_PARAMS);
}
