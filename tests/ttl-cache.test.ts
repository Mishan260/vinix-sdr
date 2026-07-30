import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TtlCache, ttlFromEnv } from "@/lib/cache/ttl-cache";

describe("TtlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("devuelve el valor cacheado sin volver a ejecutar el productor", async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    const producer = vi.fn(async () => 42);

    expect(await cache.getOrSet("k", producer)).toBe(42);
    expect(await cache.getOrSet("k", producer)).toBe(42);

    expect(producer).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it("vuelve a producir cuando expira el TTL", async () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number>({ ttlMs: 1000 });
    const producer = vi.fn(async () => 1);

    await cache.getOrSet("k", producer);
    vi.advanceTimersByTime(1500);
    await cache.getOrSet("k", producer);

    expect(producer).toHaveBeenCalledTimes(2);
  });

  it("deduplica peticiones concurrentes de la misma clave", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000 });
    let ejecuciones = 0;
    const lento = async () => {
      ejecuciones++;
      await new Promise((r) => setTimeout(r, 20));
      return "resultado";
    };

    // 50 leads de la misma empresa en un lote: debe scrapearse UNA vez
    const resultados = await Promise.all(Array.from({ length: 50 }, () => cache.getOrSet("acme.com", lento)));

    expect(ejecuciones).toBe(1);
    expect(resultados.every((r) => r === "resultado")).toBe(true);
    expect(cache.stats().coalesced).toBe(49);
  });

  it("no cachea el fallo: un error deja la clave libre para reintentar", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000 });
    const fallo = vi.fn(async () => {
      throw new Error("scraping caído");
    });

    await expect(cache.getOrSet("k", fallo)).rejects.toThrow("scraping caído");

    const exito = vi.fn(async () => "ok");
    expect(await cache.getOrSet("k", exito)).toBe("ok");
    expect(exito).toHaveBeenCalledTimes(1);
  });

  it("expulsa las entradas más antiguas al llegar al límite", async () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 3 });

    for (let i = 0; i < 5; i++) await cache.getOrSet(`k${i}`, async () => i);

    expect(cache.stats().size).toBe(3);
    expect(cache.stats().evictions).toBe(2);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k4")).toBe(4);
  });

  it("el acceso renueva la posición (LRU)", async () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });

    await cache.getOrSet("a", async () => 1);
    await cache.getOrSet("b", async () => 2);
    cache.get("a"); // 'a' pasa a ser la más reciente
    await cache.getOrSet("c", async () => 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("calcula la tasa de acierto", async () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000 });
    await cache.getOrSet("k", async () => 1);
    await cache.getOrSet("k", async () => 1);
    await cache.getOrSet("k", async () => 1);

    expect(cache.stats().hitRate).toBeCloseTo(2 / 3);
  });
});

describe("ttlFromEnv", () => {
  const VAR = "TEST_TTL_HOURS";
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("usa el valor por defecto si la variable no está", () => {
    expect(ttlFromEnv(VAR, 24)).toBe(24 * 3_600_000);
  });

  it("lee horas de la variable de entorno", () => {
    vi.stubEnv(VAR, "6");
    expect(ttlFromEnv(VAR, 24)).toBe(6 * 3_600_000);
  });

  it("ignora valores inválidos o negativos", () => {
    vi.stubEnv(VAR, "no-es-un-numero");
    expect(ttlFromEnv(VAR, 12)).toBe(12 * 3_600_000);

    vi.stubEnv(VAR, "-5");
    expect(ttlFromEnv(VAR, 12)).toBe(12 * 3_600_000);
  });
});

// ============================================================================
// Ahorro medible en el escenario real: un lote de investigación.
// ============================================================================
describe("ahorro en un lote de investigación", () => {
  it("50 leads del mismo dominio producen 1 scraping en lugar de 50", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000 });
    let llamadasAFirecrawl = 0;

    const scrape = async () => {
      llamadasAFirecrawl++;
      return "<html>contenido</html>";
    };

    for (let i = 0; i < 50; i++) await cache.getOrSet("https://acme.example", scrape);

    expect(llamadasAFirecrawl).toBe(1);
    // 49 llamadas evitadas al proveedor de pago
    expect(cache.stats().hits).toBe(49);
  });

  it("dominios distintos no comparten caché", async () => {
    const cache = new TtlCache<string>({ ttlMs: 60_000 });
    let llamadas = 0;
    const scrape = async () => {
      llamadas++;
      return "contenido";
    };

    await cache.getOrSet("https://acme.example", scrape);
    await cache.getOrSet("https://beta.example", scrape);

    expect(llamadas).toBe(2);
  });
});
