// lib/supabase/browser.ts
// ============================================================================
// Cliente Supabase de NAVEGADOR (anon key, sujeta a RLS).
// Lo usan los formularios de login/registro/recuperación y el hook useUser.
// ============================================================================

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Añádelas a .env.local y reinicia el servidor."
    );
  }

  cached = createBrowserClient(url, key);
  return cached;
}
