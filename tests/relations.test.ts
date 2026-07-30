import { describe, it, expect } from "vitest";
import { toOne, requireOne } from "@/lib/supabase/relations";
import { listLeadsQuerySchema, leadStatusSchema, LEAD_STATUSES } from "@/lib/validation/schemas";

// ============================================================================
// Relaciones embebidas de PostgREST.
// Sustituyen a los `as unknown as { … }` que apagaban la comprobación de tipos
// y ocultaron, entre otras cosas, que `contact_email` es nullable.
// ============================================================================

describe("toOne", () => {
  it("devuelve el objeto tal cual (forma real de PostgREST)", () => {
    expect(toOne({ sender_name: "Jorge" })).toEqual({ sender_name: "Jorge" });
  });

  it("extrae el primer elemento cuando llega como array", () => {
    // El inferidor de supabase-js a veces declara la relación como array
    expect(toOne([{ sender_name: "Jorge" }])).toEqual({ sender_name: "Jorge" });
  });

  it("devuelve null ante array vacío, null o undefined", () => {
    expect(toOne([])).toBeNull();
    expect(toOne(null)).toBeNull();
    expect(toOne(undefined)).toBeNull();
  });

  it("no confunde un valor falsy legítimo con ausencia", () => {
    expect(toOne(0)).toBe(0);
    expect(toOne("")).toBe("");
    expect(toOne(false)).toBe(false);
  });
});

describe("requireOne", () => {
  it("devuelve el valor cuando existe", () => {
    expect(requireOne({ id: "x" }, "campaña")).toEqual({ id: "x" });
  });

  it("lanza con un mensaje que identifica la relación ausente", () => {
    expect(() => requireOne(null, "campaigns del lead")).toThrow(/campaigns del lead/);
    expect(() => requireOne([], "leads del email")).toThrow(/leads del email/);
  });
});

// ============================================================================
// Validación del filtro de estado.
// Antes `?status=` aceptaba cualquier cadena y la pasaba a la consulta: un
// valor inexistente devolvía lista vacía sin explicar por qué.
// ============================================================================

describe("filtro de estado de leads", () => {
  it("acepta todos los estados reales del pipeline", () => {
    for (const status of LEAD_STATUSES) {
      expect(leadStatusSchema.safeParse(status).success, status).toBe(true);
    }
  });

  it("cubre los 10 estados de la máquina de estados", () => {
    expect(LEAD_STATUSES).toHaveLength(10);
  });

  it("rechaza un estado inexistente con mensaje accionable", () => {
    const result = listLeadsQuerySchema.safeParse({ status: "inventado" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("ready_to_send");
    }
  });

  it("rechaza intentos de inyección en el filtro", () => {
    expect(listLeadsQuerySchema.safeParse({ status: "sent' or '1'='1" }).success).toBe(false);
  });

  it("el filtro sigue siendo opcional", () => {
    const result = listLeadsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(500);
  });

  it("acota el límite al rango permitido", () => {
    expect(listLeadsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listLeadsQuerySchema.safeParse({ limit: 501 }).success).toBe(false);
    expect(listLeadsQuerySchema.safeParse({ limit: 250 }).success).toBe(true);
  });
});
