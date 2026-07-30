#!/usr/bin/env node
// ============================================================================
// Detecta exportaciones que nadie importa.
//
// Lee todos los archivos una sola vez y cruza en memoria, en lugar de recorrer
// el árbol por cada símbolo (lo que tarda minutos en un proyecto mediano).
//
// NO ELIMINA NADA: sólo informa. Algunos resultados son intencionados —
// utilidades públicas de un módulo, helpers que sólo usan los tests, o
// tipos reexportados.
//
// Uso:  node scripts/find-dead-code.mjs
// ============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const IGNORE = /node_modules|\.next|coverage|test-results|playwright-report/;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (IGNORE.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = walk(ROOT);
const contents = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

// ── Recolectar exportaciones ────────────────────────────────────────────────
const EXPORT_PATTERNS = [
  /^export\s+(?:async\s+)?function\s+(\w+)/gm,
  /^export\s+(?:const|let)\s+(\w+)/gm,
  /^export\s+class\s+(\w+)/gm,
  /^export\s+(?:interface|type)\s+(\w+)/gm,
];

const exportsByFile = new Map();
for (const [file, source] of contents) {
  const names = new Set();
  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  if (names.size > 0) exportsByFile.set(file, names);
}

// ── Cruzar con los usos ─────────────────────────────────────────────────────
const unused = [];
const onlyTests = [];

for (const [file, names] of exportsByFile) {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b`);
    let usedInSource = false;
    let usedInTests = false;

    for (const [other, source] of contents) {
      if (other === file) continue;
      if (!pattern.test(source)) continue;
      if (/[\\/]tests[\\/]/.test(other)) usedInTests = true;
      else usedInSource = true;
      if (usedInSource) break;
    }

    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (!usedInSource && !usedInTests) unused.push({ file: rel, name });
    else if (!usedInSource) onlyTests.push({ file: rel, name });
  }
}

const group = (rows) => {
  const byFile = new Map();
  for (const { file, name } of rows) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(name);
  }
  return [...byFile.entries()].sort();
};

console.log("\n  CÓDIGO POTENCIALMENTE MUERTO\n  " + "─".repeat(64));

console.log("\n  Exportaciones que nadie importa (candidatas a eliminar):");
const sinUso = group(unused);
if (sinUso.length === 0) console.log("    (ninguna)");
for (const [file, names] of sinUso) console.log(`    ${file}\n      ${names.join(", ")}`);

console.log("\n  Exportaciones usadas SÓLO por los tests:");
const soloTests = group(onlyTests);
if (soloTests.length === 0) console.log("    (ninguna)");
for (const [file, names] of soloTests) console.log(`    ${file}\n      ${names.join(", ")}`);

console.log(`\n  Archivos analizados: ${files.length}`);
console.log(`  Exportaciones totales: ${[...exportsByFile.values()].reduce((n, s) => n + s.size, 0)}`);
console.log(`  Sin uso: ${unused.length}   ·   Sólo en tests: ${onlyTests.length}\n`);
