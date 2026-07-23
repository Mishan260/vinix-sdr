// app/auth/signout/route.ts
// ============================================================================
// Cierre de sesión. Sólo POST: un GET permitiría desloguear a un usuario
// incrustando <img src="/auth/signout"> en cualquier página (CSRF).
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createUserClient();
    await supabase.auth.signOut();
  } catch (error) {
    // Aunque falle el borrado remoto, redirigimos: las cookies locales se
    // limpian y el usuario percibe la sesión cerrada.
    logger.warn("auth.signout.failed", { error });
  }

  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
