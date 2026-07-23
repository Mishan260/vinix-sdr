// app/api/health/route.ts
// ============================================================================
// GET /api/health — diagnóstico de configuración y conectividad.
// Público a propósito (lo consulta la pantalla de setup y los monitores de
// uptime), pero NO revela valores de variables: sólo cuáles faltan.
// ============================================================================

import { NextResponse } from "next/server";
import { describeEnvHealth, getEnvSafe } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { publicRoute } from "@/lib/api/handler";
import { isStripeConfigured } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export const GET = publicRoute({ event: "health", rateLimit: "read" }, async ({ log }) => {
  const { critical, warnings } = describeEnvHealth();

  let dbOk = false;
  let dbError: string | null = null;
  let authOk = false;

  if (critical.length === 0) {
    try {
      const db = createServiceClient();

      const [tables, auth] = await Promise.all([
        db.from("campaigns").select("id").limit(1),
        db.from("accounts").select("user_id").limit(1),
      ]);

      if (tables.error) {
        dbError = /does not exist/i.test(tables.error.message)
          ? "Faltan tablas. Ejecuta las migraciones de supabase/migrations en el SQL Editor."
          : `Conexión a Supabase falló: ${tables.error.message}`;
      } else if (auth.error) {
        dbError = /does not exist/i.test(auth.error.message)
          ? "Falta la tabla 'accounts'. Ejecuta supabase/migrations/0002_multitenancy.sql."
          : `Error consultando cuentas: ${auth.error.message}`;
        dbOk = true;
      } else {
        dbOk = true;
        authOk = true;
      }
    } catch (error) {
      dbError = error instanceof Error ? error.message : "Error desconocido conectando con Supabase";
      log.error("health.db_unreachable", { error });
    }
  }

  const env = getEnvSafe();

  return NextResponse.json({
    ok: critical.length === 0 && dbOk && authOk,
    critical,
    warnings,
    dbOk,
    dbError,
    authOk,
    features: {
      email: Boolean(env?.RESEND_API_KEY && env?.SENDER_EMAIL),
      inboundWebhook: Boolean(env?.RESEND_WEBHOOK_SECRET),
      billing: isStripeConfigured(),
      firecrawl: Boolean(env?.FIRECRAWL_API_KEY),
    },
  });
});
