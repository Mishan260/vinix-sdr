import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { check, enforce, identify, resetRateLimits, RATE_LIMITS } from "@/lib/api/rate-limit";
import { AppError } from "@/lib/errors";

describe("rate limiting", () => {
  beforeEach(() => resetRateLimits());
  afterEach(() => vi.useRealTimers());

  it("permite peticiones por debajo del límite", () => {
    const rule = { limit: 3, windowMs: 1000 };
    expect(check("k", rule).allowed).toBe(true);
    expect(check("k", rule).allowed).toBe(true);
    expect(check("k", rule).allowed).toBe(true);
  });

  it("bloquea al superar el límite", () => {
    const rule = { limit: 2, windowMs: 1000 };
    check("k", rule);
    check("k", rule);
    const blocked = check("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("aísla los contadores por clave", () => {
    const rule = { limit: 1, windowMs: 1000 };
    expect(check("usuario-a", rule).allowed).toBe(true);
    // El límite de un usuario no debe afectar a otro
    expect(check("usuario-b", rule).allowed).toBe(true);
    expect(check("usuario-a", rule).allowed).toBe(false);
  });

  it("libera la cuota al salir de la ventana", () => {
    vi.useFakeTimers();
    const rule = { limit: 1, windowMs: 1000 };
    expect(check("k", rule).allowed).toBe(true);
    expect(check("k", rule).allowed).toBe(false);

    vi.advanceTimersByTime(1100);
    expect(check("k", rule).allowed).toBe(true);
  });

  it("enforce lanza AppError 429 con código rate_limited", () => {
    for (let i = 0; i < RATE_LIMITS.auth.limit; i++) enforce("k", "auth");

    try {
      enforce("k", "auth");
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(429);
      expect((error as AppError).code).toBe("rate_limited");
    }
  });

  it("los perfiles de auth son más estrictos que los de lectura", () => {
    // Auth es el objetivo natural de la fuerza bruta
    expect(RATE_LIMITS.auth.limit).toBeLessThan(RATE_LIMITS.read.limit);
  });
});

describe("identify", () => {
  const request = (headers: Record<string, string>) => new Request("https://x.test", { headers });

  it("prefiere el id de usuario cuando hay sesión", () => {
    expect(identify(request({ "x-forwarded-for": "1.2.3.4" }), "u1")).toBe("user:u1");
  });

  it("usa la primera IP de x-forwarded-for cuando no hay sesión", () => {
    // La cadena puede traer varios saltos: sólo la primera es el cliente real
    expect(identify(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("ip:1.2.3.4");
  });

  it("cae a 'unknown' si no hay cabeceras de IP", () => {
    expect(identify(request({}))).toBe("ip:unknown");
  });
});
