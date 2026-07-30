#!/usr/bin/env node
// ============================================================================
// Mide el número REAL de round-trips a PostgREST por operación.
//
// No estima ni cuenta llamadas en el código: envuelve el `fetch` que usa
// supabase-js y registra cada petición HTTP que sale de verdad, con su
// latencia. Es la única forma de contar consultas sin instrumentar Postgres.
//
// Uso:  node scripts/bench-queries.mjs
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

// ── Instrumentación: fetch que cuenta y cronometra ──────────────────────────
const calls = [];
let recording = false;

const countingFetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!recording || !url.includes("/rest/v1/")) return fetch(input, init);

  const started = performance.now();
  const res = await fetch(input, init);
  const ms = performance.now() - started;

  // /rest/v1/campaigns?select=id&user_id=eq.x  →  campaigns?select=id
  const path = url.split("/rest/v1/")[1] ?? url;
  const table = path.split("?")[0];
  const select = new URLSearchParams(path.split("?")[1] ?? "").get("select") ?? "";

  calls.push({ table, select: select.slice(0, 46), ms: Math.round(ms), status: res.status });
  return res;
};

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { fetch: countingFetch },
});

async function measure(label, fn) {
  calls.length = 0;
  recording = true;
  const started = performance.now();
  let error = null;
  try {
    await fn();
  } catch (e) {
    error = e.message;
  }
  const total = Math.round(performance.now() - started);
  recording = false;

  console.log(`\n  ${label}`);
  console.log(`  ${"─".repeat(66)}`);
  calls.forEach((c, i) => {
    const flag = c.status >= 400 ? " ⚠" : "";
    console.log(`    ${String(i + 1).padStart(2)}. ${c.table.padEnd(16)} ${String(c.ms).padStart(4)}ms  ${c.select}${flag}`);
  });
  if (error) console.log(`    (error: ${error.slice(0, 60)})`);
  console.log(`    ${"·".repeat(64)}`);
  console.log(`    CONSULTAS: ${calls.length}   ·   TOTAL: ${total}ms`);

  return { label, queries: calls.length, ms: total };
}

// ── Réplica exacta de lib/billing/account.ts → loadAccount() ────────────────
function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function loadAccountActual(userId) {
  const [accountResult, campaignsResult, leadsResult, subscriptionResult] = await Promise.all([
    db.from("accounts").select("user_id, plan, billing_cycle, trial_ends_at, stripe_customer_id").eq("user_id", userId).maybeSingle(),
    db.from("campaigns").select("id", { count: "exact", head: true }).eq("user_id", userId),
    (async () => {
      const { data: campaigns } = await db.from("campaigns").select("id").eq("user_id", userId);
      const ids = (campaigns ?? []).map((c) => c.id);
      if (ids.length === 0) return 0;
      const { count } = await db
        .from("leads").select("id", { count: "exact", head: true })
        .in("campaign_id", ids).gte("created_at", monthStart().toISOString());
      return count ?? 0;
    })(),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return { accountResult, campaignsResult, leadsResult, subscriptionResult };
}

// ── Ejecución ───────────────────────────────────────────────────────────────
console.log("\n  BENCHMARK — round-trips reales a PostgREST");
console.log("  proyecto:", env.SUPABASE_URL);

const { data: users } = await db.auth.admin.listUsers();
const userId = users.users[0]?.id;
if (!userId) {
  console.error("\n  No hay usuarios en la base de datos; no se puede medir.");
  process.exit(1);
}
console.log("  usuario de prueba:", users.users[0].email);

const results = [];
results.push(await measure("loadAccount() — implementación actual", () => loadAccountActual(userId)));

// Se invoca en 5 endpoints distintos
console.log(`\n  ${"═".repeat(68)}`);
console.log("  IMPACTO");
console.log(`  ${"═".repeat(68)}`);
const q = results[0].queries;
console.log(`
  loadAccount() cuesta ${q} consultas y se llama en 5 endpoints:
    /api/account · campaigns POST · leads/import · leads/export · followups POST

  Con 1.000 usuarios activos haciendo 1 operación/min:
    ${q} × 1.000 = ${(q * 1000).toLocaleString("es-ES")} consultas/min  (${(q * 60000).toLocaleString("es-ES")}/hora)
`);
