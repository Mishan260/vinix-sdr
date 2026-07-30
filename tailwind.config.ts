import type { Config } from "tailwindcss";

// ============================================================================
// SISTEMA DE DISEÑO — Vinix
//
// Los colores se definen como variables CSS en globals.css y aquí sólo se
// referencian. Eso permite que el modo oscuro cambie los valores sin duplicar
// una variante `dark:` por cada clase, y mantiene un único sitio donde vive
// la identidad visual.
//
// DECISIONES DE MARCA
//
// Color: petróleo profundo sobre neutros cálidos. El sector va de azul
// corporativo (Apollo) a púrpura y naranja (Instantly, Lemlist); el petróleo
// sobre piedra transmite precisión e instrumento de trabajo, no dashboard
// genérico, y se distingue a simple vista de la competencia.
//
// Escala de espaciado: múltiplos de 4 px. El espacio generoso es parte de la
// identidad: comunica que el producto no compite por meter más cosas en pantalla.
//
// Radios: 8/12/16 px. Suficiente para sentirse moderno sin caer en la estética
// de "burbuja" que envejece mal.
// ============================================================================

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Superficies, de la más baja a la más elevada
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        overlay: "rgb(var(--overlay) / <alpha-value>)",

        // Texto por jerarquía, no por color concreto
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle) / <alpha-value>)",
          inverted: "rgb(var(--ink-inverted) / <alpha-value>)",
        },

        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },

        // Acento de marca
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },

        // Estados semánticos: se nombran por significado, no por color, para
        // que un cambio de paleta no obligue a tocar cada componente.
        positive: {
          soft: "rgb(var(--positive-soft) / <alpha-value>)",
          DEFAULT: "rgb(var(--positive) / <alpha-value>)",
          strong: "rgb(var(--positive-strong) / <alpha-value>)",
        },
        caution: {
          soft: "rgb(var(--caution-soft) / <alpha-value>)",
          DEFAULT: "rgb(var(--caution) / <alpha-value>)",
          strong: "rgb(var(--caution-strong) / <alpha-value>)",
        },
        critical: {
          soft: "rgb(var(--critical-soft) / <alpha-value>)",
          DEFAULT: "rgb(var(--critical) / <alpha-value>)",
          strong: "rgb(var(--critical-strong) / <alpha-value>)",
        },
        info: {
          soft: "rgb(var(--info-soft) / <alpha-value>)",
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
        },
      },

      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      // Escala tipográfica con interlineado y tracking ya emparejados: evita
      // que cada pantalla invente su propia combinación.
      fontSize: {
        "display-lg": ["clamp(2.75rem, 6vw, 4.5rem)", { lineHeight: "1.03", letterSpacing: "-0.035em", fontWeight: "600" }],
        display: ["clamp(2.25rem, 4.5vw, 3.25rem)", { lineHeight: "1.08", letterSpacing: "-0.03em", fontWeight: "600" }],
        title: ["clamp(1.5rem, 2.5vw, 2rem)", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        heading: ["1.125rem", { lineHeight: "1.4", letterSpacing: "-0.011em", fontWeight: "600" }],
        lead: ["1.0625rem", { lineHeight: "1.65", letterSpacing: "-0.005em" }],
        micro: ["0.6875rem", { lineHeight: "1.45", letterSpacing: "0.04em" }],
      },

      borderRadius: {
        card: "0.875rem",
        panel: "1.125rem",
      },

      boxShadow: {
        // Sombras de dos capas: contorno de contacto + difusión. Una sola capa
        // se ve plana o sucia según el fondo.
        subtle: "0 1px 2px rgb(var(--shadow) / 0.06), 0 1px 3px rgb(var(--shadow) / 0.04)",
        raised: "0 1px 3px rgb(var(--shadow) / 0.08), 0 8px 24px -8px rgb(var(--shadow) / 0.12)",
        floating: "0 2px 8px rgb(var(--shadow) / 0.08), 0 16px 48px -12px rgb(var(--shadow) / 0.18)",
        glow: "0 0 0 1px rgb(var(--brand-500) / 0.18), 0 8px 32px -8px rgb(var(--brand-500) / 0.28)",
      },

      animation: {
        "fade-in": "fade-in 200ms ease-out both",
        "rise-in": "rise-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "toast-in": "toast-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up": "slide-up 520ms cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },

      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "0.9" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
