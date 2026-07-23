// lib/logger.ts
// ============================================================================
// Logging estructurado (JSON en producción, legible en desarrollo).
//
// Por qué JSON en producción: Vercel, Datadog, Axiom y cualquier agregador
// parsean JSON automáticamente. Un console.log("[Webhook] falló:", err) es
// invisible para las alertas; un objeto con { level, event, requestId } es
// consultable y permite alertar sobre `level:"error" AND event:"stripe.*"`.
//
// Todo log lleva requestId cuando existe, para poder reconstruir una petición
// completa a través de capas (route → servicio → agente → proveedor externo).
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVEL_WEIGHT) return LEVEL_WEIGHT[configured];
  return process.env.NODE_ENV === "production" ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug;
}

export interface LogContext {
  requestId?: string;
  userId?: string;
  event?: string;
  durationMs?: number;
  [key: string]: unknown;
}

// Claves cuyo valor nunca debe aparecer en un log, aunque se pasen por error.
const REDACTED_KEYS = /^(password|token|secret|api_?key|authorization|cookie|service_role)/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[profundidad máxima]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 4).join("\n") };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.test(k) ? "[REDACTADO]" : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…[truncado]`;
  return value;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_WEIGHT[level] < minLevel()) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(sanitize(context) as LogContext),
  };

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify(entry));
    return;
  }

  // Desarrollo: una línea legible + contexto sólo si aporta algo.
  // level/message/timestamp ya van en el prefijo, no se repiten en el JSON.
  const rest: Record<string, unknown> = { ...entry };
  delete rest.level;
  delete rest.message;
  delete rest.timestamp;

  const tag = level.toUpperCase().padEnd(5);
  const suffix = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  sink(`${tag} ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),

  /** Logger con contexto fijo (requestId, userId) para no repetirlo en cada llamada. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit("debug", m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit("info", m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit("warn", m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit("error", m, { ...base, ...c }),
    };
  },
};

export type Logger = ReturnType<typeof logger.child>;

// ── Captura para Sentry (preparada, activa sólo si SENTRY_DSN existe) ───────
// No añadimos la dependencia @sentry/nextjs para no inflar el bundle de quien
// no la use. Cuando quieras activarlo: instala @sentry/nextjs, y sustituye el
// cuerpo de esta función por Sentry.captureException(error, { extra: context }).
export function captureException(error: unknown, context: LogContext = {}): void {
  logger.error(error instanceof Error ? error.message : "Error no identificado", {
    ...context,
    error,
    reportedToSentry: Boolean(process.env.SENTRY_DSN),
  });
}
