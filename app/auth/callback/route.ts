// app/auth/callback/route.ts
// ============================================================================
// Punto de aterrizaje de los enlaces por email: confirmación de cuenta,
// recuperación de contraseña, invitación y enlace mágico.
//
// POR QUÉ TRES FORMATOS: Supabase entrega el enlace de vuelta de maneras
// distintas según la plantilla de correo y el flujo configurado:
//
//   1. ?code=...                   → flujo PKCE (plantillas nuevas)
//   2. ?token_hash=...&type=signup → verificación por OTP (plantilla por
//                                    defecto de «Confirm signup»)
//   3. ?error=...&error_description → el propio Supabase informa del fallo
//
// Manejar sólo el primero hacía que la confirmación acabase en «missing_code»
// y el usuario aterrizaba en el login sin ninguna explicación.
//
// Ventaja añadida del camino 2: `verifyOtp` no necesita la cookie con el
// verificador PKCE, así que funciona aunque el enlace se abra en otro
// navegador o dispositivo distinto al del registro — que es lo habitual.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createUserClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/** Sólo rutas internas: evita convertir el callback en un redirector abierto. */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

/** A dónde llevar al usuario según el tipo de enlace que ha abierto. */
function destinationFor(type: string | null): string {
  switch (type) {
    case "recovery":
      return "/reset-password";
    case "invite":
    case "magiclink":
      return "/dashboard?bienvenido=1";
    case "email_change":
      return "/dashboard?email_actualizado=1";
    default:
      // signup / email: cuenta recién verificada
      return "/bienvenida?verificado=1";
  }
}

const OTP_TYPES: readonly string[] = [
  "signup",
  "email",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
];

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const supabaseError = searchParams.get("error");
  const supabaseErrorCode = searchParams.get("error_code");

  // ── Caso 3: el propio Supabase informa de un fallo ────────────────────────
  if (supabaseError) {
    const description = searchParams.get("error_description") ?? supabaseError;
    logger.warn("auth.callback.provider_error", {
      error: supabaseError,
      code: supabaseErrorCode,
      description,
    });

    // `otp_expired` y `access_denied` casi siempre significan enlace caducado
    const motivo =
      supabaseErrorCode === "otp_expired" || /expired/i.test(description)
        ? "enlace_caducado"
        : "enlace_invalido";

    return NextResponse.redirect(`${origin}/login?motivo=${motivo}`);
  }

  const destino = safeNext(searchParams.get("next"), destinationFor(type));

  try {
    const supabase = await createUserClient();

    // ── Caso 2: verificación por token_hash ─────────────────────────────────
    if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash,
      });

      if (error) {
        logger.warn("auth.callback.verify_otp_failed", { type, message: error.message });
        return NextResponse.redirect(
          `${origin}/login?motivo=${/expired/i.test(error.message) ? "enlace_caducado" : "enlace_invalido"}`
        );
      }

      logger.info("auth.callback.verified", { type, via: "token_hash" });
      return NextResponse.redirect(`${origin}${destino}`);
    }

    // ── Caso 1: intercambio PKCE ────────────────────────────────────────────
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        logger.warn("auth.callback.exchange_failed", { message: error.message });
        // El fallo típico aquí es abrir el enlace en otro navegador: la cookie
        // con el verificador PKCE no existe en ese dispositivo.
        return NextResponse.redirect(`${origin}/login?motivo=otro_navegador`);
      }

      logger.info("auth.callback.verified", { type, via: "pkce" });
      return NextResponse.redirect(`${origin}${destino}`);
    }

    // ── Sin ningún parámetro reconocible ────────────────────────────────────
    logger.warn("auth.callback.no_params", { params: [...searchParams.keys()].join(",") });
    return NextResponse.redirect(`${origin}/login?motivo=enlace_incompleto`);
  } catch (error) {
    logger.error("auth.callback.unexpected", { error });
    return NextResponse.redirect(`${origin}/login?motivo=error_inesperado`);
  }
}
