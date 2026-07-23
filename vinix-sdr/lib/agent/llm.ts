// lib/agent/llm.ts
// ============================================================================
// Cliente OpenAI centralizado (SDK oficial `openai` v4+).
// Antes había un getOpenAI() duplicado en graph.ts y scraper.ts; ahora hay
// una única fuente con:
//   - Reintentos automáticos del SDK (maxRetries) para 429/5xx/timeouts
//   - Timeout por petición
//   - completeJSON(): llamada + parseo defensivo + errores con contexto
// ============================================================================

import OpenAI from "openai";

// Modelo por defecto, sobreescribible por variable de entorno sin tocar código
export const LLM_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY no configurada. Añádela a .env.local (platform.openai.com > API keys) y reinicia el servidor."
    );
  }
  if (!cached) {
    cached = new OpenAI({
      apiKey: key,
      maxRetries: 2,     // reintentos con backoff exponencial para 429/5xx/red
      timeout: 45_000,   // por petición; evita requests colgados en Vercel
    });
  }
  return cached;
}

// Parseo defensivo: aunque pedimos response_format json_object, algunos
// modelos envuelven la salida en backticks en casos raros.
function parseJSON<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
  } catch {
    throw new Error(`JSON inválido del modelo en ${context}: ${raw.slice(0, 200)}`);
  }
}

export interface CompleteJSONParams {
  system: string;
  user: string;
  temperature?: number;
  context: string; // etiqueta para mensajes de error ("classifyReply", etc.)
}

// Llamada estándar del agente: system + user → JSON tipado
export async function completeJSON<T>(params: CompleteJSONParams): Promise<T> {
  const openai = getOpenAI();

  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model: LLM_MODEL,
      temperature: params.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    });
  } catch (err) {
    // Errores del SDK ya reintentados: los traducimos a mensajes accionables
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) throw new Error(`OpenAI: API key inválida (revisa OPENAI_API_KEY)`);
      if (err.status === 429) throw new Error(`OpenAI: sin cuota o rate limit persistente (revisa Billing en platform.openai.com)`);
      throw new Error(`OpenAI ${err.status ?? ""} en ${params.context}: ${err.message}`);
    }
    throw new Error(`OpenAI en ${params.context}: ${(err as Error).message}`);
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error(`${params.context}: el modelo devolvió respuesta vacía`);

  return parseJSON<T>(raw, params.context);
}
