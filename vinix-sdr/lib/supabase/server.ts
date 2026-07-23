// lib/supabase/server.ts
// ============================================================================
// Cliente Supabase ligado a la SESIÓN del usuario (cookies) para Server
// Components y Route Handlers.
//
// Usa la anon key, así que todas las consultas pasan por RLS: el aislamiento
// entre cuentas lo garantiza Postgres, no la disciplina del programador.
// ============================================================================

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { errors } from "@/lib/errors";

export async function createUserClient(): Promise<SupabaseClient> {
  const env = getEnv();
  if (!env.supabaseAnonKey) {
    throw errors.config("NEXT_PUBLIC_SUPABASE_ANON_KEY no configurada: sin ella no hay login de usuarios.");
  }

  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components no pueden escribir cookies. El middleware ya
          // refresca la sesión en cada petición, así que es seguro ignorarlo.
        }
      },
    },
  });
}

/** Usuario autenticado, o null. Nunca lanza. */
export async function getUser(): Promise<User | null> {
  try {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}

/** Usuario autenticado; lanza AppError 401 si no hay sesión. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw errors.unauthenticated();
  return user;
}
