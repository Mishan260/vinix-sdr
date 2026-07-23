import { describe, it, expect } from "vitest";
import { AppError, errors, toAppError, toErrorBody } from "@/lib/errors";
import { ConfigError } from "@/lib/env";

describe("AppError", () => {
  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["not_found", 404],
    ["conflict", 409],
    ["plan_limit", 402],
    ["validation_failed", 422],
    ["rate_limited", 429],
    ["internal", 500],
    ["upstream_error", 502],
    ["config_error", 503],
  ] as const)("mapea %s al status %i", (code, status) => {
    expect(new AppError(code, "x").status).toBe(status);
  });
});

describe("toAppError", () => {
  it("deja pasar un AppError sin modificarlo", () => {
    const original = errors.notFound("El lead");
    expect(toAppError(original)).toBe(original);
  });

  it("convierte un Error genérico en 500 sin filtrar el mensaje interno", () => {
    const converted = toAppError(new Error("Postgres: relation users does not exist"));
    expect(converted.status).toBe(500);
    // El nombre de la tabla no debe llegar al cliente
    expect(converted.message).not.toContain("relation");
    expect(converted.message).toMatch(/error inesperado/i);
  });

  it("conserva el mensaje accionable de un ConfigError", () => {
    const converted = toAppError(new ConfigError(["FALTA_ALGO es obligatoria"]));
    expect(converted.status).toBe(503);
    expect(converted.message).toContain("FALTA_ALGO");
  });

  it("maneja valores lanzados que no son Error", () => {
    expect(toAppError("una cadena suelta").status).toBe(500);
    expect(toAppError(null).status).toBe(500);
  });
});

describe("toErrorBody", () => {
  it("incluye el requestId para poder correlacionar con los logs", () => {
    const body = toErrorBody(errors.notFound("El lead"), "req-123");
    expect(body).toMatchObject({ code: "not_found", requestId: "req-123" });
    expect(body.error).toContain("El lead");
  });

  it("omite requestId si no se proporciona", () => {
    expect(toErrorBody(errors.forbidden())).not.toHaveProperty("requestId");
  });

  it("propaga los detalles de validación", () => {
    const body = toErrorBody(errors.validation("Datos inválidos", [{ path: "email", message: "requerido" }]));
    expect(body.details).toEqual([{ path: "email", message: "requerido" }]);
  });

  it("nunca expone el stack trace", () => {
    const body = toErrorBody(toAppError(new Error("boom")), "req-1");
    expect(JSON.stringify(body)).not.toContain("at ");
  });
});
