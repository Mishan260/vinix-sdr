import { ImageResponse } from "next/og";
import { SITE } from "@/lib/seo";

// ============================================================================
// Imagen que se ve al compartir el enlace en LinkedIn, Slack, X o WhatsApp.
//
// Se genera en el Edge en lugar de mantener un PNG en el repositorio: así el
// texto siempre coincide con el posicionamiento actual y no hay que reexportar
// una imagen cada vez que cambia el mensaje.
// ============================================================================

export const runtime = "edge";
export const alt = SITE.tagline;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0c0e",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* Halo de marca */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 300,
            width: 700,
            height: 700,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(20,184,166,0.20) 0%, rgba(20,184,166,0) 70%)",
          }}
        />

        {/* Marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 13,
              background: "#0f766e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 700,
              color: "white",
            }}
          >
            V
          </div>
          <div style={{ fontSize: 27, fontWeight: 600, color: "#f4f4f5" }}>Vinix</div>
        </div>

        {/* Mensaje */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 600,
              color: "#f4f4f5",
              lineHeight: 1.08,
              letterSpacing: "-0.033em",
              maxWidth: 940,
            }}
          >
            El SDR que investiga
          </div>
          <div
            style={{
              fontSize: 68,
              fontWeight: 600,
              color: "#2dd4bf",
              lineHeight: 1.08,
              letterSpacing: "-0.033em",
            }}
          >
            antes de escribir
          </div>
          <div style={{ fontSize: 27, color: "#a8a6aa", marginTop: 26, maxWidth: 860, lineHeight: 1.45 }}>
            Menos emails, mejor investigados, cero inventados.
          </div>
        </div>

        {/* Pruebas */}
        <div style={{ display: "flex", gap: 44 }}>
          {[
            ["120", "palabras máximo"],
            ["0", "datos inventados"],
            ["100%", "aprobados por ti"],
          ].map(([value, label]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 38, fontWeight: 600, color: "#f4f4f5" }}>{value}</div>
              <div style={{ fontSize: 19, color: "#7c7a80", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
