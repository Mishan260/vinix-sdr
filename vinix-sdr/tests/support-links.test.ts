import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// El bloque de aportaciones es un componente estático: lo que puede romperse
// no es lógica, sino que la URL de destino cambie por accidente en un refactor
// y el dinero acabe en otra cuenta (o en ninguna). Estos tests fijan eso.
// ============================================================================

const source = readFileSync(join(process.cwd(), "components", "support-project.tsx"), "utf8");

describe("bloque de aportaciones", () => {
  it("apunta a la cuenta de PayPal correcta", () => {
    expect(source).toContain('const PAYPAL_USERNAME = "EdgarTe82"');
  });

  it("construye la URL sobre el dominio oficial de PayPal", () => {
    expect(source).toContain("https://paypal.me/${PAYPAL_USERNAME}");
    // Sin http:// ni dominios parecidos que podrían ser phishing
    expect(source).not.toMatch(/http:\/\/paypal/i);
    expect(source).not.toMatch(/payp[a4]l\.(?!me)/i);
  });

  it("fija la divisa en euros", () => {
    // Sin sufijo, PayPal usaría la divisa del visitante: 5 USD para alguien
    // de EE. UU. cuando el proyecto factura en euros
    expect(source).toContain("${amount}EUR");
  });

  it("abre PayPal en pestaña nueva con rel seguro", () => {
    const targets = source.match(/target="_blank"/g) ?? [];
    const rels = source.match(/rel="noopener noreferrer"/g) ?? [];
    // Cada target="_blank" necesita su rel: sin noopener, la pestaña abierta
    // puede manipular esta página vía window.opener
    expect(rels.length).toBe(targets.length);
    expect(targets.length).toBeGreaterThan(0);
  });

  it("cada enlace de importe tiene aria-label descriptivo", () => {
    expect(source).toContain("aria-label={`Aportar ${amount} euros mediante PayPal");
    expect(source).toMatch(/se abre en una pestaña nueva/);
  });

  it("aclara que no es una suscripción ni desbloquea funciones", () => {
    // Va justo debajo de los planes de pago: sin esta aclaración alguien
    // podría donar creyendo que está contratando Pro
    expect(source).toMatch(/no es una suscripción/i);
    expect(source).toMatch(/no desbloquea|ni desbloquea/i);
  });

  it("declara que no se recogen datos de pago", () => {
    expect(source).toMatch(/no recogemos ni guardamos ningún dato/i);
  });

  it("no contiene ningún campo de entrada de datos de pago", () => {
    // El cobro ocurre íntegramente en PayPal: aquí sólo hay enlaces
    expect(source).not.toMatch(/<input/i);
    expect(source).not.toMatch(/<form/i);
  });
});
