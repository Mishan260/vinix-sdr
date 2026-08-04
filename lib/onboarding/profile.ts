// lib/onboarding/profile.ts
// ============================================================================
// Perfil comercial del usuario: las tres cosas que el agente no puede deducir
// leyendo la web de otra empresa.
//
// POR QUÉ TRES PREGUNTAS Y NO UNA: con un único campo libre la gente escribe
// «software de gestión» y el agente no sabe a quién dirigirse ni con qué
// producto conectar el dolor detectado. Separarlo produce emails mejor
// apuntados y, sobre todo, deja claro qué falta cuando falta algo.
//
// Sólo la primera respuesta es obligatoria: pedir tres campos obligatorios
// antes de dejar probar el producto reintroduce el muro de entrada que se
// eliminó del onboarding.
// ============================================================================

export interface CompanyProfile {
  /** Qué vende. Obligatorio: sin esto el agente no puede redactar. */
  valueProposition: string | null;
  /** A quién se dirige. Opcional pero muy recomendable. */
  targetAudience: string | null;
  /** Producto o servicio principal. Opcional. */
  mainProduct: string | null;
}

export const EMPTY_PROFILE: CompanyProfile = {
  valueProposition: null,
  targetAudience: null,
  mainProduct: null,
};

/** El perfil está completo si al menos se sabe qué vende. */
export function isProfileUsable(profile: CompanyProfile): boolean {
  return Boolean(profile.valueProposition?.trim());
}

/** ¿Merece la pena volver a preguntar? Sólo si falta lo obligatorio. */
export function needsProfile(profile: CompanyProfile): boolean {
  return !isProfileUsable(profile);
}

/**
 * Texto que recibe el agente.
 *
 * Se compone en el momento en lugar de guardarse duplicado: así, si el usuario
 * completa el público objetivo más tarde, todas las campañas nuevas lo
 * aprovechan sin tener que reescribir nada.
 */
export function composeValueProposition(profile: CompanyProfile): string {
  const partes: string[] = [];

  const oferta = profile.valueProposition?.trim();
  if (oferta) partes.push(oferta);

  const publico = profile.targetAudience?.trim();
  if (publico) partes.push(`Nos dirigimos a: ${publico}.`);

  const producto = profile.mainProduct?.trim();
  if (producto) partes.push(`Producto principal: ${producto}.`);

  return partes.join(" ");
}

// ── Las tres preguntas ──────────────────────────────────────────────────────
export interface ProfileQuestion {
  id: keyof CompanyProfile;
  label: string;
  help: string;
  placeholder: string;
  required: boolean;
  minLength: number;
}

export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  {
    id: "valueProposition",
    label: "¿Qué vende tu empresa?",
    help: "Con el resultado concreto que produce. Es lo que el agente conectará con el dolor que detecte en cada empresa.",
    placeholder:
      "Ej.: conseguimos reuniones cualificadas para agencias de diseño, sin que su equipo pierda tiempo prospectando.",
    required: true,
    minLength: 15,
  },
  {
    id: "targetAudience",
    label: "¿A quién os dirigís?",
    help: "Sector, tamaño y quién decide. Cuanto más concreto, mejor apunta el agente.",
    placeholder: "Ej.: agencias de diseño y desarrollo de 5 a 50 personas en España. Decide el fundador o el director comercial.",
    required: false,
    minLength: 0,
  },
  {
    id: "mainProduct",
    label: "¿Cuál es vuestro producto principal?",
    help: "El que quieres vender en estos emails, si tenéis varios.",
    placeholder: "Ej.: servicio mensual de prospección gestionada.",
    required: false,
    minLength: 0,
  },
];
