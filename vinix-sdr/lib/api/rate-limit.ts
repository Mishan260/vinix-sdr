// lib/api/rate-limit.ts
// ============================================================================
// Rate limiting con ventana deslizante, en memoria del proceso.
//
// LIMITACIÓN CONOCIDA Y ACEPTADA: en Vercel cada instancia serverless tiene su
// propia memoria, así que el límite real es (límite × instancias activas). Es
// suficiente para frenar fuerza bruta y abuso accidental, no para un atacante
// distribuido. Para límites estrictos migra a Upstash Redis: la interfaz de
// `check()` está diseñada para poder sustituirse sin tocar las rutas.
// ============================================================================

import { errors } from "@/lib/errors";

interface Bucket {
  hits: number[]; // timestamps dentro de la ventana
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitRule {
  /** Peticiones permitidas dentro de la ventana. */
  limit: number;
  /** Tamaño de la ventana en milisegundos. */
  windowMs: number;
}

// Perfiles por tipo de endpoint. Los de auth son estrictos porque son el
// objetivo natural de fuerza bruta y de enumeración de cuentas.
export const RATE_LIMITS = {
  auth: { limit: 8, windowMs: 60_000 },
  passwordReset: { limit: 4, windowMs: 15 * 60_000 },
  webhook: { limit: 60, windowMs: 60_000 },
  ai: { limit: 30, windowMs: 60_000 },
  send: { limit: 60, windowMs: 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitProfile = keyof typeof RATE_LIMITS;

function prune(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 15 * 60_000) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function check(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  prune(now);

  const bucket = buckets.get(key) ?? { hits: [] };
  // Ventana deslizante: descartamos los impactos que ya salieron de la ventana
  bucket.hits = bucket.hits.filter((t) => now - t < rule.windowMs);

  if (bucket.hits.length >= rule.limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: rule.limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Lanza AppError 429 si se supera el límite. */
export function enforce(key: string, profile: RateLimitProfile): void {
  const result = check(key, RATE_LIMITS[profile]);
  if (!result.allowed) {
    throw errors.rateLimited(
      `Demasiadas peticiones. Vuelve a intentarlo en ${result.retryAfterSeconds} segundos.`
    );
  }
}

/** Identidad para la clave del bucket: usuario si hay sesión, si no la IP. */
export function identify(req: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/** Sólo para tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
