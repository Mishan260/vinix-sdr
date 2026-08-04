import { describe, it, expect } from "vitest";
import { loadOnboarding } from "@/lib/onboarding/service";
import { createCountingClient } from "./helpers/counting-client";

// ============================================================================
// Tolerancia a que falte la función SQL agregada.
//
// REGRESIÓN QUE FIJA: en el proyecto nuevo las tablas existían pero
// `onboarding_overview` no. `loadOnboarding` devolvía estado vacío, así que
// `valueProposition` era siempre null y el usuario recibía «necesitamos saber
// qué vendes» aunque ya lo hubiera guardado.
//
// La función agregada es una optimización. Si no está, se leen las tablas.
// ============================================================================

const USER = "44444444-4444-4444-4444-444444444444";

/** Doble cuyo rpc falla como lo hace PostgREST con una función inexistente. */
function clientSinRpc(fixtures: Record<string, { rows?: unknown[]; count?: number }>) {
  const client = createCountingClient(fixtures);
  const original = client.asClient.rpc;

  client.asClient.rpc = () =>
    Promise.resolve({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.onboarding_overview(p_user_id)",
      },
      count: null,
      status: 404,
    });

  return { client, original };
}

describe("loadOnboarding sin la función agregada", () => {
  it("lee la propuesta de valor de la tabla en lugar de devolver null", async () => {
    const { client } = clientSinRpc({
      onboarding_progress: {
        rows: [
          {
            welcomed_at: "2026-01-01T10:00:00Z",
            dismissed_at: null,
            completed_at: null,
            value_proposition: "Reuniones cualificadas para agencias",
            target_audience: "agencias de diseño",
            main_product: "prospección gestionada",
            dismissed_tips: [],
            first_campaign_at: null,
            first_lead_at: null,
            first_research_at: null,
            first_draft_at: null,
            first_send_at: null,
          },
        ],
      },
      campaigns: { rows: [] },
    });

    const snapshot = await loadOnboarding(client.asClient, USER);

    // Este era exactamente el bug: aquí llegaba null
    expect(snapshot.valueProposition).toBe("Reuniones cualificadas para agencias");
    expect(snapshot.targetAudience).toBe("agencias de diseño");
    expect(snapshot.mainProduct).toBe("prospección gestionada");
  });

  it("deriva los contadores de las campañas y leads reales", async () => {
    const { client } = clientSinRpc({
      onboarding_progress: {
        rows: [
          {
            welcomed_at: "2026-01-01T10:00:00Z",
            dismissed_at: null,
            completed_at: null,
            value_proposition: "algo",
            target_audience: null,
            main_product: null,
            dismissed_tips: [],
            first_campaign_at: null,
            first_lead_at: null,
            first_research_at: null,
            first_draft_at: null,
            first_send_at: null,
          },
        ],
      },
      campaigns: { rows: [{ id: "c1", is_demo: false, sender_email: "yo@midominio.com" }] },
      leads: {
        rows: [
          { status: "ready_to_send", draft_body: "hola" },
          { status: "pending", draft_body: null },
          { status: "sent", draft_body: "otro" },
        ],
      },
      emails_sent: { rows: [], count: 2 },
    });

    const snapshot = await loadOnboarding(client.asClient, USER);

    expect(snapshot.leadCount).toBe(3);
    expect(snapshot.researchedCount).toBe(2); // todos menos el 'pending'
    expect(snapshot.draftCount).toBe(2);
    expect(snapshot.sentCount).toBe(2);
    expect(snapshot.hasRealCampaign).toBe(true);
    expect(snapshot.hasSenderDomain).toBe(true);
  });

  it("distingue las campañas de ejemplo de las reales", async () => {
    const { client } = clientSinRpc({
      onboarding_progress: {
        rows: [
          {
            welcomed_at: null, dismissed_at: null, completed_at: null,
            value_proposition: null, target_audience: null, main_product: null,
            dismissed_tips: [], first_campaign_at: null, first_lead_at: null,
            first_research_at: null, first_draft_at: null, first_send_at: null,
          },
        ],
      },
      campaigns: { rows: [{ id: "demo", is_demo: true, sender_email: "" }] },
    });

    const snapshot = await loadOnboarding(client.asClient, USER);

    expect(snapshot.hasDemoCampaign).toBe(true);
    expect(snapshot.hasRealCampaign).toBe(false);
    // Los leads de la demo no cuentan como progreso real
    expect(snapshot.leadCount).toBe(0);
  });

  it("crea la fila de progreso si el trigger de alta no la creó", async () => {
    const { client } = clientSinRpc({
      onboarding_progress: { rows: [] },
      campaigns: { rows: [] },
    });

    await loadOnboarding(client.asClient, USER);

    const insercion = client.queries.find(
      (q) => q.operation === "insert" && q.table === "onboarding_progress"
    );
    expect(insercion, "debería crear la fila que falta").toBeDefined();
  });

  it("no deja el producto inutilizable: siempre devuelve un estado", async () => {
    const { client } = clientSinRpc({ onboarding_progress: { rows: [] }, campaigns: { rows: [] } });
    const snapshot = await loadOnboarding(client.asClient, USER);

    // Lo importante es que no lance: el onboarding es una ayuda, no un requisito
    expect(snapshot).toBeDefined();
    expect(snapshot.leadCount).toBe(0);
  });
});
