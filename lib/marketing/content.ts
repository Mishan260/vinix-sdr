// lib/marketing/content.ts
// ============================================================================
// Contenido de la landing.
//
// Separado de la presentación por dos motivos: el mensaje comercial cambia
// mucho más a menudo que el diseño, y el JSON-LD de preguntas frecuentes debe
// alimentarse exactamente del mismo texto que ve el usuario (si divergen,
// Google penaliza el marcado que no coincide con el contenido visible).
//
// EL ÁNGULO: todo el sector vende volumen. Vinix vende lo contrario — menos
// emails, mejor investigados, y la garantía de que no se inventa nada. Cada
// bloque de abajo tiene que reforzar eso o sobra.
// ============================================================================

export const HERO = {
  badge: "Prospección con IA verificable",
  headline: "El SDR que investiga",
  headlineAccent: "antes de escribir",
  subhead:
    "Vinix lee la web de cada empresa, encuentra un motivo real para contactarla y redacta un email de menos de 120 palabras. Si no encuentra ese motivo, no escribe: te lo marca para que lo revises.",
  primaryCta: "Empezar gratis",
  secondaryCta: "Ver cómo funciona",
  reassurance: "Sin tarjeta. Tú apruebas cada email antes de que salga.",
} as const;

/** Métricas del hero. Son características del producto, no resultados prometidos. */
export const HERO_STATS = [
  { value: "120", label: "palabras máximo por email", detail: "Límite duro, no una recomendación" },
  { value: "0", label: "datos inventados", detail: "Sin fuente verificable, no se escribe" },
  { value: "100%", label: "aprobados por ti", detail: "Ningún envío automático sin revisión" },
] as const;

// ── El problema que resuelve ────────────────────────────────────────────────
export const PROBLEM = {
  eyebrow: "Por qué el cold email dejó de funcionar",
  title: "El volumen ya no es una ventaja. Es el problema.",
  body:
    "Las herramientas de prospección llevan años compitiendo por ver quién envía más. El resultado: buzones saturados, filtros de spam cada vez más duros y prospectos que reconocen una plantilla en la primera línea.",
  points: [
    {
      title: "Un {{nombre}} no es personalización",
      body: "Insertar el nombre de la empresa en una plantilla produce mil emails idénticos. El prospecto lo nota, y los filtros también.",
    },
    {
      title: "La IA genérica inventa",
      body: "Pedirle a un modelo que escriba sobre una empresa que no conoce produce halagos vacíos o datos falsos. Un dato falso destruye la credibilidad del remitente.",
    },
    {
      title: "Más envíos, peor entregabilidad",
      body: "Google y Microsoft endurecieron sus reglas para remitentes masivos. Enviar más es hoy la forma más rápida de acabar en spam.",
    },
  ],
} as const;

// ── Cómo funciona ───────────────────────────────────────────────────────────
export const HOW_IT_WORKS = {
  eyebrow: "Cómo funciona",
  title: "Cuatro pasos. Tú decides en el último.",
  subtitle: "El agente hace el trabajo pesado. La decisión de enviar sigue siendo tuya.",
  steps: [
    {
      number: "01",
      title: "Importas tus leads",
      body: "Un CSV con el nombre de la empresa basta. Detecta el separador, limpia el formato de Excel y descarta duplicados y contactos que pidieron no ser contactados.",
      detail: "CSV · separador , o ;  ·  deduplicación automática",
    },
    {
      number: "02",
      title: "Vinix investiga cada empresa",
      body: "Lee su web y extrae sector, tamaño, quién decide y —lo importante— un gancho concreto y citable: una cifra, un lanzamiento, una noticia con fecha.",
      detail: "Si la web no da nada aprovechable, lo dice",
    },
    {
      number: "03",
      title: "Redacta un email específico",
      body: "Menos de 120 palabras, abre con el dato concreto de esa empresa, cierra con una pregunta de sí o no. Sin clichés, sin emojis, sin vocabulario de vendedor.",
      detail: "Prohibido: «espero que estés bien», «solución integral», «sinergia»",
    },
    {
      number: "04",
      title: "Lo apruebas y sale",
      body: "Ves el borrador, lo editas si quieres y lo envías. Cuando el prospecto responde, Vinix clasifica la respuesta y propone dos huecos en tu agenda.",
      detail: "Ningún email sale sin que lo hayas visto",
    },
  ],
} as const;

