#!/usr/bin/env node
// ============================================================================
// Repara los datos que dejó a medias la migración 0002_multitenancy.sql:
//
//   • Crea la fila de `accounts` que falta para cada usuario ya registrado
//     (el backfill de 0002 no llegó a ejecutarse).
//   • Asigna las campañas huérfanas (user_id NULL) al usuario indicado.
//
// Sólo toca DATOS, no el esquema: por eso funciona con la service_role key,
// sin necesidad de conexión directa a Postgres.
//
// Uso:
//   node scripts/repair-account-data.mjs --dry-run     (por defecto)
//   node scripts/repair-account-data.mjs --apply
//   node scripts/repair-account-data.mjs --apply --claim-orphans=<user-uuid>
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = {};
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("No se encontró .env.local en la raíz del proyecto.");
  process.exit(1);
}

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const claimArg = process.argv.find((a) => a.startsWith("--claim-orphans="));
const claimUserId = claimArg?.split("=")[1];

const db = createClient(url, key, { auth: { persistSession: false } });

const log = (s = "") => console.log(s);
const mode = apply ? "APLICANDO CAMBIOS" : "SIMULACIÓN (usa --apply para escribir)";
log(`\n  Vinix — reparación de datos de cuenta\n  Modo: ${mode}\n  ${"─".repeat(60)}`);

// ── 1. Comprobar que la tabla accounts es accesible ─────────────────────────
const probe = await db.from("accounts").select("user_id").limit(1);
if (probe.error) {
  log(`\n  ✗ La tabla 'accounts' no es accesible: ${probe.error.code} — ${probe.error.message}`);
  log(`\n    Aplica primero supabase/migrations/0002_multitenancy.sql en el SQL Editor.`);
  process.exit(1);
}
log(`\n  ✓ Tabla 'accounts' accesible`);

// ── 2. Usuarios sin fila en accounts ────────────────────────────────────────
const { data: userList, error: usersError } = await db.auth.admin.listUsers({ perPage: 1000 });
if (usersError) {
  log(`\n  ✗ No se pudieron listar los usuarios: ${usersError.message}`);
  process.exit(1);
}

const { data: existing } = await db.from("accounts").select("user_id");
const withAccount = new Set((existing ?? []).map((a) => a.user_id));
const missing = userList.users.filter((u) => !withAccount.has(u.id));

log(`\n  Usuarios registrados:      ${userList.users.length}`);
log(`  Con fila en accounts:      ${withAccount.size}`);
log(`  SIN fila en accounts:      ${missing.length}`);

if (missing.length > 0) {
  missing.forEach((u) => log(`    • ${u.email} (${u.id})`));

  if (apply) {
    // El trigger handle_new_user pone los valores por defecto (trial 14 días);
    // aquí replicamos ese alta para los usuarios anteriores a la migración.
    const { error } = await db.from("accounts").insert(missing.map((u) => ({ user_id: u.id })));
    if (error) {
      log(`\n  ✗ Error creando las cuentas: ${error.message}`);
      process.exit(1);
    }
    log(`\n  ✓ ${missing.length} cuenta(s) creada(s) con trial de 14 días`);
  } else {
    log(`\n  → Con --apply se crearían ${missing.length} cuenta(s)`);
  }
}

// ── 3. Campañas huérfanas ───────────────────────────────────────────────────
const { data: orphans } = await db.from("campaigns").select("id, name").is("user_id", null);
log(`\n  Campañas sin propietario:  ${orphans?.length ?? 0}`);
orphans?.forEach((c) => log(`    • ${c.name} (${c.id})`));

if ((orphans?.length ?? 0) > 0) {
  if (!claimUserId) {
    log(`\n  → Para asignarlas añade: --claim-orphans=<user-uuid>`);
    log(`    Usuarios disponibles:`);
    userList.users.forEach((u) => log(`      ${u.id}  ${u.email}`));
  } else {
    const target = userList.users.find((u) => u.id === claimUserId);
    if (!target) {
      log(`\n  ✗ El usuario ${claimUserId} no existe`);
      process.exit(1);
    }

    if (apply) {
      const { error } = await db.from("campaigns").update({ user_id: claimUserId }).is("user_id", null);
      if (error) {
        log(`\n  ✗ Error asignando las campañas: ${error.message}`);
        process.exit(1);
      }
      log(`\n  ✓ ${orphans.length} campaña(s) asignadas a ${target.email}`);
    } else {
      log(`\n  → Con --apply se asignarían a ${target.email}`);
    }
  }
}

// ── 4. Estado final ─────────────────────────────────────────────────────────
log(`\n  ${"─".repeat(60)}\n  Estado por usuario:\n`);
for (const u of userList.users) {
  const { data: acc } = await db.from("accounts").select("plan, trial_ends_at").eq("user_id", u.id).maybeSingle();
  const { count } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("user_id", u.id);

  if (!acc) {
    log(`    ${u.email}: SIN CUENTA → limitado a plan free (1 campaña)`);
    continue;
  }
  const dias = Math.max(0, Math.ceil((new Date(acc.trial_ends_at) - Date.now()) / 86_400_000));
  const limite = acc.plan === "trial" && dias > 0 ? "5 (trial Pro)" : acc.plan === "free" ? "1" : "5+";
  log(`    ${u.email}: plan=${acc.plan}${acc.plan === "trial" ? ` (${dias} días)` : ""} · campañas=${count ?? 0}/${limite}`);
}

log(`\n  ${apply ? "Cambios aplicados." : "Nada modificado (simulación)."}\n`);
