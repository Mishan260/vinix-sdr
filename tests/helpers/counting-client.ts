// tests/helpers/counting-client.ts
// ============================================================================
// Cliente Supabase falso que cuenta round-trips.
//
// POR QUÉ ASÍ: contar `.from()` en el código fuente no sirve — una cadena
// `.from().select().eq()` es UNA petición HTTP, no tres, y las llamadas
// anidadas dentro de helpers se escapan al ojo. Este doble reproduce la API
// de encadenamiento de PostgREST y registra exactamente una entrada por cada
// `await` sobre un builder, que es lo que se traduce en un viaje a la red.
//
// Los builders de supabase-js son "thenable": la petición sale cuando se
// espera el resultado. Replicarlo aquí hace que el conteo sea exacto.
// ============================================================================

export interface RecordedQuery {
  table: string;
  operation: string;
  columns?: string;
  filters: string[];
  head: boolean;
}

export interface CountingClient {
  /** Consultas registradas, en orden de ejecución. */
  queries: RecordedQuery[];
  /** Número de round-trips (= peticiones HTTP a PostgREST). */
  readonly count: number;
  reset(): void;
  /** El doble tipado como cliente real, para inyectarlo donde se espera uno. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asClient: any;
}

interface TableFixture {
  /** Filas que devuelve un select sobre esta tabla. */
  rows?: unknown[];
  /** Valor de `count` en consultas con { count: "exact" }. */
  count?: number;
}

/**
 * Crea el doble.
 * `fixtures` define qué devuelve cada tabla; lo no definido devuelve lista
 * vacía y count 0.
 */
export function createCountingClient(fixtures: Record<string, TableFixture> = {}): CountingClient {
  const queries: RecordedQuery[] = [];

  function builder(table: string, operation: string, columns?: string, head = false) {
    const record: RecordedQuery = { table, operation, columns, filters: [], head };

    const resolve = () => {
      // El registro se añade al ejecutarse, no al construirse: una cadena que
      // nunca se espera no cuenta como petición.
      queries.push(record);

      const fixture = fixtures[table] ?? {};
      const rows = fixture.rows ?? [];
      return {
        data: head ? null : rows,
        error: null,
        count: fixture.count ?? rows.length,
        status: 200,
      };
    };

    const chain: Record<string, unknown> = {};

    // Filtros y modificadores: devuelven el mismo builder
    for (const method of [
      "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
      "not", "or", "filter", "order", "limit", "range", "returns", "overrideTypes",
    ]) {
      chain[method] = (...args: unknown[]) => {
        record.filters.push(`${method}(${args.map(String).join(",")})`.slice(0, 80));
        return chain;
      };
    }

    // `.select()` tras un insert/update/delete pide que la operación devuelva
    // las filas afectadas. No es una consulta nueva: sigue siendo el mismo
    // round-trip, así que no se registra por separado.
    chain.select = (columns?: string) => {
      if (columns && !record.columns) record.columns = columns;
      return chain;
    };

    // Terminadores: producen exactamente una fila o ninguna
    chain.single = () => {
      const result = resolve();
      const rows = (result.data ?? []) as unknown[];
      return Promise.resolve({ ...result, data: rows[0] ?? null });
    };
    chain.maybeSingle = () => {
      const result = resolve();
      const rows = (result.data ?? []) as unknown[];
      return Promise.resolve({ ...result, data: rows[0] ?? null });
    };

    // Thenable: `await builder` dispara la petición
    chain.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return chain;
  }

  const asClient = {
    from(table: string) {
      return {
        select: (columns?: string, options?: { count?: string; head?: boolean }) =>
          builder(table, "select", columns, options?.head ?? false),
        // El payload se conserva casi entero: los tests comprueban que ciertos
        // campos se escriben (is_demo, status…) y truncar corto los ocultaba.
        insert: (values: unknown) => builder(table, "insert", JSON.stringify(values).slice(0, 600)),
        update: (values: unknown) => builder(table, "update", JSON.stringify(values).slice(0, 600)),
        upsert: (values: unknown) => builder(table, "upsert", JSON.stringify(values).slice(0, 600)),
        delete: () => builder(table, "delete"),
      };
    },
    rpc(fn: string, args?: unknown) {
      return builder(`rpc:${fn}`, "rpc", JSON.stringify(args ?? {}).slice(0, 60));
    },
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  };

  return {
    queries,
    get count() {
      return queries.length;
    },
    reset() {
      queries.length = 0;
    },
    asClient,
  };
}

/** Resumen legible para los mensajes de fallo de los tests. */
export function describeQueries(queries: RecordedQuery[]): string {
  return queries
    .map((q, i) => `  ${i + 1}. ${q.operation} ${q.table}${q.columns ? ` (${q.columns.slice(0, 40)})` : ""}`)
    .join("\n");
}
