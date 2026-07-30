#!/usr/bin/env node
// ============================================================================
// Prueba de humo de la API con sesión real.
//
// Crea un usuario, una campaña y un lead desechables, recorre los endpoints
// principales autenticado como ese usuario, y lo borra todo al terminar
// (incluso si algo falla: la limpieza va en `finally`).
//
// Uso:
//   npm run dev          # en otra terminal
//   npm run smoke
//
// ⚠️ Escribe en la base de datos configurada en .env.local. Úsalo contra un
// proyecto de desarrollo, no contra producción con clientes reales.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const URL_ = env.SUPABASE_URL;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const EMAIL = `smoke-${Date.now()}@vinix-test.local`;
const PASSWORD = "Verificacion-2026!";
let userId, campaignId;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "OK  " : "FALLO"} ${name}${detail ? " — " + detail : ""}`);
};

try {
  const { data: u } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  userId = u.user.id;

  const { data: c } = await admin.from("campaigns").insert({
    user_id: userId, name: "SMOKE", value_proposition: "vp",
    sender_name: "T", sender_email: "t@example.com", base_template: "",
  }).select("id").single();
  campaignId = c.id;

  await admin.from("leads").insert({
    campaign_id: campaignId, company_name: "Acme Smoke",
    company_url: "https://example.com", contact_email: "acme@example.com", status: "pending",
  });

  const signIn = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await signIn.json();
  const ref = new URL(URL_).hostname.split(".")[0];
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  const api = (path, init = {}) =>
    fetch(`http://localhost:3000${path}`, { ...init, headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) } });

  console.log("\nRutas modificadas en el Bloque 2:\n");

  const leads = await api(`/api/leads?campaignId=${campaignId}`);
  const leadsBody = await leads.json();
  check("GET /api/leads", leads.status === 200 && leadsBody.leads?.length === 1);

  const filtered = await api(`/api/leads?campaignId=${campaignId}&status=pending`);
  check("GET /api/leads?status=pending (enum válido)", filtered.status === 200);

  const bad = await api(`/api/leads?campaignId=${campaignId}&status=inventado`);
  const badBody = await bad.json();
  check("GET /api/leads?status=inventado -> 422", bad.status === 422, badBody.error?.slice(0, 50));

  const leadId = leadsBody.leads?.[0]?.id;
  const patch = await api(`/api/leads?id=${leadId}`, {
    method: "PATCH",
    body: JSON.stringify({ contact_name: "Ana Tipada", company_url: "acme.example" }),
  });
  check("PATCH /api/leads", patch.status === 200);

  const { data: after } = await admin.from("leads").select("contact_name, company_url").eq("id", leadId).single();
  check("PATCH persistido", after.contact_name === "Ana Tipada" && after.company_url === "https://acme.example",
    `${after.contact_name} / ${after.company_url}`);

  const tpl = await api(`/api/templates?campaignId=${campaignId}`);
  const tplBody = await tpl.json();
  check("GET /api/templates", tpl.status === 200 && tplBody.campaign?.followups_enabled !== undefined);

  const put = await api("/api/templates", {
    method: "PUT",
    body: JSON.stringify({
      campaignId, base_template: "t", value_proposition: "v",
      followups_enabled: true, followup_delay_days: 5, followup_max_touches: 2, daily_send_limit: 30,
    }),
  });
  check("PUT /api/templates", put.status === 200);

  const replies = await api(`/api/replies?campaignId=${campaignId}`);
  check("GET /api/replies", replies.status === 200);

  const exp = await api(`/api/leads/export?campaignId=${campaignId}`);
  check("GET /api/leads/export (gate de plan)", [200, 402].includes(exp.status), `HTTP ${exp.status}`);

  const acc = await api("/api/account");
  const accBody = await acc.json();
  check("GET /api/account", acc.status === 200 && !!accBody.limits);

  const fu = await api(`/api/agent/followups?campaignId=${campaignId}`);
  check("GET /api/agent/followups", fu.status === 200);

  const total = results.length, ok = results.filter((r) => r.ok).length;
  console.log(`\n>>> ${ok}/${total} correctas`);
  if (ok !== total) process.exitCode = 1;
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (campaignId) await admin.from("campaigns").delete().eq("id", campaignId);
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log("[limpieza] usuario y datos de prueba eliminados");
}
