// lib/queue/retry.ts
// ============================================================================
// Reintentos con backoff exponencial y jitter, más control de concurrencia.
//
// POR QUÉ HACE FALTA: los envíos se hacían uno a uno, en serie, sin reintentos.
// Un 429 puntual de Resend o un corte de red de un segundo perdía el envío y el
// lead quedaba en un estado incoherente. Con 500 leads en cola, además, el
// bucle en serie tardaba minutos y podía superar el maxDuration de la función.
//
// DISTINCIÓN CLAVE: no todos los fallos se reintentan. Un 422 "email inválido"
// va a fallar igual las tres veces; reintentarlo sólo gasta cuota y retrasa al
// resto de la cola. Sólo se reintenta lo transitorio (429, 5xx, red).
// ============================================================================

export type FailureKind = "transient" | "permanent";

export class RetryableError extends Error {
  readonly kind: FailureKind = "transient";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableError";
  }
}

export class PermanentError extends Error {
  readonly kind: FailureKind = "permanent";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentError";
  }
}

export interface RetryOptions {
  /** Intentos totales, incluido el primero. */
  attempts?: number;
  /** Espera base en ms; se duplica en cada intento. */
  baseDelayMs?: number;
  /** Tope de espera entre intentos. */
  maxDelayMs?: number;
  /** Inyectable en tests para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
  /** Notificación de cada reintento (para logs y métricas). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera del intento n con backoff exponencial y jitter completo.
 *
 * El jitter no es cosmético: sin él, N envíos que fallan a la vez por un 429
 * reintentan todos en el mismo instante y vuelven a saturar al proveedor.
 * Repartirlos al azar dentro de la ventana evita ese efecto rebaño.
 */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random = Math.random): number {
  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

/** Sólo los errores marcados como permanentes cortan los reintentos. */
function isPermanent(error: unknown): boolean {
  return error instanceof PermanentError;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Un fallo permanente no mejora reintentando: se propaga de inmediato
      if (isPermanent(error) || attempt === attempts) throw error;

      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// ── Ejecución con concurrencia limitada ─────────────────────────────────────
export interface MapPoolOptions {
  /** Tareas en vuelo simultáneas. */
  concurrency: number;
  /** Se consulta antes de cada tarea: permite cancelar la cola a mitad. */
  shouldStop?: () => boolean;
}

export interface PoolOutcome<T> {
  index: number;
  value?: T;
  error?: unknown;
}

/**
 * Procesa `items` con como mucho `concurrency` tareas a la vez.
 *
 * Frente a `Promise.all` sobre todo el array, esto acota la carga que se lanza
 * contra el proveedor externo (que aplica sus propios límites de velocidad) y
 * mantiene la memoria estable con listas grandes. Frente al bucle en serie
 * anterior, reduce el tiempo total en proporción a la concurrencia.
 *
 * Nunca lanza: devuelve el resultado o el error de cada elemento, para que un
 * fallo aislado no aborte el resto de la cola.
 */
export async function mapWithPool<TItem, TResult>(
  items: readonly TItem[],
  worker: (item: TItem, index: number) => Promise<TResult>,
  options: MapPoolOptions
): Promise<PoolOutcome<TResult>[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const results: PoolOutcome<TResult>[] = [];
  let cursor = 0;

  async function runner(): Promise<void> {
    for (;;) {
      if (options.shouldStop?.()) return;
      const index = cursor++;
      if (index >= items.length) return;

      try {
        results[index] = { index, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { index, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));

  // Los huecos aparecen si shouldStop cortó la cola; se descartan
  return results.filter(Boolean);
}
