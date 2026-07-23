// lib/api/handler.ts
// ============================================================================
// Wrapper para Route Handlers. Cada ruta que lo usa obtiene, sin repetir código:
//
//   1. requestId propagado en logs y en la cabecera X-Request-Id
//   2. Autenticación (opcional/obligatoria) con el usuario ya resuelto
//   3. Rate limiting por usuario o IP
//   4. Validación Zod de body y query, con tipos inferidos
//   5. Traducción de excepciones a JSON de error consistente
//   6. Log estructurado de entrada/salida con duración
//
// El objetivo es que el cuerpo de cada ruta sea sólo lógica de negocio.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { logger, type Logger, captureException } from "@/lib/logger";
import { AppError, toAppError, toErrorBody, errors } from "@/lib/errors";
import { createUserClient, getUser } from "@/lib/supabase/server";
import { enforce, identify, type RateLimitProfile } from "./rate-limit";
import { firstIssueMessage } from "@/lib/validation/schemas";

/**
 * Segundo argumento de un Route Handler de Next 15.
 *
 * `params` sólo existe en rutas con segmentos dinámicos, pero el tipo que Next
 * genera en .next/types exige que el parámetro en sí NO sea opcional (ni con
 * valor por defecto): por eso se declara obligatorio y se accede con `?.`,
 * porque en rutas estáticas Next lo invoca sin él.
 */
export interface RouteParams {
  params: Promise<Record<string, string>>;
}

/** Contexto vacío para invocar un handler a mano (rutas sin segmentos dinámicos). */
export const NO_PARAMS: RouteParams = { params: Promise.resolve({}) };

export interface HandlerContext<TBody, TQuery> {
  req: NextRequest;
  requestId: string;
  log: Logger;
  body: TBody;
  query: TQuery;
  /** Parámetros dinámicos de la ruta ([id] → { id }). */
  params: Record<string, string>;
}

export interface AuthedContext<TBody, TQuery> extends HandlerContext<TBody, TQuery> {
  user: User;
  /** Cliente Supabase con la sesión del usuario: todas las consultas pasan por RLS. */
  db: SupabaseClient;
}

interface BaseOptions<TBodySchema extends z.ZodTypeAny, TQuerySchema extends z.ZodTypeAny> {
  body?: TBodySchema;
  query?: TQuerySchema;
  rateLimit?: RateLimitProfile;
  /** Etiqueta del evento en los logs (ej. "leads.create"). */
  event?: string;
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;

// ── Utilidades internas ─────────────────────────────────────────────────────
async function parseBody(req: NextRequest): Promise<unknown> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "DELETE") return undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;

  const text = await req.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw errors.validation("El cuerpo de la petición no es JSON válido");
  }
}

function validate<T extends z.ZodTypeAny>(schema: T | undefined, value: unknown): z.infer<T> {
  if (!schema) return undefined as z.infer<T>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw errors.validation(
      firstIssueMessage(result.error),
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  return result.data;
}

function queryToObject(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    // Ignoramos cadenas vacías: `?campaignId=` debe comportarse como ausente
    if (value !== "") out[key] = value;
  });
  return out;
}

function respondWithError(error: unknown, requestId: string, log: Logger, startedAt: number): NextResponse {
  const appError = toAppError(error);

  const context = { status: appError.status, code: appError.code, durationMs: Date.now() - startedAt };

  if (appError.status >= 500) {
    captureException(error, { requestId, ...context });
  } else {
    log.warn(appError.message, context);
  }

  const response = NextResponse.json(toErrorBody(appError, requestId), { status: appError.status });
  response.headers.set("X-Request-Id", requestId);
  return response;
}

