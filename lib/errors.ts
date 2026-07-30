// lib/errors.ts
// ============================================================================
// Jerarquía de errores de la aplicación y su traducción a respuestas HTTP.
//
// Principio: el mensaje que ve el usuario y el que se registra en logs son
// distintos. `message` es apto para mostrar en la UI (español, accionable,
// sin filtrar internals); `cause` y el contexto van al log para depurar.
//
// Nunca se devuelve un stack trace ni un mensaje de Postgres crudo al cliente:
// filtran nombres de tablas y estructura interna a un atacante.
// ============================================================================

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "plan_limit"
  | "rate_limited"
  | "config_error"
  | "upstream_error"
  | "internal";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  plan_limit: 402,
  rate_limited: 429,
  config_error: 503,
  upstream_error: 502,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** true si el mensaje puede mostrarse tal cual al usuario final. */
  readonly safeMessage: boolean;

  constructor(code: ErrorCode, message: string, options: { details?: unknown; cause?: unknown; safeMessage?: boolean } = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.safeMessage = options.safeMessage ?? true;
  }
}

// ── Constructores con los mensajes de usuario ya redactados ─────────────────
export const errors = {
  unauthenticated: (message = "Necesitas iniciar sesión para continuar.") => new AppError("unauthenticated", message),

  forbidden: (message = "No tienes permiso para acceder a este recurso.") => new AppError("forbidden", message),

  notFound: (resource = "El recurso") => new AppError("not_found", `${resource} no existe o no está disponible.`),

  validation: (message: string, details?: unknown) => new AppError("validation_failed", message, { details }),

  conflict: (message: string) => new AppError("conflict", message),

  planLimit: (message: string) => new AppError("plan_limit", message),

  rateLimited: (message = "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.") =>
    new AppError("rate_limited", message),

  config: (message: string) => new AppError("config_error", message),

  upstream: (service: string, cause?: unknown) =>
    new AppError("upstream_error", `El servicio ${service} no está respondiendo. Inténtalo de nuevo en unos minutos.`, { cause }),

  internal: (cause?: unknown) =>
    new AppError("internal", "Ha ocurrido un error inesperado. El equipo ha sido notificado.", { cause, safeMessage: true }),
};

/** Normaliza cualquier excepción a un AppError con mensaje apto para el usuario. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    // ConfigError de lib/env.ts: su mensaje SÍ es accionable para el operador
    if (error.name === "ConfigError") {
      return new AppError("config_error", error.message, { cause: error });
    }
    return errors.internal(error);
  }

  return errors.internal(error);
}

/** Cuerpo JSON de error, consistente en toda la API. */
export interface ErrorBody {
  error: string;
  code: ErrorCode;
  requestId?: string;
  details?: unknown;
  /** Sólo fuera de producción: causa cruda para depurar. */
  debug?: { message: string; code?: string; hint?: string; details?: string };
}

/**
 * Extrae la causa en forma serializable.
 * Se emite ÚNICAMENTE fuera de producción: un error de PostgREST nombra
 * tablas y columnas, y eso es un mapa gratis del esquema para un atacante.
 * En producción el requestId es el puente hacia el log completo del servidor.
 */
function describeCause(cause: unknown): ErrorBody["debug"] {
  if (!cause) return undefined;

  if (typeof cause === "object") {
    const c = cause as { message?: string; code?: string; hint?: string; details?: string };
    if (c.message) {
      return {
        message: c.message,
        ...(c.code && { code: c.code }),
        ...(c.hint && { hint: c.hint }),
        ...(c.details && { details: c.details }),
      };
    }
  }

  if (cause instanceof Error) return { message: cause.message };
  return undefined;
}

export function toErrorBody(error: AppError, requestId?: string): ErrorBody {
  const body: ErrorBody = {
    error: error.message,
    code: error.code,
    ...(requestId && { requestId }),
    ...(error.details !== undefined && { details: error.details }),
  };

  if (process.env.NODE_ENV !== "production") {
    const debug = describeCause(error.cause);
    if (debug) body.debug = debug;
  }

  return body;
}
