// lib/supabase/admin.ts
// ============================================================================
// Cliente Supabase con SERVICE ROLE — BYPASEA RLS.
//
// ⚠️ REGLA DE USO: sólo para operaciones que legítimamente no tienen usuario en
// sesión (webhooks de Stripe/Resend, cron jobs) o que deben cruzar fronteras de
// tenant por diseño (lista de supresión global de emails).
//
// Para todo lo que se hace EN NOMBRE de un usuario usa createUserClient() de
// ./server.ts: respeta RLS y hace imposible una fuga de datos entre cuentas
// aunque el código de la ruta olvide un `.eq("user_id", …)`.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (cached) return cached;
  const env = getEnv();
  cached = createClient(env.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Sólo para tests: fuerza recrear el cliente tras cambiar el entorno. */
export function resetServiceClient(): void {
  cached = null;
}
