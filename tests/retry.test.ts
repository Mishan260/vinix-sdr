import { describe, it, expect, vi } from "vitest";
import { withRetry, mapWithPool, backoffDelay, PermanentError, RetryableError } from "@/lib/queue/retry";

/** Sleep instantáneo: los tests miden la lógica, no el tiempo real. */
const noSleep = async () => {};

describe("withRetry", () => {
  it("devuelve el resultado sin reintentar si va bien a la primera", async () => {
    const op = vi.fn(async () => "ok");
    expect(await withRetry(op, { sleep: noSleep })).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("reintenta un fallo transitorio hasta lograrlo", async () => {
    let intentos = 0;
    const op = vi.fn(async () => {
      intentos++;
      if (intentos < 3) throw new RetryableError("429 rate limit");
      return "ok";
    });

    expect(await withRetry(op, { attempts: 3, sleep: noSleep })).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("NO reintenta un fallo permanente", async () => {
    const op = vi.fn(async () => {
      throw new PermanentError("email inválido");
    });

    await expect(withRetry(op, { attempts: 3, sleep: noSleep })).rejects.toThrow("email inválido");
    // Reintentar un 422 sólo gasta cuota y retrasa la cola
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("se rinde tras agotar los intentos y propaga el último error", async () => {
    const op = vi.fn(async () => {
      throw new RetryableError("proveedor caído");
    });

    await expect(withRetry(op, { attempts: 3, sleep: noSleep })).rejects.toThrow("proveedor caído");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("informa de cada reintento con su espera", async () => {
    const onRetry = vi.fn();
    let intentos = 0;
    await withRetry(
      async () => {
        intentos++;
        if (intentos < 3) throw new RetryableError("temporal");
        return "ok";
      },
      { attempts: 3, sleep: noSleep, onRetry }
    );

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1 });
    expect(onRetry.mock.calls[0][0].delayMs).toBeGreaterThan(0);
  });
});

describe("backoffDelay", () => {
  it("crece de forma exponencial", () => {
    const sinJitter = () => 1; // random()=1 → factor 1.0
    expect(backoffDelay(1, 500, 60_000, sinJitter)).toBe(500);
    expect(backoffDelay(2, 500, 60_000, sinJitter)).toBe(1000);
    expect(backoffDelay(3, 500, 60_000, sinJitter)).toBe(2000);
  });

  it("respeta el tope máximo", () => {
    expect(backoffDelay(20, 500, 10_000, () => 1)).toBe(10_000);
  });

  it("aplica jitter para evitar el efecto rebaño", () => {
    // Sin jitter, N envíos que fallan por un 429 reintentarían todos a la vez
    // y volverían a saturar al proveedor.
    const minimo = backoffDelay(3, 500, 60_000, () => 0);
    const maximo = backoffDelay(3, 500, 60_000, () => 1);

    expect(minimo).toBe(1000); // 50% de 2000
    expect(maximo).toBe(2000);
    expect(minimo).toBeLessThan(maximo);
  });
});

describe("mapWithPool", () => {
  it("procesa todos los elementos", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithPool(items, async (n) => n * 2, { concurrency: 2 });

    expect(results).toHaveLength(5);
    expect(results.map((r) => r.value)).toEqual([2, 4, 6, 8, 10]);
  });

  it("nunca supera la concurrencia indicada", async () => {
    let enVuelo = 0;
    let maximoObservado = 0;

    await mapWithPool(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        enVuelo++;
        maximoObservado = Math.max(maximoObservado, enVuelo);
        await new Promise((r) => setTimeout(r, 5));
        enVuelo--;
      },
      { concurrency: 3 }
    );

    expect(maximoObservado).toBeLessThanOrEqual(3);
  });

  it("un fallo aislado no aborta el resto de la cola", async () => {
    const results = await mapWithPool(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("falló el 2");
        return n;
      },
      { concurrency: 2 }
    );

    expect(results).toHaveLength(3);
    expect(results[1].error).toBeInstanceOf(Error);
    expect(results[0].value).toBe(1);
    expect(results[2].value).toBe(3);
  });

  it("shouldStop corta la cola a mitad", async () => {
    let procesados = 0;
    await mapWithPool(
      Array.from({ length: 100 }, (_, i) => i),
      async () => {
        procesados++;
      },
      { concurrency: 1, shouldStop: () => procesados >= 10 }
    );

    expect(procesados).toBeLessThanOrEqual(11);
  });

  it("es más rápido que el bucle en serie", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const tarea = async () => new Promise((r) => setTimeout(r, 20));

    const inicioSerie = Date.now();
    for (let i = 0; i < items.length; i++) await tarea();
    const serieMs = Date.now() - inicioSerie;

    const inicioPool = Date.now();
    await mapWithPool(items, tarea, { concurrency: 4 });
    const poolMs = Date.now() - inicioPool;

    // Con concurrencia 4 debería rondar 1/4 del tiempo; se exige la mitad
    // para no depender de la precisión del planificador.
    expect(poolMs).toBeLessThan(serieMs / 2);
  });

  it("tolera una lista vacía", async () => {
    expect(await mapWithPool([], async () => 1, { concurrency: 4 })).toEqual([]);
  });
});
