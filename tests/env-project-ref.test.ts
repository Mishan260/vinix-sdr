import { describe, it, expect } from "vitest";
import { findProjectRefMismatches, projectRefFromKey, projectRefFromUrl } from "@/lib/env";

// ============================================================================
// Coherencia entre SUPABASE_URL y las claves.
//
// Caso real que motivó esto: se cambió SUPABASE_URL a un proyecto nuevo pero
// las claves seguían siendo del anterior. La app arrancaba sin error y
// PostgREST devolvía 401 "Invalid API key" a TODA consulta — el panel se veía
// vacío sin que nada dijera por qué.
// ============================================================================

/** Construye un JWT sintético con el `ref` indicado (sólo se lee el payload). */
function fakeKey(ref: string, role = "anon"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase", ref, role })).toString("base64url");
  return `${header}.${payload}.firmafalsa`;
}

describe("projectRefFromUrl", () => {
  it("extrae el ref de una URL de Supabase", () => {
    expect(projectRefFromUrl("https://abcdefghijklmnop.supabase.co")).toBe("abcdefghijklmnop");
  });

  it("ignora dominios que no son de Supabase", () => {
    // Un dominio propio con proxy no permite deducir el ref: mejor no adivinar
    expect(projectRefFromUrl("https://db.midominio.com")).toBeNull();
  });

  it("devuelve null ante entradas inválidas", () => {
    expect(projectRefFromUrl(undefined)).toBeNull();
    expect(projectRefFromUrl("no-es-una-url")).toBeNull();
  });
});

describe("projectRefFromKey", () => {
  it("extrae el ref del payload del JWT", () => {
    expect(projectRefFromKey(fakeKey("proyectoabc"))).toBe("proyectoabc");
  });

  it("devuelve null si no es un JWT de tres partes", () => {
    expect(projectRefFromKey("clave-plana")).toBeNull();
    expect(projectRefFromKey(undefined)).toBeNull();
  });

  it("devuelve null si el payload no es JSON válido", () => {
    expect(projectRefFromKey("aaa.bbbb.cccc")).toBeNull();
  });
});

describe("findProjectRefMismatches", () => {
  it("no reporta nada cuando URL y claves coinciden", () => {
    const result = findProjectRefMismatches({
      SUPABASE_URL: "https://proyectouno.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: fakeKey("proyectouno", "service_role"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeKey("proyectouno"),
    });
    expect(result).toEqual([]);
  });

  it("detecta el caso real: URL nueva con claves del proyecto viejo", () => {
    const result = findProjectRefMismatches({
      SUPABASE_URL: "https://riygxhnrmarvkvrieijd.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: fakeKey("ikcjfmzbzbjmmdnuhjdg", "service_role"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeKey("ikcjfmzbzbjmmdnuhjdg"),
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      key: "SUPABASE_SERVICE_ROLE_KEY",
      urlRef: "riygxhnrmarvkvrieijd",
      keyRef: "ikcjfmzbzbjmmdnuhjdg",
    });
  });

  it("señala exactamente qué clave está descuadrada", () => {
    const result = findProjectRefMismatches({
      SUPABASE_URL: "https://proyectouno.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: fakeKey("proyectouno", "service_role"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeKey("proyectodos"),
    });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("no reporta falsos positivos con claves que no son JWT", () => {
    // En tests y entornos locales las claves suelen ser sintéticas
    expect(
      findProjectRefMismatches({
        SUPABASE_URL: "https://proyectouno.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      })
    ).toEqual([]);
  });

  it("no reporta nada si la URL no permite deducir el proyecto", () => {
    expect(
      findProjectRefMismatches({
        SUPABASE_URL: "https://db.midominio.com",
        SUPABASE_SERVICE_ROLE_KEY: fakeKey("cualquiera", "service_role"),
      })
    ).toEqual([]);
  });

  it("tolera claves entre comillas pegadas desde el dashboard", () => {
    const result = findProjectRefMismatches({
      SUPABASE_URL: '"https://proyectouno.supabase.co"',
      SUPABASE_SERVICE_ROLE_KEY: `"${fakeKey("proyectodos", "service_role")}"`,
    });
    expect(result).toHaveLength(1);
  });
});
