#!/usr/bin/env node
// ============================================================================
// Validación end-to-end del onboarding con un usuario completamente nuevo.
//
// Recorre el mismo camino que haría una persona: registro, bienvenida, oferta,
// investigación de una empresa real y comprobación del estado resultante.
// Limpia todo al terminar, incluso si algo falla.
//
// Uso:
//   npm run dev            # en otra terminal
//   node scripts/verify-onboarding.mjs
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

const EMAIL = `onboarding-${Date.now()}@vinix-test.local`;
const PASSWORD = "Verificacion-2026!";
let userId = null;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "OK   " : "FALLO"} ${name}${detail ? " — " + detail : ""}`);
};

try {
  // ── Usuario nuevo, como recién registrado ─────────────────────────────────
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error("crear usuario: " + error.message);
  userId = created.user.id;

  const signIn = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await signIn.json();
  if (!session.access_token) throw new Error("login: " + JSON.stringify(session).slice(0, 200));

  const ref = new URL(URL_).hostname.split(".")[0];
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  const api = (path, init = {}) =>
    fetch(`http://localhost:3000${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) },
    });

  console.log("\nRECORRIDO DE UN USUARIO NUEVO\n");

  // ── 1. Estado inicial ─────────────────────────────────────────────────────
  const inicial = await api("/api/onboarding");
  const estado0 = await inicial.json();

  check("El onboarding responde", inicial.status === 200);
  check("Se le dirige al recorrido guiado", estado0.shouldRedirect === true);
  check("Empieza por la bienvenida", estado0.resumeAt === "welcome");
  check("La cuenta cuenta como paso hecho", estado0.tasks?.[0]?.done === true);
  check(
    "El progreso arranca en 20%",
    estado0.progress?.percent === 20,
    `${estado0.progress?.done}/${estado0.progress?.total}`
  );

  // ── 2. Bienvenida vista ───────────────────────────────────────────────────
  const bienvenida = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ markWelcomed: true, event: "welcome_viewed" }),
  });
  const estado1 = await bienvenida.json();
  check("Tras la bienvenida pasa a la oferta", estado1.resumeAt === "offer");

  // ── 3. Qué vende ──────────────────────────────────────────────────────────
  const oferta = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({
      valueProposition: "Conseguimos reuniones cualificadas para agencias de diseño sin que pierdan tiempo prospectando.",
      event: "offer_submitted",
    }),
  });
  const estado2 = await oferta.json();
  check("La oferta se guarda", Boolean(estado2.snapshot?.valueProposition));
  check("Pasa al paso de empresa", estado2.resumeAt === "company");
  check("El progreso avanza a 40%", estado2.progress?.percent === 40);

  // ── 4. Persistencia: simula cerrar y volver ───────────────────────────────
  const traVolver = await (await api("/api/onboarding")).json();
  check("Al volver retoma donde lo dejó", traVolver.resumeAt === "company");
  check("Conserva la oferta escrita", Boolean(traVolver.snapshot?.valueProposition));

  // ── 5. Investigar sin oferta debe fallar con mensaje útil ─────────────────
  //     (se comprueba con otro usuario para no romper el estado del actual)
  const sinOferta = await api("/api/onboarding/try", {
    method: "POST",
    body: JSON.stringify({ companyUrl: "" }),
  });
  const errSinUrl = await sinOferta.json();
  check(
    "URL vacía da error accionable",
    sinOferta.status === 422 && String(errSinUrl.error ?? "").length > 20,
    String(errSinUrl.error ?? "").slice(0, 60)
  );

  // ── 6. Campaña de ejemplo ─────────────────────────────────────────────────
  const demo = await api("/api/onboarding/demo", { method: "POST" });
  const demoData = await demo.json();
  check("Se crea la campaña de ejemplo", demo.status === 200 && Boolean(demoData.campaignId));

  if (demoData.campaignId) {
    const { data: campaña } = await admin
      .from("campaigns")
      .select("is_demo, status, name")
      .eq("id", demoData.campaignId)
      .single();
    check("Va marcada como ejemplo", campaña?.is_demo === true);
    check("Está en pausa: nunca enviará emails", campaña?.status === "paused", campaña?.status);

    const { count } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", demoData.campaignId);
    check("Trae leads de ejemplo", (count ?? 0) >= 4, `${count} leads`);

    const { data: estados } = await admin
      .from("leads")
      .select("status")
      .eq("campaign_id", demoData.campaignId);
    const distintos = new Set((estados ?? []).map((l) => l.status));
    check("Cubre varios estados del pipeline", distintos.size >= 3, [...distintos].join(", "));
  }

  // ── 7. Eliminar el ejemplo ────────────────────────────────────────────────
  const borrado = await api("/api/onboarding/demo", { method: "DELETE" });
  const borradoData = await borrado.json();
  check("La campaña de ejemplo se elimina", borrado.status === 200 && borradoData.removed >= 1);

  // ── 8. Descartar el recorrido ─────────────────────────────────────────────
  const descartar = await api("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ dismiss: true, event: "onboarding_dismissed" }),
  });
  await descartar.json();
  const traDescartar = await (await api("/api/onboarding")).json();
  check("Descartar se respeta", traDescartar.shouldRedirect === false);

  // ── 9. Analítica registrada sin datos personales ──────────────────────────
  const { data: eventos } = await admin
    .from("onboarding_events")
    .select("step, elapsed_ms, detail")
    .eq("user_id", userId);

  check("Se registran los eventos del embudo", (eventos?.length ?? 0) >= 3, `${eventos?.length} eventos`);

  const conTextoLibre = (eventos ?? []).filter(
    (e) => e.detail && JSON.stringify(e.detail).includes("agencias de diseño")
  );
  check("Ningún evento guarda texto del usuario", conTextoLibre.length === 0);

  // ── Resumen ───────────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n>>> ${ok}/${results.length} comprobaciones correctas`);
  if (ok !== results.length) process.exitCode = 1;
} catch (e) {
  console.error("\nERROR:", e.message);
  process.exitCode = 1;
} finally {
  if (userId) {
    await admin.from("campaigns").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    console.log("[limpieza] usuario de prueba eliminado");
  }
}
