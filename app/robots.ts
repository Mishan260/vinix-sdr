import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // El panel contiene datos de clientes y las APIs no son contenido:
        // bloquearlos evita que aparezcan en resultados y ahorra rastreo.
        disallow: ["/api/", "/dashboard", "/reset-password", "/auth/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
