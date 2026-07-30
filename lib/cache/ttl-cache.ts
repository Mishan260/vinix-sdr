// lib/cache/ttl-cache.ts
// ============================================================================
// Caché en memoria con expiración y deduplicación de peticiones en vuelo.
//
// QUÉ CACHEA Y QUÉ NO: sólo datos que no pertenecen a un usuario concreto —
// resultados de scraping público, catálogos, configuración. Nunca sesiones,
// cuentas ni nada sujeto a RLS: en serverless una instancia atiende a varios
// usuarios y cachear datos privados los mezclaría entre cuentas.
//
// DEDUPLICACIÓN: si dos peticiones piden la misma clave a la vez, sólo se
// ejecuta el trabajo una vez y ambas esperan el mismo resultado. Es lo que
// evita que un lote de 50 leads de la misma empresa dispare 50 scrapings.
//
// LÍMITE: en Vercel cada instancia tiene su propia memoria, así que el acierto
// de caché depende de que la petición caiga en la misma instancia. Aun así el
// beneficio es real dentro de un mismo lote, que es donde se concentra la
// repetición. Para caché compartida entre instancias, `TtlCache` puede
// respaldarse con Redis sin cambiar la interfaz de `getOrSet`.
// ============================================================================

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCacheOptions {
  /** Tiempo de vida en milisegundos. */
  ttlMs: number;
  /** Máximo de entradas antes de expulsar las más antiguas. */
  maxEntries?: number;
  /** Nombre para las métricas y los logs. */
  name?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  /** Peticiones que se unieron a una ya en vuelo en lugar de duplicar trabajo. */
  coalesced: number;
  evictions: number;
  size: number;
  hitRate: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  readonly name: string;

  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private evictions = 0;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 500;
    this.name = options.name ?? "cache";
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Reinserta para que el orden del Map refleje el uso reciente (LRU simple)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      // Map conserva el orden de inserción: la primera clave es la más antigua
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
        this.evictions++;
      }
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Devuelve el valor cacheado o ejecuta `producer` una sola vez.
   * Las llamadas concurrentes con la misma clave comparten la misma promesa.
   */
  async getOrSet(key: string, producer: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      this.hits++;
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.coalesced++;
      return pending;
    }

    this.misses++;
    const promise = producer()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.hits = 0;
    this.misses = 0;
    this.coalesced = 0;
    this.evictions = 0;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      coalesced: this.coalesced,
      evictions: this.evictions,
      size: this.entries.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

/** Lee un TTL de una variable de entorno, con valor por defecto en horas. */
export function ttlFromEnv(variable: string, defaultHours: number): number {
  const raw = process.env[variable]?.trim();
  const hours = raw ? Number(raw) : NaN;
  return (Number.isFinite(hours) && hours > 0 ? hours : defaultHours) * 3_600_000;
}
