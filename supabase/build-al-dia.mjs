// supabase/build-al-dia.mjs
// ============================================================================
// Genera `PONER-AL-DIA.sql` concatenando las migraciones pendientes.
//
// Existe para que el script que se pega en el SQL Editor no pueda quedarse
// desfasado respecto a las migraciones: se regenera, no se mantiene a mano.
//
//   node supabase/build-al-dia.mjs
// ============================================================================

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "migrations");

// 0001 ya está aplicada en el proyecto: incluirla sería ruido inofensivo pero
// alarga el script y confunde al leerlo.
const DESDE = "0002";

const pendientes = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql") && f.slice(0, 4) >= DESDE)
  .sort();

let out = readFileSync(join(here, "_PONER-AL-DIA-HEAD.txt"), "utf8");

for (const file of pendientes) {
  const body = readFileSync(join(migrations, file), "utf8").trim();
  const titulo = file.replace(/\.sql$/, "");
  out += `\n\n-- ${"=".repeat(74)}\n-- MIGRACIÓN ${titulo}\n-- ${"=".repeat(74)}\n\n${body}\n`;
}

out += readFileSync(join(here, "_PONER-AL-DIA-TAIL.txt"), "utf8");

writeFileSync(join(here, "PONER-AL-DIA.sql"), out, "utf8");

console.log(`PONER-AL-DIA.sql generado desde ${pendientes.length} migraciones:`);
for (const f of pendientes) console.log(`  · ${f}`);
