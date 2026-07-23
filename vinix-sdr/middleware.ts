// middleware.ts
// ============================================================================
// Refresco de sesión + protección de rutas.
//
// Se ejecuta en cada petición y hace dos cosas:
//   1. Renueva el token de Supabase y reescribe las cookies. Sin esto, la
//      sesión de un Server Component caduca y el usuario aparece deslogueado
//      de forma intermitente.
//   2. Corta el acceso a rutas privadas antes de llegar a la página.
//
// El middleware es una PRIMERA barrera, no la única: la autorización real la
// imponen RLS en Postgres y `authedRoute` en cada handler. Un fallo aquí no
// expone datos, sólo dejaría pasar una petición que el siguiente nivel rechaza.
// ============================================================================

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export const config = {
  // Se excluyen estáticos y el favicon: no necesitan sesión y añadirla
  // multiplicaría las llamadas a Supabase sin ningún beneficio.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

/** Rutas accesibles sin sesión. */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/auth/signout"];

/** Rutas de API que se autentican por firma o secreto, no por sesión de usuario. */
const UNPROTECTED_API = [
  "/api/health",
  "/api/agent/webhook/inbound", // firma Svix de Resend
  "/api/billing/webhook",       // firma de Stripe
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isUnprotectedApi(pathname: string): boolean {
  return UNPROTECTED_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isUnprotectedApi(pathname)) return NextResponse.next();

  // Vercel Cron se identifica con el secreto, no con una sesión de navegador
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  // Sin configuración de auth no podemos validar nada. Dejamos pasar para que
  // /api/health y la pantalla de setup expliquen qué falta, en vez de mostrar
  // un redirect infinito a /login que no se puede completar.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() (no getSession()) valida el JWT contra el servidor de Supabase:
  // getSession() se fía de la cookie, que un atacante puede falsificar.
  const { data: { user } } = await supabase.auth.getUser();

  // Con sesión activa, las pantallas de login/registro no tienen sentido
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!user && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Necesitas iniciar sesión para continuar.", code: "unauthenticated" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    // Volver a donde iba tras autenticarse
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
