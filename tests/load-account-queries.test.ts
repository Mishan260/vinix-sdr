import { describe, it, expect, beforeEach } from "vitest";
import { loadAccount } from "@/lib/billing/account";
import { createCountingClient, describeQueries } from "./helpers/counting-client";

// ============================================================================
// Presupuesto de consultas de loadAccount().
//
// Se invoca en 5 endpoints (account, campaigns POST, leads/import,
// leads/export, followups POST), así que su coste se multiplica por todo el
// tráfico de escritura de la plataforma. Este test fija el presupuesto: si
// alguien añade una consulta, falla y hay que justificarla.
// ============================================================================

const USER = "11111111-1111-1111-1111-111111111111";

/** Fila que devuelve la función SQL `account_overview` (migración 0006). */
const overview = (over: Record<string, unknown> = {}) => ({
  "rpc:account_overview": {
    rows: [
      {
        plan: "pro",
        billing_cycle: "monthly",
        trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
        stripe_customer_id: "cus_123",
        campaigns_count: 3,
        leads_this_month: 42,
        has_subscription: true,
        ...over,
      },
    ],
  },
});

const fixtures = () => overview();

describe("loadAccount — presupuesto de consultas", () => {
  let client: ReturnType<typeof createCountingClient>;

  beforeEach(() => {
    client = createCountingClient(fixtures());
  });

  it("resuelve todo en un único round-trip", async () => {
    await loadAccount(client.asClient, USER);

    // Presupuesto fijado: antes eran 5 consultas, una de ellas duplicada.
    // Si alguien añade otra, este test falla y hay que justificarla.
    expect(
      client.count,
      `loadAccount hizo ${client.count} consultas:\n${describeQueries(client.queries)}`
    ).toBe(1);
  });

  it("usa la función SQL account_overview, no consultas sueltas", async () => {
    await loadAccount(client.asClient, USER);

    expect(client.queries[0].table).toBe("rpc:account_overview");
    expect(client.queries[0].operation).toBe("rpc");
  });

  it("no consulta dos veces la misma tabla", async () => {
    await loadAccount(client.asClient, USER);

    const tables = client.queries.map((q) => q.table);
    const duplicated = tables.filter((t, i) => tables.indexOf(t) !== i);

    expect(
      duplicated,
      `Tablas consultadas más de una vez: ${duplicated.join(", ")}\n${describeQueries(client.queries)}`
    ).toEqual([]);
  });

  it("devuelve el plan efectivo correcto", async () => {
    const state = await loadAccount(client.asClient, USER);

    expect(state.effective.planId).toBe("pro");
    expect(state.effective.isTrial).toBe(false);
    expect(state.effective.limits.followUps).toBe(true);
  });

  it("devuelve el uso real: campañas y leads del mes", async () => {
    const state = await loadAccount(client.asClient, USER);

    expect(state.usage.campaigns).toBe(3);
    expect(state.usage.leadsThisMonth).toBe(42);
  });

  it("expone el cliente de Stripe y la elegibilidad de trial", async () => {
    const state = await loadAccount(client.asClient, USER);

    expect(state.stripeCustomerId).toBe("cus_123");
    // Ya tiene una suscripción: el trial está consumido
    expect(state.eligibleForTrial).toBe(false);
  });

  it("marca elegible para trial a quien nunca tuvo suscripción", async () => {
    const sinSuscripcion = createCountingClient(overview({ has_subscription: false }));
    const state = await loadAccount(sinSuscripcion.asClient, USER);

    expect(state.eligibleForTrial).toBe(true);
  });

  it("degrada a Free cuando no existe la fila de cuenta", async () => {
    // La función devuelve plan 'free' por defecto vía LEFT JOIN
    const sinCuenta = createCountingClient(
      overview({ plan: "free", stripe_customer_id: null, trial_ends_at: new Date(0).toISOString() })
    );
    const state = await loadAccount(sinCuenta.asClient, USER);

    expect(state.effective.planId).toBe("free");
    expect(state.effective.limits.campaigns).toBe(1);
  });

  it("cuenta 0 leads cuando el usuario no tiene campañas", async () => {
    const sinCampanas = createCountingClient(overview({ campaigns_count: 0, leads_this_month: 0 }));
    const state = await loadAccount(sinCampanas.asClient, USER);

    expect(state.usage.campaigns).toBe(0);
    expect(state.usage.leadsThisMonth).toBe(0);
  });

  it("sigue aplicando el trial cuando el plan es 'trial' y no ha caducado", async () => {
    const enTrial = createCountingClient(
      overview({ plan: "trial", trial_ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
    );
    const state = await loadAccount(enTrial.asClient, USER);

    expect(state.effective.planId).toBe("pro");
    expect(state.effective.isTrial).toBe(true);
    expect(state.effective.trialDaysLeft).toBe(7);
  });

  it("no envía UUIDs de campaña por la query string", async () => {
    // El cálculo anterior hacía .in("campaign_id", [...]) con hasta cientos de
    // UUID en la URL, con riesgo de exceder el límite de longitud.
    const conMuchasCampanas = createCountingClient(overview({ campaigns_count: 250 }));
    await loadAccount(conMuchasCampanas.asClient, USER);

    const filtrosConUuids = conMuchasCampanas.queries.flatMap((q) =>
      q.filters.filter((f) => f.startsWith("in("))
    );
    expect(filtrosConUuids).toEqual([]);
  });
});
