// app/page.tsx
// ============================================================================
// Landing pública.
//
// Es un Server Component: todo el contenido se envía como HTML ya renderizado.
// Sólo tres piezas necesitan JavaScript en el navegador (la cabecera con
// scroll, la demo animada y el acordeón de preguntas), y están aisladas en sus
// propios componentes cliente. Eso mantiene el peso bajo y hace que el
// contenido sea indexable sin ejecutar nada.
// ============================================================================

import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink, Badge, Card, Container, Eyebrow } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { PipelineDemo } from "@/components/marketing/pipeline-demo";
import { FaqList } from "@/components/marketing/faq-list";
import {
  DIFFERENTIATORS,
  FAQ,
  FINAL_CTA,
  HERO,
  HERO_STATS,
  HOW_IT_WORKS,
  PROBLEM,
  SOCIAL_PROOF,
  USE_CASES,
} from "@/lib/marketing/content";
import { faqSchema, organizationSchema, pageMetadata, softwareApplicationSchema } from "@/lib/seo";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";

export const metadata: Metadata = pageMetadata();

export default function LandingPage() {
  // Un solo bloque con los tres esquemas: menos nodos en el HTML y Google los
  // procesa igual dentro de un @graph.
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), softwareApplicationSchema(), faqSchema(FAQ)],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <SiteHeader />

      <main id="contenido">
        <Hero />
        <SocialProof />
        <Problem />
        <HowItWorks />
        <Differentiators />
        <UseCases />
        <Testimonials />
        <PricingPreview />
        <Faq />
        <FinalCta />
      </main>

      <SiteFooter />
    </>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="bg-halo relative overflow-hidden pt-32 sm:pt-40">
      <div className="bg-grid absolute inset-0 -z-10" aria-hidden="true" />

      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="brand" className="mb-6">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            {HERO.badge}
          </Badge>

          <h1 className="text-display-lg text-balance">
            <span className="text-ink">{HERO.headline}</span>{" "}
            <span className="text-gradient">{HERO.headlineAccent}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lead text-pretty text-ink-muted">{HERO.subhead}</p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg" className="w-full sm:w-auto">
              {HERO.primaryCta}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </ButtonLink>
            <ButtonLink href="#como-funciona" variant="secondary" size="lg" className="w-full sm:w-auto">
              {HERO.secondaryCta}
            </ButtonLink>
          </div>

          <p className="mt-4 text-xs text-ink-subtle">{HERO.reassurance}</p>
        </div>

        {/* Demostración */}
        <div className="mx-auto mt-16 max-w-3xl">
          <PipelineDemo />
        </div>

        {/* Cifras: son propiedades del producto, no resultados prometidos */}
        <dl className="stagger mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3">
          {HERO_STATS.map((stat) => (
            <div key={stat.label} className="text-center sm:text-left">
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <p className="text-3xl font-semibold tracking-tight text-ink">{stat.value}</p>
                <p className="mt-1 text-sm font-medium text-ink">{stat.label}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">{stat.detail}</p>
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

// ── Prueba social ───────────────────────────────────────────────────────────
function SocialProof() {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <p className="text-center text-xs font-medium uppercase tracking-wider text-ink-subtle">
          {SOCIAL_PROOF.logosLabel}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-55 grayscale">
          {SOCIAL_PROOF.logos.map((name) => (
            <span key={name} className="text-lg font-semibold tracking-tight text-ink-muted">
              {name}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}

// ── Problema ────────────────────────────────────────────────────────────────
function Problem() {
  return (
    <section className="border-y border-line bg-surface py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{PROBLEM.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">{PROBLEM.title}</h2>
          <p className="mt-4 text-pretty leading-relaxed text-ink-muted">{PROBLEM.body}</p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {PROBLEM.points.map((point) => (
            <div key={point.title} className="rounded-card border border-line bg-canvas p-6">
              <h3 className="text-heading text-ink">{point.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{point.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

// ── Cómo funciona ───────────────────────────────────────────────────────────
function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{HOW_IT_WORKS.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">{HOW_IT_WORKS.title}</h2>
          <p className="mt-4 text-pretty leading-relaxed text-ink-muted">{HOW_IT_WORKS.subtitle}</p>
        </div>

        <ol className="mt-14 space-y-4">
          {HOW_IT_WORKS.steps.map((step, index) => (
            <li key={step.number}>
              <Card className="grid gap-5 p-6 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-8">
                <div className="flex items-start gap-4 sm:flex-col sm:items-center">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 font-mono text-sm font-medium text-brand-700 dark:text-brand-400">
                    {step.number}
                  </span>
                  {/* Línea que conecta los pasos, salvo en el último */}
                  {index < HOW_IT_WORKS.steps.length - 1 && (
                    <span className="hidden w-px flex-1 bg-line sm:block" aria-hidden="true" />
                  )}
                </div>

                <div>
                  <h3 className="text-heading text-ink">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-muted">{step.body}</p>
                  <p className="mt-3 inline-block rounded-md bg-line/40 px-2.5 py-1 font-mono text-[11px] text-ink-subtle">
                    {step.detail}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

// ── Diferenciación ──────────────────────────────────────────────────────────
function Differentiators() {
  return (
    <section id="diferencias" className="scroll-mt-20 border-y border-line bg-surface py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{DIFFERENTIATORS.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">{DIFFERENTIATORS.title}</h2>
          <p className="mt-4 text-pretty leading-relaxed text-ink-muted">{DIFFERENTIATORS.subtitle}</p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {DIFFERENTIATORS.items.map((item) => (
            <div
              key={item.title}
              className={`rounded-card border p-6 ${
                item.highlight
                  ? "ring-brand-soft border-transparent bg-brand-500/[0.06] md:col-span-2 lg:col-span-1 lg:row-span-2"
                  : "border-line bg-canvas"
              }`}
            >
              {item.highlight && (
                <Badge tone="brand" className="mb-4">
                  La diferencia
                </Badge>
              )}
              <h3 className="text-heading text-ink">{item.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

// ── Casos de uso ────────────────────────────────────────────────────────────
function UseCases() {
  return (
    <section id="casos" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{USE_CASES.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">{USE_CASES.title}</h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {USE_CASES.items.map((item) => (
            <Card key={item.title} interactive className="flex flex-col p-7">
              <h3 className="text-heading text-ink">{item.title}</h3>
              <p className="mt-2.5 flex-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>
              <p className="mt-5 border-t border-line pt-4 text-xs font-medium text-brand-700 dark:text-brand-400">
                {item.metric}
              </p>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}

// ── Testimonios ─────────────────────────────────────────────────────────────
function Testimonials() {
  return (
    <section className="border-y border-line bg-surface py-20 sm:py-28">
      <Container>
        <div className="grid gap-6 md:grid-cols-3">
          {SOCIAL_PROOF.testimonials.map((testimonial) => (
            <figure key={testimonial.quote} className="rounded-card border border-line bg-canvas p-7">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand-500/40" fill="currentColor" aria-hidden="true">
                <path d="M9.5 5C6.5 6.8 5 9.4 5 12.8V19h6.2v-6.2H8.4c0-2.2.9-3.8 2.7-4.9L9.5 5Zm9 0c-3 1.8-4.5 4.4-4.5 7.8V19h6.2v-6.2h-2.8c0-2.2.9-3.8 2.7-4.9L18.5 5Z" />
              </svg>
              <blockquote className="mt-4 text-sm leading-relaxed text-ink">{testimonial.quote}</blockquote>
              <figcaption className="mt-5 border-t border-line pt-4">
                <p className="text-sm font-medium text-ink">{testimonial.author}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">{testimonial.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* Honestidad explícita: no hay clientes reales todavía */}
        <p className="mt-8 text-center text-xs text-ink-subtle">
          Perfiles de cliente objetivo. Publicaremos testimonios reales, con nombre y empresa, en cuanto los tengamos.
        </p>
      </Container>
    </section>
  );
}

// ── Adelanto de precios ─────────────────────────────────────────────────────
function PricingPreview() {
  const plans = [PLANS.free, PLANS.pro, PLANS.agency];

  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Precios</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">Empieza gratis. Paga cuando funcione.</h2>
          <p className="mt-4 text-pretty leading-relaxed text-ink-muted">
            {TRIAL_DAYS} días con todo el plan Pro incluidos, sin tarjeta. Al terminar pasas a Free y conservas tus datos.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-card border p-7 ${
                plan.highlight ? "border-brand-500 bg-surface shadow-glow" : "border-line bg-surface"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-700 px-3 py-1 text-[11px] font-semibold text-white dark:bg-brand-500 dark:text-ink-inverted">
                  Recomendado
                </span>
              )}

              <h3 className="text-heading text-ink">{plan.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{plan.tagline}</p>

              <p className="mt-5">
                <span className="text-3xl font-semibold tracking-tight text-ink">{plan.monthlyPrice} €</span>
                <span className="text-sm text-ink-subtle"> /mes</span>
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.slice(0, 4).map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-ink-muted">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <ButtonLink
                href="/signup"
                variant={plan.highlight ? "primary" : "secondary"}
                className="mt-7 w-full"
              >
                {plan.monthlyPrice === 0 ? "Empezar gratis" : `Probar ${plan.name}`}
              </ButtonLink>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm">
          <Link href="/pricing" className="font-medium text-brand-700 hover:underline dark:text-brand-400">
            Ver la comparativa completa →
          </Link>
        </p>
      </Container>
    </section>
  );
}

// ── Preguntas frecuentes ────────────────────────────────────────────────────
function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-t border-line bg-surface py-20 sm:py-28">
      <Container className="max-w-3xl">
        <div className="text-center">
          <Eyebrow>Preguntas frecuentes</Eyebrow>
          <h2 className="mt-3 text-title text-balance text-ink">Lo que suelen preguntarnos</h2>
        </div>

        <div className="mt-12">
          <FaqList items={FAQ} />
        </div>
      </Container>
    </section>
  );
}

// ── Cierre ──────────────────────────────────────────────────────────────────
function FinalCta() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div className="bg-grid absolute inset-0 -z-10 opacity-60" aria-hidden="true" />

      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-display text-balance text-ink">{FINAL_CTA.title}</h2>
          <p className="mx-auto mt-5 max-w-xl text-lead text-pretty text-ink-muted">{FINAL_CTA.body}</p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/signup" size="lg" className="w-full sm:w-auto">
              {FINAL_CTA.primary}
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" size="lg" className="w-full sm:w-auto">
              {FINAL_CTA.secondary}
            </ButtonLink>
          </div>

          <p className="mt-5 text-xs text-ink-subtle">
            {TRIAL_DAYS} días de Pro · sin tarjeta · cancelas cuando quieras
          </p>
        </div>
      </Container>
    </section>
  );
}
