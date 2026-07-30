import { describe, it, expect, beforeEach } from "vitest";
import { loadOnboarding, updateProgress, createDemoData, removeDemoData } from "@/lib/onboarding/service";
import { createCountingClient, describeQueries } from "./helpers/counting-client";

// ============================================================================
// Servicio del onboarding.
//
// Se prueba con el doble que cuenta round-trips, igual que loadAccount: el
// panel llama a loadOnboarding en cada carga, así que su coste importa.
// ============================================================================

const USER = "22222222-2222-2222-2222-222222222222";

const overviewRow = (over: Record<string, unknown> = {}) => ({
  "rpc:onboarding_overview": {
    rows: [
      {
        welcomed_at: "2026-01-01T10:00:00Z",
        dismissed_at: null,
        completed_at: null,
        value_proposition: "Reuniones cualificadas para agencias",
        dismissed_tips: ["pipeline_bar"],
        first_campaign_at: "2026-01-01T10:05:00Z",
        first_lead_at: "2026-01-01T10:06:00Z",
        first_research_at: "2026-01-01T10:07:00Z",
        first_draft_at: "2026-01-01T10:08:00Z",
        first_send_at: null,
        has_real_campaign: true,
        has_demo_campaign: false,
        lead_count: 12,
        researched_count: 8,
        draft_count: 5,
        sent_count: 0,
        has_sender_domain: true,
        ...over,
      },
    ],
  },
});

describe("loadOnboarding", () => {
  it("resuelve el estado en un único round-trip", async () => {
    const client = createCountingClient(overviewRow());
    await loadOnboarding(client.asClient, USER);

    expect(
      client.count,
      `Hizo ${client.count} consultas:\n${describeQueries(client.queries)}`
    ).toBe(1);
    expect(client.queries[0].table).toBe("rpc:onboarding_overview");
  });

  it("convierte la fila de SQL al modelo de la aplicación", async () => {
    const client = createCountingClient(overviewRow());
    const snapshot = await loadOnboarding(client.asClient, USER);

    expect(snapshot.valueProposition).toBe("Reuniones cualificadas para agencias");
    expect(snapshot.leadCount).toBe(12);
    expect(snapshot.draftCount).toBe(5);
    expect(snapshot.hasSenderDomain).toBe(true);
    expect(snapshot.dismissedTips).toEqual(["pipeline_bar"]);
  });

  it("devuelve estado vacío si no existe la fila de progreso", async () => {
    // Usuario anterior a la migración: el onboarding se oculta, no rompe
    const client = createCountingClient({ "rpc:onboarding_overview": { rows: [] } });
    const snapshot = await loadOnboarding(client.asClient, USER);

    expect(snapshot.valueProposition).toBeNull();
    expect(snapshot.leadCount).toBe(0);
    expect(snapshot.dismissedTips).toEqual([]);
  });

  it("normaliza dismissed_tips nulo a lista vacía", async () => {
    const client = createCountingClient(overviewRow({ dismissed_tips: null }));
    const snapshot = await loadOnboarding(client.asClient, USER);
    expect(snapshot.dismissedTips).toEqual([]);
  });
});

describe("updateProgress", () => {
  let client: ReturnType<typeof createCountingClient>;

  beforeEach(() => {
    client = createCountingClient({ onboarding_progress: { rows: [{ dismissed_tips: [] }] } });
  });

  it("no escribe nada si el parche está vacío", async () => {
    await updateProgress(client.asClient, USER, {});
    expect(client.count).toBe(0);
  });

  it("marca la bienvenida con una sola escritura", async () => {
    await updateProgress(client.asClient, USER, { welcomedAt: true });

    expect(client.count).toBe(1);
    expect(client.queries[0].operation).toBe("update");
    expect(client.queries[0].columns).toContain("welcomed_at");
  });

  it("guarda la propuesta de valor", async () => {
    await updateProgress(client.asClient, USER, { valueProposition: "mi oferta" });
    expect(client.queries[0].columns).toContain("value_proposition");
  });

  it("añade un consejo descartado sin perder los anteriores", async () => {
    const conPrevios = createCountingClient({
      onboarding_progress: { rows: [{ dismissed_tips: ["pipeline_bar"] }] },
    });

    await updateProgress(conPrevios.asClient, USER, { dismissTip: "draft_review" });

    const escritura = conPrevios.queries.find((q) => q.operation === "update");
    expect(escritura?.columns).toContain("pipeline_bar");
    expect(escritura?.columns).toContain("draft_review");
  });

  it("no duplica un consejo ya descartado", async () => {
    const yaDescartado = createCountingClient({
      onboarding_progress: { rows: [{ dismissed_tips: ["draft_review"] }] },
    });

    await updateProgress(yaDescartado.asClient, USER, { dismissTip: "draft_review" });

    // Sólo la lectura previa: no hay nada que escribir
    const escrituras = yaDescartado.queries.filter((q) => q.operation === "update");
    expect(escrituras).toHaveLength(0);
  });
});

describe("createDemoData", () => {
  it("reutiliza la campaña de ejemplo si ya existe", async () => {
    const client = createCountingClient({ campaigns: { rows: [{ id: "demo-1" }] } });
    const result = await createDemoData(client.asClient, USER);

    expect(result.campaignId).toBe("demo-1");
    // Una sola consulta: la comprobación. No se crea nada.
    expect(client.count).toBe(1);
  });

  it("crea campaña y leads cuando no existe", async () => {
    // La primera consulta (comprobar existencia) no devuelve fila; la de
    // inserción sí. El doble devuelve las mismas filas para la tabla, así que
    // se comprueba el orden de operaciones en lugar del identificador.
    const client = createCountingClient({
      campaigns: { rows: [] },
      leads: { rows: [] },
    });

    await createDemoData(client.asClient, USER).catch(() => {
      // El doble no simula `.single()` sobre un insert vacío; lo relevante es
      // que se intentó insertar la campaña.
    });

    const operaciones = client.queries.map((q) => `${q.operation} ${q.table}`);
    expect(operaciones[0]).toBe("select campaigns");
    expect(operaciones[1]).toBe("insert campaigns");
  });

  it("la campaña de ejemplo se marca y se deja en pausa", async () => {
    const client = createCountingClient({ campaigns: { rows: [] }, leads: { rows: [] } });
    await createDemoData(client.asClient, USER).catch(() => {});

    const insercion = client.queries.find((q) => q.operation === "insert" && q.table === "campaigns");
    // is_demo + paused son lo que impide que envíe emails de verdad
    expect(insercion?.columns).toContain("is_demo");
    expect(insercion?.columns).toContain("paused");
  });
});

describe("removeDemoData", () => {
  it("borra sólo las campañas marcadas como ejemplo", async () => {
    const client = createCountingClient({ campaigns: { rows: [{ id: "demo-1" }] } });
    const removed = await removeDemoData(client.asClient, USER);

    expect(removed).toBe(1);
    const borrado = client.queries[0];
    expect(borrado.operation).toBe("delete");
    expect(borrado.filters.join(" ")).toContain("is_demo");
  });

  it("devuelve 0 si no había ninguna", async () => {
    const client = createCountingClient({ campaigns: { rows: [] } });
    expect(await removeDemoData(client.asClient, USER)).toBe(0);
  });
});
