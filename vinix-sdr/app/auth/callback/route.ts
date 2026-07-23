// app/auth/callback/route.ts
// ============================================================================
// Punto de aterrizaje de los enlaces por email (confirmación de cuenta y
// recuperación de contraseña). Canjea el código por una sesión y redirige.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";

  // Sólo rutas internas: sin esta comprobación, ?next=https://malo.example
  // convierte el callback en un redirector abierto para phishing.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  try {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      logger.warn("auth.callback.exchange_failed", { message: error.message });
      return NextResponse.redirect(`${origin}/login?error=invalid_link`);
    }

    return NextResponse.redirect(`${origin}${next}`);
  } catch (error) {
    logger.error("auth.callback.error", { error });
    return NextResponse.redirect(`${origin}/login?error=unexpected`);
  }
}
