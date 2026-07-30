import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// Sólo las páginas públicas. El panel y las rutas de API no se indexan: la
// primera exige sesión y las segundas ya devuelven X-Robots-Tag: noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/pricing"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: absoluteUrl("/signup"), lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: absoluteUrl("/login"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
