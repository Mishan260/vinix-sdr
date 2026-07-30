import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCountingClient } from "./helpers/counting-client";

// ============================================================================
// Analítica del onboarding.
//
// Dos propiedades que deben cumplirse siempre:
//   1. PRIVACIDAD: nunca se guarda texto escrito por el usuario ni las
//      empresas que investiga. Sólo el paso, la duración y una categoría.
//   2. NO BLOQUEA: perder una métrica jamás puede romper el flujo. Si la
//      escritura falla, la función tiene que resolverse igual.
//
// El cliente admin se sustituye por el doble que registra las escrituras.
// ============================================================================

const adminClient = createCountingClient({
  onboarding_events: { rows: [] },
  onboarding_progress: { rows: [{ first_campaign_at: null }] },
});

vi.mock("@/lib/supabase/admin", () => ({
  createServiceClient: () => adminClient.asClient,
}));

const { recordStep, markMilestone } = await import("@/lib/onboarding/service");

const USER = "33333333-3333-3333-3333-333333333333";

describe("recordStep", () => {
  beforeEach(() => adminClient.reset());

  it("registra el paso del embudo", async () => {
    await recordStep(USER, "welcome_viewed");

    expect(adminClient.count).toBe(1);
    expect(adminClient.queries[0].table).toBe("onboarding_events");
    expect(adminClient.queries[0].columns).toContain("welcome_viewed");
  });

  it("calcula la duración desde el inicio del recorrido", async () => {
    const hace30s = new Date(Date.now() - 30_000).toISOString();
    await recordStep(USER, "offer_submitted", { startedAt: hace30s });

    const payload = JSON.parse(adminClient.queries[0].columns ?? "{}");
    // Alrededor de 30 s; se deja margen por el tiempo de ejecución
    expect(payload.elapsed_ms).toBeGreaterThanOrEqual(29_000);
    expect(payload.elapsed_ms).toBeLessThan(35_000);
  });

  it("deja la duración a null si no se indica el inicio", async () => {
    await recordStep(USER, "draft_viewed");
    const payload = JSON.parse(adminClient.queries[0].columns ?? "{}");
    expect(payload.elapsed_ms).toBeNull();
  });

  it("nunca guarda texto libre del usuario", async () => {
    // El detalle sólo admite categorías del propio sistema
    await recordStep(USER, "research_failed", { detail: { reason: "sin_gancho" } });

    const escrito = adminClient.queries[0].columns ?? "";
    expect(escrito).toContain("sin_gancho");
    // No debe existir ningún campo que pueda arrastrar la oferta o la empresa
    expect(escrito).not.toMatch(/value_proposition|company_url|company_name/);
  });

  it("no propaga el fallo si la escritura revienta", async () => {
    // Perder una métrica no puede tumbar el recorrido del usuario
    const roto = {
      from: () => {
        throw new Error("base de datos caída");
      },
    };
    const original = adminClient.asClient.from;
    adminClient.asClient.from = roto.from;

    await expect(recordStep(USER, "welcome_viewed")).resolves.toBeUndefined();

    adminClient.asClient.from = original;
  });

  it("nunca se registra una duración negativa", async () => {
    // Un reloj desfasado no debe producir métricas imposibles
    const futuro = new Date(Date.now() + 60_000).toISOString();
    await recordStep(USER, "offer_submitted", { startedAt: futuro });

    const payload = JSON.parse(adminClient.queries[0].columns ?? "{}");
    expect(payload.elapsed_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("markMilestone", () => {
  beforeEach(() => adminClient.reset());

  it("escribe el hito la primera vez", async () => {
    await markMilestone(USER, "first_campaign_at");

    const escritura = adminClient.queries.find((q) => q.operation === "update");
    expect(escritura?.columns).toContain("first_campaign_at");
  });

  it("no sobrescribe un hito ya registrado", async () => {
    // La métrica es «tiempo hasta el PRIMER X»: sobrescribir la falsearía
    const yaMarcado = createCountingClient({
      onboarding_progress: { rows: [{ first_campaign_at: "2026-01-01T10:00:00Z" }] },
    });
    const original = adminClient.asClient.from;
    adminClient.asClient.from = yaMarcado.asClient.from;

    await markMilestone(USER, "first_campaign_at");

    expect(yaMarcado.queries.filter((q) => q.operation === "update")).toHaveLength(0);
    adminClient.asClient.from = original;
  });

  it("no propaga el fallo si la escritura revienta", async () => {
    const original = adminClient.asClient.from;
    adminClient.asClient.from = () => {
      throw new Error("base de datos caída");
    };

    await expect(markMilestone(USER, "first_send_at")).resolves.toBeUndefined();

    adminClient.asClient.from = original;
  });
});
