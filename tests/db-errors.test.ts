import { describe, it, expect, afterEach, vi } from "vitest";
import { fromDbError } from "@/lib/api/handler";
import { toErrorBody } from "@/lib/errors";

// ============================================================================
// Regresión del bug "PUT /api/templates → 503".
//
// PostgREST devuelve PGRST204 "Could not find the 'X' column … in the schema
// cache" TANTO si el cache está viejo COMO si la columna no existe. El código
// mapeaba ese mensaje a 503 config_error con el texto "recarga el cache", lo
// que llevó a ejecutar `NOTIFY pgrst, 'reload schema'` una y otra vez sin
// efecto: la columna nunca había existido.
// ============================================================================

// Error literal capturado contra la base de datos real
const PGRST204 = {
  code: "PGRST204",
  details: null,
  hint: null,
  message: "Could not find the 'followup_delay_days' column of 'campaigns' in the schema cache",
};

describe("fromDbError — desajustes de esquema", () => {
  it("NO devuelve 503 ante PGRST204", () => {
    // 503 implica "servicio no disponible, reinténtalo": aquí es un bug de
    // código que ningún reintento arregla.
    expect(fromDbError(PGRST204, "la campaña").status).not.toBe(503);
  });

  it("devuelve 500 y nombra la columna que falta", () => {
    const error = fromDbError(PGRST204, "la campaña");
    expect(error.status).toBe(500);
    expect(error.message).toContain("followup_delay_days");
  });

  it("apunta a las migraciones, no sólo a recargar el cache", () => {
    const message = fromDbError(PGRST204, "la campaña").message;
    expect(message).toMatch(/migraciones/i);
    // El consejo de recargar sigue presente, pero condicionado a que la
    // columna exista de verdad
    expect(message).toMatch(/si la columna sí existe/i);
  });

  it("trata igual PGRST205 (tabla ausente)", () => {
    const error = fromDbError(
      { code: "PGRST205", message: "Could not find the table 'public.accounts' in the schema cache" },
      "la cuenta"
    );
    expect(error.status).toBe(500);
    expect(error.message).toContain("accounts");
  });

  it("cubre también los errores nativos de Postgres", () => {
    // 42703 = undefined_column
    expect(fromDbError({ code: "42703", message: 'column "x" does not exist' }, "x").status).toBe(500);
    // 42P01 = undefined_table
    expect(fromDbError({ code: "42P01", message: 'relation "y" does not exist' }, "y").status).toBe(500);
  });
});

describe("fromDbError — resto de códigos", () => {
  it("PGRST116 (sin filas) → 404", () => {
    expect(fromDbError({ code: "PGRST116", message: "no rows" }, "la campaña").status).toBe(404);
  });

  it("23505 (unique) → 409", () => {
    expect(fromDbError({ code: "23505", message: "duplicate key" }, "la campaña").status).toBe(409);
  });

  it("42501 (RLS) → 403", () => {
    // Con RLS, escribir un recurso ajeno da permiso denegado, no error interno
    expect(fromDbError({ code: "42501", message: "permission denied" }, "la campaña").status).toBe(403);
  });

  it("un error desconocido no filtra el mensaje crudo al usuario", () => {
    const error = fromDbError({ code: "XX000", message: 'relation "auth.users" internals' }, "la campaña");
    expect(error.status).toBe(500);
    expect(error.message).not.toContain("auth.users");
  });
});

describe("toErrorBody — depuración sin filtrar en producción", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("incluye la causa cruda fuera de producción", () => {
    vi.stubEnv("NODE_ENV", "development");
    const body = toErrorBody(fromDbError(PGRST204, "la campaña"), "req-1");
    expect(body.debug?.code).toBe("PGRST204");
    expect(body.debug?.message).toContain("followup_delay_days");
  });

  it("omite la causa en producción y deja sólo el requestId", () => {
    vi.stubEnv("NODE_ENV", "production");
    const body = toErrorBody(fromDbError(PGRST204, "la campaña"), "req-1");
    // El detalle de PostgREST nombra tablas y columnas: es un mapa del esquema
    expect(body.debug).toBeUndefined();
    expect(body.requestId).toBe("req-1");
  });
});
