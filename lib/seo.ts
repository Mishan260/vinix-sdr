// lib/seo.ts
// ============================================================================
// Metadatos y datos estructurados en un solo sitio.
//
// El posicionamiento del producto vive aquí, no repartido por plantillas: el
// título, la descripción y el JSON-LD deben contar la misma historia que la
// landing. Si cambia el mensaje, cambia en un archivo.
// ============================================================================

import type { Metadata } from "next";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";

export const SITE = {
  name: "Vinix",
  fullName: "Vinix SDR",
  /** Promesa central: es la frase que debe recordarse del producto. */
  tagline: "El SDR con IA que investiga antes de escribir",
  description:
    "Vinix investiga cada empresa antes de redactar. Si no encuentra un motivo real para escribir, no escribe: te lo marca para revisión. Menos emails, mejor investigados, cero inventados.",
  locale: "es_ES",
  twitter: "@vinixsdr",
} as const;

/** URL pública del sitio. En local cae a localhost para que OG y sitemap funcionen. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return configured || "http://localhost:3000";
}

export function absoluteUrl(path = "/"): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

interface PageMetaOptions {
  title?: string;
  description?: string;
  path?: string;
  /** Las pantallas privadas no deben indexarse. */
  noIndex?: boolean;
}

export function pageMetadata({ title, description, path = "/", noIndex = false }: PageMetaOptions = {}): Metadata {
  const fullTitle = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
  const desc = description ?? SITE.description;
  const url = absoluteUrl(path);
  // La imagen social se genera en tiempo de ejecución (app/opengraph-image.tsx)
  const image = absoluteUrl("/opengraph-image");

  return {
    metadataBase: new URL(siteUrl()),
    title: fullTitle,
    description: desc,
    alternates: { canonical: url },
    ...(noIndex && { robots: { index: false, follow: false } }),
    openGraph: {
      type: "website",
      locale: SITE.locale,
      url,
      siteName: SITE.fullName,
      title: fullTitle,
      description: desc,
      images: [{ url: image, width: 1200, height: 630, alt: SITE.tagline }],
    },
    twitter: {
      card: "summary_large_image",
      site: SITE.twitter,
      title: fullTitle,
      description: desc,
      images: [image],
    },
  };
}

// ── Datos estructurados (Schema.org) ────────────────────────────────────────
// Permiten a Google mostrar el producto con precios y valoración en los
// resultados, y son lo que consumen los buscadores con IA para describirlo.

export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.fullName,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Sales Automation",
    operatingSystem: "Web",
    description: SITE.description,
    url: siteUrl(),
    inLanguage: "es",
    offers: [PLANS.free, PLANS.pro, PLANS.agency].map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      description: plan.tagline,
      price: String(plan.monthlyPrice),
      priceCurrency: "EUR",
      category: plan.monthlyPrice === 0 ? "Free" : "Subscription",
    })),
    featureList: [
      "Investigación automática de cada empresa antes de redactar",
      "Redacción con IA sin datos inventados",
      "Aprobación humana antes de cada envío",
      "Clasificación automática de respuestas",
      "Secuencias de seguimiento configurables",
    ],
  };
}

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.fullName,
    url: siteUrl(),
    description: SITE.description,
    logo: absoluteUrl("/icon"),
  };
}

export function faqSchema(items: readonly { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** Trial en días, para no repetir la cifra en los textos de marketing. */
export const TRIAL_DAYS_LABEL = `${TRIAL_DAYS} días`;
