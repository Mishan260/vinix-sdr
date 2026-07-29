// lib/supabase/browser.ts
// ============================================================================
// Cliente Supabase de NAVEGADOR (anon key, sujeta a RLS).
// Lo usan los formularios de login/registro/recuperación y el hook useUser.
// ============================================================================

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import type { TypedSupabaseClient } from "./types";

let cached: TypedSupabaseClient | null = null;

export function getBrowserClient(): TypedSupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Añádelas a .env.local y reinicia el servidor."
    );
  }

  cached = createBrowserClient<Database>(url, key);
  return cached;
}
