import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Evita que Next infiera una raíz equivocada cuando hay otros lockfiles
  // en directorios superiores (warning "multiple lockfiles" en el build).
  outputFileTracingRoot: path.join(__dirname),

  // No anunciar el framework en cada respuesta
  poweredByHeader: false,

  // Cabeceras de seguridad para todas las rutas (panel y API)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
