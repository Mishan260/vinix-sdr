// app/api/leads/import/route.ts
// ============================================================================
// POST /api/leads/import — multipart/form-data { file: CSV, campaignId }
//
// Aplica, en este orden: propiedad de la campaña (RLS), cupo del plan,
// lista de supresión, deduplicación (BD + dentro del archivo) y validación
// de emails. Devuelve un parte detallado para que el usuario sepa qué pasó
// con cada fila.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { parseLeadsCsv } from "@/lib/leads/csv";
import { EMAIL_REGEX, uuidSchema } from "@/lib/validation/schemas";
import { loadAccount, remainingLeadQuota } from "@/lib/billing/account";
import { createUserClient, getUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { toAppError, toErrorBody, errors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforce, identify } from "@/lib/api/rate-limit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB; un CSV de 500 filas ocupa ~50 KB

// No usamos el wrapper authedRoute porque este endpoint recibe multipart,
// no JSON. Replicamos las mismas garantías de forma explícita.
export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const log = logger.child({ requestId, event: "leads.import" });

  try {
    const user = await getUser();
    if (!user) throw errors.unauthenticated();
    enforce(identify(req, user.id), "mutation");

    const db = await createUserClient();

    const form = await req.formData().catch(() => null);
    if (!form) throw errors.validation("Se esperaba multipart/form-data");

    const file = form.get("file");
    const rawCampaignId = form.get("campaignId");

    if (!(file instanceof File)) throw errors.validation("Falta el archivo CSV");
    if (file.size === 0) throw errors.validation("El archivo está vacío");
    if (file.size > MAX_FILE_BYTES) {
      throw errors.validation(
        `El archivo ocupa ${(file.size / 1024 / 1024).toFixed(1)} MB; el máximo son 2 MB.`
      );
    }

    const campaignParse = uuidSchema.safeParse(rawCampaignId);
    if (!campaignParse.success) {
      throw errors.validation("Selecciona una campaña antes de importar");
    }
    const campaignId = campaignParse.data;

    // RLS: si la campaña es de otro usuario, esto devuelve null
    const { data: campaign } = await db.from("campaigns").select("id").eq("id", campaignId).maybeSingle();
    if (!campaign) throw errors.notFound("La campaña");

    const { rows } = parseLeadsCsv(await file.text());

    if (rows.length === 0) throw errors.validation("El CSV no tiene filas de datos");
    if (!("company_name" in rows[0])) {
      throw errors.validation(
        `Falta la columna 'company_name'. Columnas detectadas: ${Object.keys(rows[0]).join(", ") || "ninguna"}. ` +
          `Opcionales: company_url, contact_name, contact_email, contact_role.`
      );
    }
    if (rows.length > MAX_ROWS) {
      throw errors.validation(`El CSV tiene ${rows.length} filas; el máximo son ${MAX_ROWS} por importación.`);
    }

    // ── Cupo del plan ────────────────────────────────────────────────────────
    const account = await loadAccount(db, user.id);
    const quota = remainingLeadQuota(account);
    if (quota <= 0) {
      throw errors.planLimit(
        `Has alcanzado el cupo de ${account.effective.limits.leadsPerMonth} leads/mes de tu plan. Amplíalo para seguir importando.`
      );
    }

    // ── Lista de supresión GLOBAL ────────────────────────────────────────────
    // Cruza fronteras de tenant a propósito: si alguien pidió no ser
    // contactado, ningún usuario de la plataforma debe volver a escribirle.
    // Requiere service role porque RLS impediría ver leads de otras cuentas.
    const admin = createServiceClient();
    const { data: optedOut } = await admin
      .from("leads")
      .select("contact_email")
      .eq("status", "not_interested")
      .not("contact_email", "is", null)
      .limit(50_000);
    const suppression = new Set((optedOut ?? []).map((l) => String(l.contact_email).toLowerCase()));

    // ── Duplicados ya presentes en la campaña ───────────────────────────────
    const { data: existing } = await db
      .from("leads")
      .select("company_name, contact_email")
      .eq("campaign_id", campaignId)
      .limit(10_000);

    const existingEmails = new Set(
      (existing ?? []).map((l) => l.contact_email?.toLowerCase()).filter(Boolean) as string[]
    );
    const existingCompanies = new Set((existing ?? []).map((l) => String(l.company_name).toLowerCase()));

    const warnings: string[] = [];
    const inserts: Record<string, string | null>[] = [];
    const seen = new Set<string>();
    let skippedDuplicates = 0;
    let skippedSuppressed = 0;

    rows.forEach((row, index) => {
      const line = index + 2; // +1 por índice 0, +1 por la cabecera
      const company = row.company_name?.trim();

      if (!company) {
        warnings.push(`Fila ${line}: sin nombre de empresa, omitida`);
        return;
      }

      const emailRaw = row.contact_email?.trim() ?? "";
      const emailKey = emailRaw.toLowerCase();
      const companyKey = company.toLowerCase();

      if (emailKey && suppression.has(emailKey)) {
        skippedSuppressed++;
        warnings.push(`Fila ${line} (${company}): el contacto pidió no ser contactado`);
        return;
      }

      const isDuplicate =
        (emailKey && (existingEmails.has(emailKey) || seen.has(`e:${emailKey}`))) ||
        existingCompanies.has(companyKey) ||
        seen.has(`c:${companyKey}`);

      if (isDuplicate) {
        skippedDuplicates++;
        return;
      }

      if (emailKey) seen.add(`e:${emailKey}`);
      seen.add(`c:${companyKey}`);

      let email: string | null = emailRaw || null;
      if (email && !EMAIL_REGEX.test(email)) {
        warnings.push(`Fila ${line} (${company}): email '${email}' inválido, importada sin email`);
        email = null;
      }

      const url = row.company_url?.trim();

      inserts.push({
        campaign_id: campaignId,
        company_name: company.slice(0, 300),
        company_url: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`).slice(0, 2048) : null,
        contact_name: row.contact_name?.trim().slice(0, 200) || null,
        contact_email: email,
        contact_role: row.contact_role?.trim().slice(0, 200) || null,
        status: "pending",
      });
    });

    if (inserts.length === 0) {
      const reason =
        skippedDuplicates > 0
          ? `Las ${skippedDuplicates} filas ya estaban en la campaña.`
          : skippedSuppressed > 0
            ? "Todos los contactos están en la lista de supresión."
            : warnings[0] ?? "Revisa el contenido del archivo.";

      return NextResponse.json(
        { imported: 0, skippedDuplicates, skippedSuppressed, warnings, error: `No se importó ninguna fila. ${reason}` },
        { status: skippedDuplicates > 0 ? 200 : 422, headers: { "X-Request-Id": requestId } }
      );
    }

    // Recorte por cupo: importamos lo que cabe e informamos del resto
    let quotaTrimmed = 0;
    if (inserts.length > quota) {
      quotaTrimmed = inserts.length - quota;
      inserts.length = quota;
      warnings.push(`${quotaTrimmed} leads no importados: has llegado al cupo mensual de tu plan`);
    }

    const { data, error } = await db.from("leads").insert(inserts).select("id");
    if (error) {
      log.error("leads.import.insert_failed", { error });
      throw errors.internal(error);
    }

    log.info("leads.import.ok", {
      campaignId,
      imported: data.length,
      skippedDuplicates,
      skippedSuppressed,
      quotaTrimmed,
    });

    return NextResponse.json(
      { imported: data.length, skippedDuplicates, skippedSuppressed, quotaTrimmed, warnings },
      { headers: { "X-Request-Id": requestId } }
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError.status >= 500) log.error("leads.import.failed", { error });
    return NextResponse.json(toErrorBody(appError, requestId), {
      status: appError.status,
      headers: { "X-Request-Id": requestId },
    });
  }
}
