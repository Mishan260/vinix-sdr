import { describe, it, expect } from "vitest";
import {
  composeValueProposition,
  isProfileUsable,
  needsProfile,
  PROFILE_QUESTIONS,
  EMPTY_PROFILE,
  type CompanyProfile,
} from "@/lib/onboarding/profile";

// ============================================================================
// Perfil de empresa.
//
// Regresión que fija: `/api/onboarding/try` devolvía 422 con el texto
// «Antes de investigar necesitamos saber qué vendes» cuando faltaba el perfil.
// Eso convertía un dato que aún no habíamos pedido en un error del usuario.
// ============================================================================

const profile = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  ...EMPTY_PROFILE,
  ...over,
});

describe("needsProfile", () => {
  it("pide perfil cuando no hay nada", () => {
    expect(needsProfile(EMPTY_PROFILE)).toBe(true);
  });

  it("NO vuelve a pedirlo si ya sabe qué vende", () => {
    // La regla del producto: preguntar una vez y no volver a hacerlo
    expect(needsProfile(profile({ valueProposition: "Reuniones para agencias" }))).toBe(false);
  });

  it("no acepta una respuesta en blanco como válida", () => {
    expect(needsProfile(profile({ valueProposition: "   " }))).toBe(true);
  });

  it("no exige los campos opcionales", () => {
    const soloObligatorio = profile({ valueProposition: "Vendemos X con resultado Y" });
    expect(needsProfile(soloObligatorio)).toBe(false);
    expect(isProfileUsable(soloObligatorio)).toBe(true);
  });
});

describe("composeValueProposition", () => {
  it("usa sólo la oferta cuando es lo único que hay", () => {
    expect(composeValueProposition(profile({ valueProposition: "Conseguimos reuniones." }))).toBe(
      "Conseguimos reuniones."
    );
  });

  it("añade el público objetivo cuando existe", () => {
    const texto = composeValueProposition(
      profile({ valueProposition: "Conseguimos reuniones.", targetAudience: "agencias de diseño" })
    );
    expect(texto).toContain("Conseguimos reuniones.");
    expect(texto).toContain("Nos dirigimos a: agencias de diseño.");
  });

  it("compone las tres respuestas en un solo texto", () => {
    const texto = composeValueProposition({
      valueProposition: "Conseguimos reuniones.",
      targetAudience: "agencias",
      mainProduct: "prospección gestionada",
    });
    expect(texto).toContain("Conseguimos reuniones.");
    expect(texto).toContain("Nos dirigimos a: agencias.");
    expect(texto).toContain("Producto principal: prospección gestionada.");
  });

  it("ignora los campos vacíos sin dejar espacios sueltos", () => {
    const texto = composeValueProposition(
      profile({ valueProposition: "Vendemos X.", targetAudience: "  ", mainProduct: "" })
    );
    expect(texto).toBe("Vendemos X.");
  });

  it("devuelve cadena vacía con el perfil vacío", () => {
    expect(composeValueProposition(EMPTY_PROFILE)).toBe("");
  });
});

describe("las tres preguntas", () => {
  it("son exactamente tres", () => {
    expect(PROFILE_QUESTIONS).toHaveLength(3);
  });

  it("sólo la primera es obligatoria", () => {
    // Tres campos obligatorios reintroducirían el muro de entrada
    const obligatorias = PROFILE_QUESTIONS.filter((q) => q.required);
    expect(obligatorias).toHaveLength(1);
    expect(obligatorias[0].id).toBe("valueProposition");
  });

  it("cubren qué vende, a quién y qué producto", () => {
    expect(PROFILE_QUESTIONS.map((q) => q.id)).toEqual([
      "valueProposition",
      "targetAudience",
      "mainProduct",
    ]);
  });

  it("cada pregunta trae ayuda y ejemplo", () => {
    for (const q of PROFILE_QUESTIONS) {
      expect(q.label.length, `${q.id} sin etiqueta`).toBeGreaterThan(5);
      expect(q.help.length, `${q.id} sin ayuda`).toBeGreaterThan(30);
      expect(q.placeholder.length, `${q.id} sin ejemplo`).toBeGreaterThan(20);
    }
  });
});
