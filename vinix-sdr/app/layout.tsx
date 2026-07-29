import type { Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeScript } from "@/components/theme";
import { pageMetadata } from "@/lib/seo";

// next/font descarga y auto-hospeda las fuentes en el build: sin petición a
// Google en runtime (mejor privacidad y un salto de red menos), con subsetting
// y `font-display: swap` ya aplicados. Antes se usaba la pila del sistema, lo
// que daba tipografías distintas en Windows, macOS y Linux.
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  // Ajusta métricas de la fuente de respaldo para que el swap no mueva el texto
  adjustFontFallback: true,
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata = pageMetadata();

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Se ejecuta antes del primer pintado: sin esto el modo oscuro
            aparecería tras un destello blanco. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-canvas font-sans text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
