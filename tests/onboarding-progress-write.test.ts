import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCountingClient } from "./helpers/counting-client";

// ============================================================================
// Persistencia del progreso del onboarding.
//
// REGRESIÓN QUE FIJA: `updateProgress` hacía `update().eq("user_id", …)`.
// Un UPDATE sobre una fila que NO existe afecta a cero filas y PostgREST lo
// devuelve como éxito, sin error. Como el trigger `handle_new_user` no existía
// en el proyecto, ningún usuario tenía fila y TODA escritura se descartaba en
// silencio mientras la API respondía 200.
//
// Los dos síntomas que veía el usuario salían de esta única línea:
//
//   · «Continuar» en el perfil no guardaba la oferta → la investigación volvía
//     a pedirla → la misma pantalla en bucle, sin salir nunca.
//   · «Saltar» no marcaba `dismissed_at` → el panel devolvía al recorrido.
//
// La regla que se fija aquí: una escritura sólo cuenta como hecha si se
// confirma que tocó una fila.
// ============================================================================

const serviceFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createServiceClient: () => ({ from: serviceFrom }),
}));

const { updateProgress } = await import("@/lib/onboarding/service");

const USER = "55555555-5555-5555-5555-555555555555";

/** Doble del cliente de servicio: registra el upsert y decide si funciona. */
function serviceStub(
  options: { works: boolean; error?: { code: string; message: string } } = { works: true }
) {
  const calls: { table: string; values: unknown }[] = [];

  serviceFrom.mockImplementation((table: string) => ({
    upsert: (values: unknown) => {
      calls.push({ table, values });
      const result = options.works
        ? { data: { user_id: USER }, error: null }
        : {
            data: null,
            error: options.error ?? { code: "42501", message: "row-level security" },
          };
      const chain = {
        select: () => chain,
        single: () => Promise.resolve(result),
        then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
      };
      return chain;
    },
  }));

  return calls;
}

beforeEach(() => {
  serviceFrom.mockReset();
});

describe("updateProgress cuando la fila SÍ existe", () => {
  it("confirma la escritura y no escala privilegios", async () => {
    const calls = serviceStub();
    const client = createCountingClient({
      onboarding_progress: { rows: [{ user_id: USER }] },
    });

    const result = await updateProgress(client.asClient, USER, {
      valueProposition: "Auditamos infraestructura cloud",
    });

    expect(result.ok).toBe(true);
    // El camino normal usa el cliente del usuario: RLS sigue aplicándose
    expect(calls).toHaveLength(0);
  });

  it("escribe el valor que se le pasó, no otro", async () => {
    serviceStub();
    const client = createCountingClient({
      onboarding_progress: { rows: [{ user_id: USER }] },
    });

    await updateProgress(client.asClient, USER, {
      valueProposition: "Vendemos X",
      targetAudience: "agencias",
      mainProduct: "servicio Y",
    });

    const update = client.queries.find((q) => q.operation === "update");
    expect(update?.columns).toContain("Vendemos X");
    expect(update?.columns).toContain("agencias");
    expect(update?.columns).toContain("servicio Y");
  });

  it("marca dismissed_at con una fecha, no con un booleano", async () => {
    serviceStub();
    const client = createCountingClient({
      onboarding_progress: { rows: [{ user_id: USER }] },
    });

    await updateProgress(client.asClient, USER, { dismissedAt: true });

    const update = client.queries.find((q) => q.operation === "update");
    expect(update?.columns).toContain("dismissed_at");
    // Un `true` literal habría roto la columna timestamptz
    expect(update?.columns).not.toContain("true");
  });
});

describe("updateProgress cuando la fila NO existe", () => {
  it("NO da por buena una escritura de cero filas", async () => {
    const calls = serviceStub();
    // Sin filas: es exactamente el estado del proyecto sin el trigger de alta
    const client = createCountingClient({ onboarding_progress: { rows: [] } });

    const result = await updateProgress(client.asClient, USER, {
      valueProposition: "Auditamos infraestructura cloud",
    });

    // Antes esto devolvía éxito sin haber escrito nada: el bucle empezaba aquí
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("onboarding_progress");
  });

  it("crea la fila con el user_id de la sesión y el valor a guardar", async () => {
    const calls = serviceStub();
    const client = createCountingClient({ onboarding_progress: { rows: [] } });

    await updateProgress(client.asClient, USER, { dismissedAt: true });

    const values = calls[0].values as Record<string, unknown>;
    // El user_id sale de la sesión verificada, nunca del cuerpo de la petición
    expect(values.user_id).toBe(USER);
    expect(values.dismissed_at).toBeTypeOf("string");
  });

  it("informa del fallo si tampoco se puede crear la fila", async () => {
    serviceStub({ works: false });
    const client = createCountingClient({ onboarding_progress: { rows: [] } });

    const result = await updateProgress(client.asClient, USER, { dismissedAt: true });

    // Mentir aquí es lo que dejaba al usuario atrapado: la ruta necesita saber
    // que no se guardó para poder decírselo en lugar de avanzar a ciegas.
    expect(result.ok).toBe(false);
  });
});

// ── Clasificación del fallo ─────────────────────────────────────────────────
// Importa porque decide qué se le dice al usuario. Ante un fallo pasajero
// tiene sentido pedirle que reintente; si faltan tablas, reintentar no va a
// funcionar nunca y decírselo sería mandarle a dar vueltas.
describe("por qué falló la escritura", () => {
  const casos: { nombre: string; error: { code: string; message: string }; esperado: string }[] = [
    {
      nombre: "PostgREST no encuentra la tabla",
      error: { code: "PGRST205", message: "Could not find the table 'public.onboarding_progress'" },
      esperado: "schema_missing",
    },
    {
      nombre: "PostgREST no encuentra la columna",
      error: { code: "PGRST204", message: "Could not find the 'target_audience' column" },
      esperado: "schema_missing",
    },
    {
      nombre: "Postgres: la relación no existe",
      error: { code: "42P01", message: 'relation "onboarding_progress" does not exist' },
      esperado: "schema_missing",
    },
    {
      nombre: "Postgres: la columna no existe",
      error: { code: "42703", message: 'column "main_product" does not exist' },
      esperado: "schema_missing",
    },
    {
      nombre: "RLS rechaza la escritura",
      error: { code: "42501", message: "new row violates row-level security policy" },
      esperado: "denied",
    },
    {
      nombre: "cualquier otra cosa",
      error: { code: "08006", message: "connection failure" },
      esperado: "unknown",
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre} → ${caso.esperado}`, async () => {
      serviceStub({ works: false, error: caso.error });
      const client = createCountingClient({ onboarding_progress: { rows: [] } });

      const result = await updateProgress(client.asClient, USER, { dismissedAt: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(caso.esperado);
    });
  }
});

describe("updateProgress sin nada que escribir", () => {
  it("no hace ninguna consulta", async () => {
    serviceStub();
    const client = createCountingClient({ onboarding_progress: { rows: [] } });

    const result = await updateProgress(client.asClient, USER, {});

    expect(result.ok).toBe(true);
    expect(client.count).toBe(0);
  });

  it("ignora los flags en false en lugar de escribir la fecha", async () => {
    serviceStub();
    const client = createCountingClient({ onboarding_progress: { rows: [] } });

    await updateProgress(client.asClient, USER, {
      dismissedAt: false,
      completedAt: false,
      welcomedAt: false,
    });

    expect(client.count).toBe(0);
  });
});