// ── Handler público (sin autenticación obligatoria) ─────────────────────────
export function publicRoute<TBodySchema extends z.ZodTypeAny = never, TQuerySchema extends z.ZodTypeAny = never>(
  options: BaseOptions<TBodySchema, TQuerySchema>,
  handler: (ctx: HandlerContext<Infer<TBodySchema>, Infer<TQuerySchema>>) => Promise<NextResponse | unknown>
) {
  return async (req: NextRequest, routeCtx: RouteParams): Promise<NextResponse> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const startedAt = Date.now();
    const log = logger.child({ requestId, event: options.event, method: req.method, path: req.nextUrl.pathname });

    try {
      if (options.rateLimit) enforce(identify(req), options.rateLimit);

      const params = routeCtx?.params ? await routeCtx.params : {};
      const ctx: HandlerContext<Infer<TBodySchema>, Infer<TQuerySchema>> = {
        req,
        requestId,
        log,
        params,
        body: validate(options.body, await parseBody(req)),
        query: validate(options.query, queryToObject(req)),
      };

      const result = await handler(ctx);
      const response = result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
      response.headers.set("X-Request-Id", requestId);
      log.info("ok", { status: response.status, durationMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      return respondWithError(error, requestId, log, startedAt);
    }
  };
}

// ── Handler autenticado ─────────────────────────────────────────────────────
export function authedRoute<TBodySchema extends z.ZodTypeAny = never, TQuerySchema extends z.ZodTypeAny = never>(
  options: BaseOptions<TBodySchema, TQuerySchema>,
  handler: (ctx: AuthedContext<Infer<TBodySchema>, Infer<TQuerySchema>>) => Promise<NextResponse | unknown>
) {
  return async (req: NextRequest, routeCtx: RouteParams): Promise<NextResponse> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const startedAt = Date.now();
    let log = logger.child({ requestId, event: options.event, method: req.method, path: req.nextUrl.pathname });

    try {
      const user = await getUser();
      if (!user) throw errors.unauthenticated();

      log = logger.child({ requestId, event: options.event, method: req.method, path: req.nextUrl.pathname, userId: user.id });

      if (options.rateLimit) enforce(identify(req, user.id), options.rateLimit);

      const params = routeCtx?.params ? await routeCtx.params : {};
      const ctx: AuthedContext<Infer<TBodySchema>, Infer<TQuerySchema>> = {
        req,
        requestId,
        log,
        params,
        user,
        db: await createUserClient(),
        body: validate(options.body, await parseBody(req)),
        query: validate(options.query, queryToObject(req)),
      };

      const result = await handler(ctx);
      const response = result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
      response.headers.set("X-Request-Id", requestId);
      log.info("ok", { status: response.status, durationMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      return respondWithError(error, requestId, log, startedAt);
    }
  };
}

/**
 * Traduce un error de PostgREST a AppError sin filtrar detalles internos.
 *
 * Sobre PGRST204/PGRST205 ("Could not find the 'x' column/table … in the
 * schema cache"): el mensaje CULPA AL CACHE, pero se emite igual cuando la
 * columna sencillamente no existe. Mapearlo a 503 "recarga el cache" hacía
 * perder horas persiguiendo un `NOTIFY pgrst` que nunca podía arreglarlo.
 * Ahora se trata como lo que es: un desajuste entre el código y el esquema.
 */
export function fromDbError(error: { message: string; code?: string }, resource: string): AppError {
  if (error.code === "PGRST116") return errors.notFound(resource);
  if (error.code === "23505") return errors.conflict(`${resource} ya existe.`);
  if (error.code === "23503") return errors.validation(`Referencia inválida al crear ${resource}.`);
  if (error.code === "42501") return errors.forbidden("No tienes permiso sobre este recurso (RLS).");

  if (error.code === "PGRST204" || error.code === "PGRST205" || /schema cache/i.test(error.message)) {
    const missing = error.message.match(/'([^']+)'/)?.[1];
    return new AppError(
      "internal",
      `El esquema de la base de datos no coincide con el código: ${missing ? `no existe '${missing}'` : error.message}. ` +
        `Revisa que las migraciones de supabase/migrations estén aplicadas. ` +
        `Si la columna SÍ existe en la tabla, recarga el cache con: NOTIFY pgrst, 'reload schema';`,
      { cause: error }
    );
  }

  // 42703 = undefined_column, 42P01 = undefined_table (errores nativos de Postgres)
  if (error.code === "42703" || error.code === "42P01") {
    return new AppError("internal", `El esquema no coincide con el código: ${error.message}`, { cause: error });
  }

  return new AppError("internal", `No se pudo completar la operación sobre ${resource}.`, { cause: error });
}
