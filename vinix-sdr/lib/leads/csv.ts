// lib/leads/csv.ts
// ============================================================================
// Parseo y serialización de CSV de leads.
//
// Extraído de la route para poder testearlo sin levantar un servidor: el
// parseo de CSV real (BOM de Excel, separador ';' español, comillas escapadas,
// saltos de línea dentro de campos) es donde se concentran los bugs.
// ============================================================================

export interface ParsedCsv {
  rows: Record<string, string>[];
  headers: string[];
  delimiter: string;
}

/** El separador que más aparece en la cabecera gana (Excel español usa ';'). */
function detectDelimiter(headerLine: string): string {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ",";
}

/**
 * Tokeniza respetando comillas, incluidos los saltos de línea dentro de un
 * campo entrecomillado — un split("\n") ingenuo parte esas filas por la mitad.
 */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.length > 0));
}

/** Normaliza cabeceras: minúsculas, sin acentos, espacios → guion bajo. */
function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim()
    .replace(/\s+/g, "_");
}

// Alias frecuentes en exportaciones de CRM y listas compradas
const HEADER_ALIASES: Record<string, string> = {
  empresa: "company_name",
  nombre_empresa: "company_name",
  company: "company_name",
  web: "company_url",
  website: "company_url",
  url: "company_url",
  sitio_web: "company_url",
  contacto: "contact_name",
  nombre: "contact_name",
  name: "contact_name",
  email: "contact_email",
  correo: "contact_email",
  mail: "contact_email",
  cargo: "contact_role",
  puesto: "contact_role",
  role: "contact_role",
  title: "contact_role",
};

export function parseLeadsCsv(text: string): ParsedCsv {
  // Excel antepone un BOM; sin quitarlo la primera cabecera sería "﻿company_name"
  const clean = text.replace(new RegExp("^\\uFEFF"), "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);

  const matrix = tokenize(clean, delimiter);
  if (matrix.length < 2) return { rows: [], headers: [], delimiter };

  const headers = matrix[0].map((h) => {
    const normalized = normalizeHeader(h);
    return HEADER_ALIASES[normalized] ?? normalized;
  });

  const rows = matrix.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });

  return { rows, headers, delimiter };
}

/**
 * Escapa un campo para CSV.
 * El prefijo apóstrofo en campos que empiezan por = + - @ evita la inyección
 * de fórmulas: estos datos vienen de webs scrapeadas y del LLM, y Excel
 * ejecutaría `=cmd|'/c calc'!A1` al abrir el archivo.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** BOM UTF-8: hace que Excel abra el CSV con acentos y ñ correctos. */
const UTF8_BOM = "﻿";

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => csvField(r[h])).join(","))];
  return UTF8_BOM + lines.join("\r\n");
}