// ── Diferenciación ──────────────────────────────────────────────────────────
export interface Differentiator {
  title: string;
  body: string;
  /** Se pinta en grande y con acento: es EL argumento del producto. */
  highlight?: boolean;
}

export const DIFFERENTIATORS: {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: readonly Differentiator[];
} = {
  eyebrow: "Lo que nos hace distintos",
  title: "La función más importante es la que no tiene nadie",
  subtitle: "Vinix sabe decir «no tengo nada que escribir aquí».",
  items: [
    {
      title: "Falla en voz alta, nunca inventa",
      body: "Si el scraping no encuentra un gancho específico ni un dolor concreto, el lead pasa a revisión manual con el motivo exacto. Otras herramientas rellenarían el hueco con un halago genérico; eso es lo que quema una lista.",
      highlight: true,
    },
    {
      title: "Investigación real, no enriquecimiento",
      body: "No cruza tu lead con una base de datos comprada. Lee la web de la empresa en el momento y extrae lo que dice hoy: un lanzamiento reciente, una oferta de empleo, una nota de prensa.",
    },
    {
      title: "Límite de 120 palabras aplicado",
      body: "No es una sugerencia del prompt. Si el borrador se pasa, se reescribe; si sigue pasándose, se rechaza. Los emails largos no se leen.",
    },
    {
      title: "Lista de supresión global",
      body: "Quien responde «no me interesa» queda bloqueado para siempre en toda la plataforma. No se le vuelve a escribir ni reimportando el CSV.",
    },
    {
      title: "Ritmo que protege tu dominio",
      body: "Límite diario configurable por campaña que cuentan tanto los envíos manuales como los seguimientos. Tu reputación de remitente no es negociable.",
    },
    {
      title: "Respuestas clasificadas al instante",
      body: "Cuando alguien contesta, el agente distingue interés real de un «ahora no» y propone dos huecos concretos. Lo dudoso lo marca para que lo mires tú.",
    },
  ],
};

// ── Casos de uso ────────────────────────────────────────────────────────────
export const USE_CASES = {
  eyebrow: "Para quién es",
  title: "Diseñado para quien vende con criterio",
  items: [
    {
      title: "Agencias y consultoras",
      body: "Una campaña por cliente, con su propia propuesta de valor y su remitente. El informe semanal sale en CSV.",
      metric: "Campañas independientes por cliente",
    },
    {
      title: "SaaS B2B en fase temprana",
      body: "Sin equipo de ventas todavía. El fundador aprueba los emails en diez minutos al día y mantiene el pipeline vivo.",
      metric: "10 minutos al día",
    },
    {
      title: "Equipos de ventas pequeños",
      body: "El SDR deja de investigar a mano y dedica el tiempo a las conversaciones que ya están abiertas.",
      metric: "La investigación deja de ser trabajo manual",
    },
  ],
} as const;

// ── Prueba social (marcadores hasta tener clientes reales) ──────────────────
export const SOCIAL_PROOF = {
  logosLabel: "Construido para equipos que venden a empresas como estas",
  // Nombres genéricos a propósito: poner logos de empresas que no son clientes
  // sería publicidad engañosa.
  logos: ["Northwind", "Meridian", "Kestrel", "Lumen", "Atlas", "Verso"],
  testimonials: [
    {
      quote:
        "Lo que más valoro es que me diga «esta empresa no tiene nada aprovechable en su web». Prefiero 8 emails buenos que 50 rellenos.",
      author: "Perfil de cliente objetivo",
      role: "Fundador · agencia de desarrollo",
      placeholder: true,
    },
    {
      quote:
        "El límite de 120 palabras me obligó a cambiar cómo escribo. Las respuestas subieron cuando los emails bajaron de tamaño.",
      author: "Perfil de cliente objetivo",
      role: "SDR · SaaS B2B",
      placeholder: true,
    },
    {
      quote:
        "Aprobar cada email me daba pereza al principio. Ahora es lo que me da confianza para dejarlo funcionando.",
      author: "Perfil de cliente objetivo",
      role: "Responsable de ventas",
      placeholder: true,
    },
  ],
} as const;

