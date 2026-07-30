// lib/env.ts
// ============================================================================
// Validación centralizada de variables de entorno con Zod.
//
// DECISIÓN DE DISEÑO — validación perezosa, no en el import:
// Next.js evalúa los módulos durante `next build` (fase "Collecting page data"),
// cuando las variables de runtime todavía no existen. Un `throw` a nivel de
// módulo rompería cualquier build en Vercel. Por eso el parseo ocurre dentro
// de getEnv(), con el resultado cacheado tras el primer acceso correcto.
//
// Uso:
//   const env = getEnv();            // lanza ConfigError con detalle si falta algo
//   const env = getEnvSafe();        // devuelve null en vez de lanzar
//   describeEnvHealth();             // para el endpoint /api/health
// ============================================================================

import { z } from "zod";

// Limpia comillas y espacios que se cuelan al pegar valores en .env.local
const cleaned = (v: unknown) => {
  if (typeof v !== "string") return v;
  const s = v.trim().replace(/^["']|["']$/g, "");
  return s.length > 0 ? s : undefined;
};

const optionalString = z.preprocess(cleaned, z.string().min(1).optional());
const requiredString = (msg: string) => z.preprocess(cleaned, z.string({ required_error: msg }).min(1, msg));

// ── Esquema ─────────────────────────────────────────────────────────────────
// `critical`: sin esto la app no arranca.
// `optional`: degrada funcionalidad pero no rompe (se reporta en /api/health).
const serverSchema = z.object({
  // Supabase — acepta ambas convenciones de nombre
  SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: requiredString("SUPABASE_SERVICE_ROLE_KEY es obligatoria (Supabase → Settings → API → service_role)"),
  SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,

  // OpenAI
  OPENAI_API_KEY: requiredString("OPENAI_API_KEY es obligatoria (platform.openai.com → API keys)"),
  OPENAI_MODEL: z.preprocess(cleaned, z.string().default("gpt-4o-mini")),

  // Email (Resend)
  RESEND_API_KEY: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  SENDER_NAME: optionalString,
  SENDER_EMAIL: optionalString,

  // Scraping
  FIRECRAWL_API_KEY: optionalString,

  // Stripe
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_PRO_MONTHLY: optionalString,
  STRIPE_PRICE_PRO_ANNUAL: optionalString,
  STRIPE_PRICE_AGENCY_MONTHLY: optionalString,
  STRIPE_PRICE_AGENCY_ANNUAL: optionalString,

  // Infraestructura
  CRON_SECRET: optionalString,
  NEXT_PUBLIC_SITE_URL: optionalString,
  SENTRY_DSN: optionalString,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema> & {
  supabaseUrl: string;
  supabaseAnonKey: string | undefined;
  siteUrl: string;
};

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Configuración inválida:\n${issues.map((i) => `  • ${i}`).join("\n")}\n\n` +
        `Copia .env.example a .env.local, rellena las claves y REINICIA el servidor (Ctrl+C → npm run dev).`
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

let cache: ServerEnv | null = null;

// ── Coherencia entre la URL y las claves ────────────────────────────────────
// Las claves de Supabase son JWT que llevan dentro el `ref` del proyecto al
// que pertenecen. Si alguien cambia SUPABASE_URL a otro proyecto y olvida
// cambiar las claves, la app arranca sin error aparente y PostgREST responde
// 401 "Invalid API key" a TODA consulta: el panel se ve vacío o roto sin que
// nada explique por qué. Comparar ambos refs convierte ese fallo silencioso
// en un mensaje inequívoco.

/** Extrae el `ref` del proyecto de una clave JWT de Supabase. */
export function projectRefFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")) as { ref?: string };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

/** Extrae el `ref` del proyecto de la URL (https://<ref>.supabase.co). */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith(".supabase.co")) return null;
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

export interface RefMismatch {
  key: string;
  urlRef: string;
  keyRef: string;
}

/**
 * Devuelve las claves cuyo proyecto no coincide con el de SUPABASE_URL.
 * Vacío si todo es coherente (o si no se puede determinar, p. ej. en tests
 * con claves sintéticas).
 */
export function findProjectRefMismatches(source: Record<string, string | undefined>): RefMismatch[] {
  const url = cleaned(source.SUPABASE_URL) ?? cleaned(source.NEXT_PUBLIC_SUPABASE_URL);
  const urlRef = projectRefFromUrl(url as string | undefined);
  if (!urlRef) return [];

  const candidates: [string, string | undefined][] = [
    ["SUPABASE_SERVICE_ROLE_KEY", cleaned(source.SUPABASE_SERVICE_ROLE_KEY) as string | undefined],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", cleaned(source.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined],
    ["SUPABASE_ANON_KEY", cleaned(source.SUPABASE_ANON_KEY) as string | undefined],
  ];

  const mismatches: RefMismatch[] = [];
  for (const [name, key] of candidates) {
    const keyRef = projectRefFromKey(key);
    if (keyRef && keyRef !== urlRef) mismatches.push({ key: name, urlRef, keyRef });
  }
  return mismatches;
}

function build(): { env: ServerEnv | null; issues: string[] } {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.join(".");
      return path ? `${path}: ${i.message}` : i.message;
    });
    return { env: null, issues };
  }

  const raw = parsed.data;
  const supabaseUrl = raw.SUPABASE_URL ?? raw.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    return { env: null, issues: ["SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) es obligatoria"] };
  }

  const mismatches = findProjectRefMismatches(process.env);
  if (mismatches.length > 0) {
    return {
      env: null,
      issues: mismatches.map(
        (m) =>
          `${m.key} es del proyecto '${m.keyRef}' pero SUPABASE_URL apunta a '${m.urlRef}'. ` +
          `Todas las consultas fallarían con 401 "Invalid API key".`
      ),
    };
  }

  return {
    env: {
      ...raw,
      supabaseUrl,
      supabaseAnonKey: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? raw.SUPABASE_ANON_KEY,
      siteUrl: raw.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    },
    issues: [],
  };
}

/** Devuelve el entorno validado. Lanza ConfigError si falta algo crítico. */
export function getEnv(): ServerEnv {
  if (cache) return cache;
  const { env, issues } = build();
  if (!env) throw new ConfigError(issues);
  cache = env;
  return env;
}

/** Igual que getEnv() pero devuelve null en vez de lanzar. Para health checks. */
export function getEnvSafe(): ServerEnv | null {
  try {
    return getEnv();
  } catch {
    return null;
  }
}

/** Estado de configuración para /api/health, separando crítico de opcional. */
export function describeEnvHealth(): { critical: string[]; warnings: string[] } {
  const { env, issues } = build();
  if (!env) return { critical: issues, warnings: [] };

  // Un desajuste de proyecto rompe TODA consulta con 401: es crítico, no un aviso
  const mismatches = findProjectRefMismatches(process.env);
  if (mismatches.length > 0) {
    return {
      critical: mismatches.map(
        (m) =>
          `${m.key} pertenece al proyecto '${m.keyRef}' pero SUPABASE_URL apunta a '${m.urlRef}'. ` +
          `Copia las claves del proyecto correcto desde Supabase → Settings → API.`
      ),
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (!env.RESEND_API_KEY) warnings.push("RESEND_API_KEY — necesaria para enviar emails");
  if (!env.SENDER_EMAIL) warnings.push("SENDER_EMAIL — remitente por defecto de los emails");
  if (!env.RESEND_WEBHOOK_SECRET) warnings.push("RESEND_WEBHOOK_SECRET — necesaria para recibir y clasificar respuestas");
  if (!env.FIRECRAWL_API_KEY) warnings.push("FIRECRAWL_API_KEY — opcional; sin ella el scraping usa fetch simple, insuficiente para webs con JavaScript");
  if (!env.STRIPE_SECRET_KEY) warnings.push("STRIPE_SECRET_KEY — necesaria para cobrar suscripciones");
  if (!env.STRIPE_WEBHOOK_SECRET) warnings.push("STRIPE_WEBHOOK_SECRET — necesaria para sincronizar el estado de las suscripciones");
  if (!env.supabaseAnonKey) warnings.push("NEXT_PUBLIC_SUPABASE_ANON_KEY — necesaria para el login de usuarios");

  return { critical: [], warnings };
}

/** Solo para tests: limpia el cache tras manipular process.env. */
export function resetEnvCache(): void {
  cache = null;
}
