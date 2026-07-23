// app/api/leads/export/route.ts
// ============================================================================
// GET /api/leads/export?campaignId=... → CSV del pipeline (función Pro).
// ============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, fromDbError } from "@/lib/api/handler";
import { uuidSchema } from "@/lib/validation/schemas";
import { toCsv } from "@/lib/leads/csv";
import { assertFeature, loadAccount } from "@/lib/billing/account";
import { errors } from "@/lib/errors";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "company_name", "company_url", "contact_name", "contact_email", "contact_role",
  "status", "research_sector", "research_size", "research_pain_point",
  "research_decision_maker", "research_error", "draft_subject", "draft_body",
  "follow_ups_sent", "last_contacted_at", "created_at", "updated_at",
];

export const GET = authedRoute(
  { event: "leads.export", query: z.object({ campaignId: uuidSchema }), rateLimit: "read" },
  async ({ query, db, user }) => {
    const account = await loadAccount(db, user.id);
    assertFeature(account.effective.limits, "csvExport", "La exportación CSV");

    const { data: campaign } = await db.from("campaigns").select("name").eq("id", query.campaignId).maybeSingle();
    if (!campaign) throw errors.notFound("La campaña");

    const { data: leads, error } = await db
      .from("leads")
      .select(COLUMNS.join(", "))
      .eq("campaign_id", query.campaignId)
      .order("updated_at", { ascending: false });

    if (error) throw fromDbError(error, "los leads");

    const csv = toCsv(COLUMNS, (leads ?? []) as unknown as Record<string, unknown>[]);
    const date = new Date().toISOString().slice(0, 10);
    const safeName = String(campaign.name).replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vinix-${safeName}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