// ── Preguntas frecuentes ────────────────────────────────────────────────────
// Este mismo array alimenta el JSON-LD de FAQPage: el marcado y lo visible
// deben coincidir palabra por palabra.
export const FAQ = [
  {
    question: "¿En qué se diferencia de Apollo, Instantly o Lemlist?",
    answer:
      "Esas herramientas están construidas para enviar mucho: plantillas con campos variables y volumen. Vinix hace lo contrario: investiga la web de cada empresa, escribe un email específico y, si no encuentra un motivo real para contactarla, no lo escribe. Son enfoques opuestos, no versiones del mismo producto.",
  },
  {
    question: "¿Los emails los escribe una IA? ¿No se nota?",
    answer:
      "Se nota cuando la IA no tiene nada concreto que decir. Por eso Vinix investiga primero y sólo redacta si encuentra un dato citable de esa empresa. El resultado son menos de 120 palabras que abren con algo verificable, sin clichés ni vocabulario de vendedor. Además, tú lees y apruebas cada email antes de que salga.",
  },
  {
    question: "¿Qué pasa si la investigación no encuentra nada?",
    answer:
      "El lead pasa a «revisión manual» con el motivo exacto: web sin contenido útil, requiere JavaScript, sin gancho específico. No se genera un email genérico para rellenar. Puedes añadir la URL correcta y reintentarlo, o descartar ese lead.",
  },
  {
    question: "¿Necesito una cuenta de correo especial?",
    answer:
      "Necesitas un dominio verificado en Resend, que es el proveedor de envío. La verificación son unos registros DNS y tarda minutos. Usar tu dominio real es lo que hace que los emails lleguen a la bandeja de entrada.",
  },
  {
    question: "¿Cómo protege la reputación de mi dominio?",
    answer:
      "Con un límite diario de envíos configurable por campaña que cuenta tanto los envíos manuales como los seguimientos automáticos, y con una lista de supresión global: quien pide no ser contactado queda bloqueado de forma permanente, incluso si vuelves a importar su email en otro CSV.",
  },
  {
    question: "¿Puedo probarlo sin pagar?",
    answer:
      "Sí. Al registrarte tienes 14 días con todas las funciones del plan Pro sin introducir tarjeta. Cuando termina, la cuenta pasa a Free automáticamente y conservas todos tus datos.",
  },
  {
    question: "¿Qué pasa con mis datos y los de mis leads?",
    answer:
      "Tus campañas y leads son sólo tuyos: el aislamiento entre cuentas lo impone la base de datos, no la aplicación. No vendemos ni compartimos datos, y no compramos bases de datos de contactos: los leads los aportas tú.",
  },
  {
    question: "¿Cuánto tiempo tengo que dedicarle al día?",
    answer:
      "El trabajo diario es revisar los borradores que el agente ha preparado y aprobarlos. Con 20 leads al día son unos diez minutos. La investigación, la redacción, los seguimientos y la clasificación de respuestas ocurren sin ti.",
  },
] as const;

// ── Cierre ──────────────────────────────────────────────────────────────────
export const FINAL_CTA = {
  title: "Empieza con diez leads",
  body: "Importa un CSV pequeño y mira qué escribe. Si los emails no te parecen dignos de tu firma, no has perdido nada.",
  primary: "Crear cuenta gratis",
  secondary: "Ver planes",
} as const;

export const FOOTER_LINKS = [
  {
    title: "Producto",
    links: [
      { label: "Cómo funciona", href: "/#como-funciona" },
      { label: "Diferencias", href: "/#diferencias" },
      { label: "Casos de uso", href: "/#casos" },
      { label: "Precios", href: "/precios" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { label: "Preguntas frecuentes", href: "/#faq" },
      { label: "Estado del sistema", href: "/api/health" },
    ],
  },
  {
    title: "Cuenta",
    links: [
      { label: "Iniciar sesión", href: "/login" },
      { label: "Crear cuenta", href: "/signup" },
    ],
  },
] as const;
