import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vinix SDR",
  description: "Agente autónomo de prospección y ventas B2B",
};

export const viewport: Viewport = {
  themeColor: "#fafaf9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
