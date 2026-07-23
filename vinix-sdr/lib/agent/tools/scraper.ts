// lib/agent/tools/scraper.ts
// ============================================================================
// PASO 1 — INVESTIGACIÓN
// Firecrawl si hay API key; fallback a fetch simple + limpieza de HTML si no.
// Regla de robustez: si el scraping o la extracción fallan, devolvemos
// { error } y el lead pasa a 'research_failed'. NUNCA se alucinan datos.
// ============================================================================

import { completeJSON } from "../llm";
import { RESEARCH_PROMPT } from "../prompts";

export interface ResearchInput {
  companyName: string;
  companyUrl?: string | null;
}

export interface ResearchOutput {
  sector: string | null;
  size: string | null;
  painPoint: string | null;
  decisionMaker: string | null;
  specificHook: string | null;
  raw: string | null;   // markdown/texto scrapeado (auditoría)
  error?: string;
}

const SCRAPE_TIMEOUT_MS = 25_000;
const MAX_CONTENT_CHARS = 12_000; // contexto suficiente sin quemar tokens

// ── Guard anti-SSRF ─────────────────────────────────────────────────────────
// La URL viene de un CSV subido por el usuario: es entrada no confiable que el
// servidor va a fetchear. Sin este filtro, una fila con http://169.254.169.254
// o http://localhost:8080 haría que el servidor consultara servicios internos.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,                                   // loopback IPv4
  /^0\.0\.0\.0$/,
  /^10\./,                                    // RFC1918
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,                              // link-local (metadata de cloud)
  /^\[?::1\]?$/,                              // loopback IPv6
  /^\[?f[cd][0-9a-f]{2}:/i,                   // IPv6 unique-local
  /^\[?fe80:/i,                               // IPv6 link-local
  /\.(local|internal)$/i,
];

function validatePublicUrl(rawUrl: string): { url?: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `URL inválida: ${rawUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `Protocolo no permitido (${url.protocol}); solo http/https` };
  }
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(url.hostname))) {
    return { error: `Host privado o interno bloqueado: ${url.hostname}` };
  }
  return { url };
}

// ── Scraping con Firecrawl ───────────────────────────────────────────────────
async function scrapeWithFirecrawl(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Firecrawl HTTP ${res.status}`);
    const data = await res.json();
    const markdown: string | undefined = data?.data?.markdown;
    if (!markdown || markdown.trim().length < 100) {
      throw new Error("Contenido scrapeado insuficiente (<100 chars)");
    }
    return markdown.slice(0, MAX_CONTENT_CHARS);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Fallback: fetch directo + strip de HTML (sin render JS) ─────────────────
async function scrapeWithFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VinixSDR/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al hacer fetch de ${url}`);

    // Re-validar tras redirecciones: una URL pública podría redirigir a un host interno
    if (res.url) {
      const finalCheck = validatePublicUrl(res.url);
      if (!finalCheck.url) throw new Error(`Redirección a host bloqueado: ${finalCheck.error}`);
    }

    const html = await res.text();
    // Limpieza básica: fuera scripts, estilos y etiquetas
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 100) {
      throw new Error("Página sin texto útil (posible SPA que requiere render JS; usa Firecrawl)");
    }
    return text.slice(0, MAX_CONTENT_CHARS);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Extracción estructurada con LLM (vía cliente central: reintentos+timeout) ─
async function extractResearch(companyName: string, content: string) {
  return completeJSON<{
    sector: string | null;
    size: string | null;
    pain_point: string | null;
    decision_maker: string | null;
    specific_hook: string | null;
  }>({
    system: RESEARCH_PROMPT,
    temperature: 0, // extracción: cero creatividad
    context: "extractResearch",
    user: `Empresa: ${companyName}\n\nContenido de su web:\n\n${content}`,
  });
}

// ── API pública ───────────────────────────────────────────────────────────────
export async function researchCompany(input: ResearchInput): Promise<ResearchOutput> {
  const empty: ResearchOutput = {
    sector: null, size: null, painPoint: null,
    decisionMaker: null, specificHook: null, raw: null,
  };

  if (!input.companyUrl) {
    // Sin URL no scrapeamos: mejor fallar explícitamente que alucinar
    return { ...empty, error: "Lead sin URL de empresa; investigación imposible." };
  }

  // Los CSV suelen venir sin protocolo
  const rawUrl = input.companyUrl.startsWith("http")
    ? input.companyUrl
    : `https://${input.companyUrl}`;

  // Validación anti-SSRF: solo http(s) hacia hosts públicos
  const { url, error: urlError } = validatePublicUrl(rawUrl);
  if (!url) {
    return { ...empty, error: `URL rechazada: ${urlError}` };
  }

  // 1. Scraping (Firecrawl → fallback fetch)
  let content: string;
  try {
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    content = firecrawlKey
      ? await scrapeWithFirecrawl(url.href, firecrawlKey)
      : await scrapeWithFetch(url.href);
  } catch (err) {
    const msg = (err as Error).name === "AbortError"
      ? `Timeout de scraping (${SCRAPE_TIMEOUT_MS}ms)`
      : (err as Error).message;
    return { ...empty, error: `Scraping falló: ${msg}` };
  }

  // 2. Extracción estructurada
  try {
    const parsed = await extractResearch(input.companyName, content);

    const result: ResearchOutput = {
      sector: parsed.sector ?? null,
      size: parsed.size ?? null,
      painPoint: parsed.pain_point ?? null,
      decisionMaker: parsed.decision_maker ?? null,
      specificHook: parsed.specific_hook ?? null,
      raw: content,
    };

    // Control de calidad: sin hook Y sin dolor, el email saldría genérico (spam)
    if (!result.specificHook && !result.painPoint) {
      result.error = "Investigación sin hook específico ni dolor detectado; revisar manualmente.";
    }

    return result;
  } catch (err) {
    return { ...empty, raw: content, error: `Extracción LLM falló: ${(err as Error).message}` };
  }
}
