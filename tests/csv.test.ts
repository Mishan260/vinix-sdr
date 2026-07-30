import { describe, it, expect } from "vitest";
import { parseLeadsCsv, csvField, toCsv } from "@/lib/leads/csv";

describe("parseLeadsCsv", () => {
  it("parsea un CSV básico con separador coma", () => {
    const { rows, delimiter } = parseLeadsCsv("company_name,contact_email\nAcme,a@acme.com");
    expect(delimiter).toBe(",");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_name: "Acme", contact_email: "a@acme.com" });
  });

  it("autodetecta el separador punto y coma de Excel en español", () => {
    const { rows, delimiter } = parseLeadsCsv("company_name;contact_email\nAcme;a@acme.com");
    expect(delimiter).toBe(";");
    expect(rows[0].company_name).toBe("Acme");
  });

  it("elimina el BOM que Excel antepone al guardar en UTF-8", () => {
    const { rows } = parseLeadsCsv("﻿company_name,contact_email\nAcme,a@acme.com");
    // Sin el strip, la clave sería "﻿company_name" y la fila se perdería
    expect(Object.keys(rows[0])).toContain("company_name");
    expect(rows[0].company_name).toBe("Acme");
  });

  it("respeta comas dentro de campos entrecomillados", () => {
    const { rows } = parseLeadsCsv('company_name,contact_name\n"Acme, S.L.",Ana');
    expect(rows[0].company_name).toBe("Acme, S.L.");
    expect(rows[0].contact_name).toBe("Ana");
  });

  it("respeta saltos de línea dentro de campos entrecomillados", () => {
    // Un split("\n") ingenuo partiría esta fila en dos y corrompería los datos
    const { rows } = parseLeadsCsv('company_name,contact_role\n"Acme","Dir.\nComercial"');
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_role).toBe("Dir.\nComercial");
  });

  it("interpreta las comillas dobles escapadas", () => {
    const { rows } = parseLeadsCsv('company_name\n"Acme ""La Buena"""');
    expect(rows[0].company_name).toBe('Acme "La Buena"');
  });

  it("normaliza cabeceras con mayúsculas, acentos y espacios", () => {
    const { rows } = parseLeadsCsv("Company Name,Contact Email\nAcme,a@acme.com");
    expect(rows[0].company_name).toBe("Acme");
    expect(rows[0].contact_email).toBe("a@acme.com");
  });

  it("traduce alias de cabecera habituales en CRM españoles", () => {
    const { rows } = parseLeadsCsv("Empresa,Correo,Web\nAcme,a@acme.com,acme.com");
    expect(rows[0].company_name).toBe("Acme");
    expect(rows[0].contact_email).toBe("a@acme.com");
    expect(rows[0].company_url).toBe("acme.com");
  });

  it("devuelve vacío si sólo hay cabecera", () => {
    expect(parseLeadsCsv("company_name,contact_email").rows).toHaveLength(0);
  });

  it("ignora líneas totalmente vacías", () => {
    const { rows } = parseLeadsCsv("company_name\nAcme\n\n\nBeta\n");
    expect(rows.map((r) => r.company_name)).toEqual(["Acme", "Beta"]);
  });

  it("rellena con cadena vacía las columnas que faltan en una fila", () => {
    const { rows } = parseLeadsCsv("company_name,contact_email\nAcme");
    expect(rows[0].contact_email).toBe("");
  });
});

describe("csvField — protección contra inyección de fórmulas", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)"])("neutraliza el prefijo peligroso %s", (payload) => {
    // Excel ejecutaría estas celdas como fórmula al abrir el archivo
    expect(csvField(payload).startsWith("'")).toBe(true);
  });

  it("neutraliza una fórmula de ejecución de comandos", () => {
    const attack = "=cmd|'/c calc'!A1";
    const escaped = csvField(attack);
    // El apóstrofo inicial hace que Excel lo trate como texto, no como fórmula.
    // No lleva comillas porque el payload no contiene separadores.
    expect(escaped).toBe("'=cmd|'/c calc'!A1");
    expect(escaped.startsWith("'=")).toBe(true);
  });

  it("aplica ambas defensas cuando el payload lleva separadores", () => {
    const escaped = csvField('=HYPERLINK("http://malo.example","clic")');
    expect(escaped.startsWith("\"'=")).toBe(true);
    expect(escaped.endsWith('"')).toBe(true);
  });

  it("no altera texto normal", () => {
    expect(csvField("Acme")).toBe("Acme");
    expect(csvField("a@acme.com")).toBe("a@acme.com");
  });

  it("entrecomilla y escapa cuando hay separadores o saltos de línea", () => {
    expect(csvField("Acme, S.L.")).toBe('"Acme, S.L."');
    expect(csvField('di "hola"')).toBe('"di ""hola"""');
  });

  it("convierte null y undefined en cadena vacía", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("antepone el BOM para que Excel detecte UTF-8", () => {
    const csv = toCsv(["company_name"], [{ company_name: "Ñandú" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Ñandú");
  });

  it("usa CRLF entre filas", () => {
    const csv = toCsv(["a"], [{ a: "1" }, { a: "2" }]);
    expect(csv).toContain("\r\n");
  });

  it("es reversible con parseLeadsCsv", () => {
    const original = [{ company_name: "Acme, S.L.", contact_email: "a@acme.com" }];
    const { rows } = parseLeadsCsv(toCsv(["company_name", "contact_email"], original));
    expect(rows[0]).toMatchObject(original[0]);
  });
});
