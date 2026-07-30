#!/usr/bin/env node
// ============================================================================
// Ejecuta las migraciones de supabase/migrations en orden.
//
// Uso:
//   npm run db:migrate                    # aplica las pendientes
//   npm run db:migrate -- --dry-run       # sólo muestra qué haría
//
// Necesita SUPABASE_DB_URL (Supabase → Settings → Database → Connection string
// → URI, en modo "Session"). Si no la tienes, pega los archivos a mano en el
// SQL Editor en orden numérico: son idempotentes.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Carga .env.local si existe, sin exigir dotenv en producción
try {
  require("dotenv").config({ path: join(root, ".env.local") });
} catch {
  /* dotenv es opcional */
}

const dryRun = process.argv.includes("--dry-run");
const migrationsDir = join(root, "supabase", "migrations");

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // el prefijo numérico define el orden

if (files.length === 0) {
  console.error("No se encontraron migraciones en supabase/migrations");
  process.exit(1);
}

console.log(`Migraciones encontradas (${files.length}):`);
files.forEach((f) => console.log(`  • ${f}`));

if (dryRun) {
  console.log("\n--dry-run: no se ha ejecutado nada.");
  process.exit(0);
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    "\nFalta SUPABASE_DB_URL.\n" +
      "  1. Supabase → Settings → Database → Connection string → URI (modo Session)\n" +
      "  2. Añádela a .env.local como SUPABASE_DB_URL=postgresql://...\n\n" +
      "Alternativa sin configurar nada: abre el SQL Editor de Supabase y pega el\n" +
      "contenido de cada archivo en orden numérico. Son idempotentes."
  );
  process.exit(1);
}

let pg;
try {
  pg = require("pg");
} catch {
  console.error("\nFalta la dependencia 'pg'. Instálala con:  npm install -D pg");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log("\nConectado. Aplicando migraciones…\n");

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`  ${file} … `);
    // Cada migración en su propia transacción: si una falla, las anteriores
    // quedan aplicadas y se puede reintentar desde ahí.
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
      console.log("ok");
    } catch (error) {
      await client.query("rollback");
      console.log("FALLÓ");
      throw new Error(`${file}: ${error.message}`);
    }
  }

  // El cache de PostgREST no se entera de los ALTER TABLE por su cuenta
  await client.query("notify pgrst, 'reload schema'");
  console.log("\nTodas las migraciones aplicadas. Cache de esquema recargado.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
