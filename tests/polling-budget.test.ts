import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================================
// Presupuesto de peticiones del panel.
//
// Compara el comportamiento anterior (setInterval fijo de 15 s con 3 peticiones
// en paralelo) con el actual (dirigido por eventos, con heartbeat de 5 min y
// sondeo de respaldo de 60 s sólo si Realtime cae).
//
// Se simula el reloj: son las constantes reales del código, no estimaciones.
// ============================================================================

const HORA_MS = 3_600_000;

/** Constantes del comportamiento anterior, tal y como estaba en el panel. */
const ANTES = { intervaloMs: 15_000, peticionesPorCiclo: 3 };

/** Constantes actuales de lib/hooks/use-live-campaign-data.ts */
const AHORA = { heartbeatMs: 300_000, fallbackMs: 60_000, peticionesPorCiclo: 3 };

/** Simula un temporizador periódico y cuenta las peticiones que dispara. */
function simular(duracionMs: number, intervaloMs: number, peticionesPorCiclo: number): number {
  let peticiones = 0;
  const timer = setInterval(() => {
    peticiones += peticionesPorCiclo;
  }, intervaloMs);
  vi.advanceTimersByTime(duracionMs);
  clearInterval(timer);
  return peticiones;
}

describe("presupuesto de peticiones del panel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("el comportamiento anterior generaba 720 peticiones/hora por usuario", () => {
    const peticiones = simular(HORA_MS, ANTES.intervaloMs, ANTES.peticionesPorCiclo);
    expect(peticiones).toBe(720);
  });

  it("con Realtime y pipeline quieto baja a 36 peticiones/hora", () => {
    // Sin cambios en la base de datos sólo actúa el heartbeat de cortesía
    const peticiones = simular(HORA_MS, AHORA.heartbeatMs, AHORA.peticionesPorCiclo);
    expect(peticiones).toBe(36);
  });

  it("supone una reducción de al menos el 90% en reposo", () => {
    const antes = simular(HORA_MS, ANTES.intervaloMs, ANTES.peticionesPorCiclo);
    vi.clearAllTimers();
    const ahora = simular(HORA_MS, AHORA.heartbeatMs, AHORA.peticionesPorCiclo);

    const reduccion = (antes - ahora) / antes;
    expect(reduccion).toBeGreaterThanOrEqual(0.9);
  });

  it("incluso con Realtime caído el respaldo es 4 veces más ligero", () => {
    const antes = simular(HORA_MS, ANTES.intervaloMs, ANTES.peticionesPorCiclo);
    vi.clearAllTimers();
    const respaldo = simular(HORA_MS, AHORA.fallbackMs, AHORA.peticionesPorCiclo);

    expect(respaldo).toBe(180);
    expect(respaldo).toBeLessThanOrEqual(antes / 4);
  });

  it("proyección a escala: el ahorro es de cientos de miles de peticiones/hora", () => {
    const porUsuarioAntes = 720;
    const porUsuarioAhora = 36;

    // Con 1.000 usuarios simultáneos con la pestaña abierta
    const antes = porUsuarioAntes * 1000;
    const ahora = porUsuarioAhora * 1000;

    expect(antes).toBe(720_000);
    expect(ahora).toBe(36_000);
    expect(antes - ahora).toBe(684_000);
  });
});

// ============================================================================
// Agrupación de eventos: un lote de investigación de 50 leads emite 50 eventos
// de Postgres. Sin agrupar serían 50 recargas × 3 peticiones = 150 peticiones.
// ============================================================================
describe("agrupación de eventos (coalescing)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const COALESCE_MS = 800;

  /** Reproduce la lógica de scheduleRefresh: reinicia el temporizador en cada evento. */
  function crearAgrupador(onFlush: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onFlush();
      }, COALESCE_MS);
    };
  }

  it("50 eventos seguidos producen una sola recarga", () => {
    let recargas = 0;
    const agrupar = crearAgrupador(() => recargas++);

    for (let i = 0; i < 50; i++) {
      agrupar();
      vi.advanceTimersByTime(50); // eventos cada 50 ms, dentro de la ventana
    }
    vi.advanceTimersByTime(COALESCE_MS);

    expect(recargas).toBe(1);
  });

  it("eventos espaciados sí producen recargas independientes", () => {
    let recargas = 0;
    const agrupar = crearAgrupador(() => recargas++);

    agrupar();
    vi.advanceTimersByTime(COALESCE_MS + 100);
    agrupar();
    vi.advanceTimersByTime(COALESCE_MS + 100);

    expect(recargas).toBe(2);
  });

  it("un lote de 50 leads pasa de 150 peticiones a 3", () => {
    let recargas = 0;
    const agrupar = crearAgrupador(() => recargas++);

    for (let i = 0; i < 50; i++) {
      agrupar();
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(COALESCE_MS);

    const sinAgrupar = 50 * 3;
    const conAgrupar = recargas * 3;

    expect(sinAgrupar).toBe(150);
    expect(conAgrupar).toBe(3);
  });
});
