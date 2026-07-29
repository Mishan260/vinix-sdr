import type { NextConfig } from "next";
import path from "node:path";

// ── Content-Security-Policy ─────────────────────────────────────────────────
// Es la cabecera que de verdad mitiga XSS: aunque alguien logre inyectar un
// <script>, el navegador se niega a ejecutarlo si no viene de un origen
// permitido.
//
// Notas sobre las concesiones (cada 'unsafe-*' está aquí por un motivo real):
//
//   script-src 'unsafe-inline'  → Next inyecta el payload de hidratación como
//       script inline. Eliminarlo exige nonces por petición, lo que obliga a
//       renderizado dinámico en todas las páginas y mata el prerender estático.
//   script-src 'unsafe-eval'    → sólo en desarrollo: lo necesita Fast Refresh.
//   style-src 'unsafe-inline'   → Tailwind y los `style={{…}}` de React.
//   connect-src supabase        → el cliente del navegador habla con la API y
//       con Realtime (wss) para la sesión de autenticación.
//
// frame-ancestors 'none' duplica a X-Frame-Options a propósito: es el que
// respetan los navegadores modernos.
function contentSecurityPolicy(isDev: boolean): string {
  const supabase = "https://*.supabase.co wss://*.supabase.co";

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} https://api.stripe.com https://api.openai.com`,
    // Stripe Checkout y el Customer Portal se abren en un iframe propio
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    // Los formularios sólo pueden enviarse a nuestro origen: bloquea el
    // secuestro de un <form> inyectado para exfiltrar datos
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Evita que Next infiera una raíz equivocada cuando hay otros lockfiles
  // en directorios superiores (warning "multiple lockfiles" en el build).
  outputFileTracingRoot: path.join(__dirname),

  // No anunciar el framework en cada respuesta
  poweredByHeader: false,

  // Comprime las respuestas del servidor
  compress: true,

  // Elimina console.* del bundle de producción salvo errores y avisos:
  // reduce peso y evita filtrar trazas de depuración al navegador.
  compiler: {
    removeConsole: isDev ? false : { exclude: ["error", "warn"] },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          // Aísla el contexto de navegación: impide que otra pestaña con
          // referencia a la nuestra lea su objeto window
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Fuerza HTTPS durante un año, incluidos subdominios
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Las respuestas de la API nunca deben cachearse: son por usuario.
        // Mitiga además la clase de fallos de "cache confusion" en multi-tenant.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
