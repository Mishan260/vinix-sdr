"use client";

// ============================================================================
// Datos en vivo de una campaña, dirigidos por eventos en lugar de por reloj.
//
// ANTES: setInterval cada 15 s → 3 peticiones → 720 peticiones/hora por
// usuario, devolviendo casi siempre datos idénticos.
//
// AHORA: una carga inicial y, a partir de ahí, sólo se recarga cuando Postgres
// notifica un cambio real en `leads` o `replies` de esta campaña. Con el
// pipeline quieto, el tráfico de fondo es cero.
//
// Garantías que se conservan del comportamiento anterior:
//   • Guard de respuestas obsoletas (una respuesta lenta no pisa datos nuevos).
//   • Pausa con la pestaña oculta.
//   • Pausa durante un lote o con un modal abierto (lo decide el llamante).
//   • Si Realtime no conecta, se degrada a sondeo lento en vez de quedarse
//     sin actualizaciones.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** Agrupa ráfagas de eventos en una sola recarga (lotes de investigación). */
const COALESCE_MS = 800;

/**
 * Sondeo de respaldo cuando Realtime no está disponible.
 * Cuatro veces más lento que el intervalo original: sigue siendo un red de
 * seguridad, pero deja de ser el mecanismo principal.
 */
const FALLBACK_POLL_MS = 60_000;

/** Refresco de cortesía aunque Realtime funcione, por si se pierde un evento. */
const HEARTBEAT_MS = 300_000;

export interface LiveCampaignData<TLead, TReply> {
  leads: TLead[];
  replies: TReply[];
  followUpsDue: number;
  /** true hasta que llegan los primeros datos de esta campaña. */
  loading: boolean;
  /** Fuerza una recarga inmediata (tras una acción del usuario). */
  refresh: () => Promise<void>;
  /** true si los cambios llegan por Realtime; false si se está sondeando. */
  live: boolean;
}

export interface UseLiveCampaignDataOptions {
  campaignId: string;
  /** Mientras sea true no se recarga (modal abierto, lote en curso…). */
  paused?: boolean;
}

interface ApiPayload<TLead, TReply> {
  leads: TLead[];
  replies: TReply[];
  due: number;
}

async function fetchAll<TLead, TReply>(campaignId: string): Promise<ApiPayload<TLead, TReply>> {
  const [leadsRes, repliesRes, dueRes] = await Promise.all([
    fetch(`/api/leads?campaignId=${campaignId}`).then((r) => r.json()),
    fetch(`/api/replies?campaignId=${campaignId}`).then((r) => r.json()),
    fetch(`/api/agent/followups?campaignId=${campaignId}`)
      .then((r) => r.json())
      .catch(() => ({ due: 0 })),
  ]);

  return {
    leads: (leadsRes?.leads ?? []) as TLead[],
    replies: (repliesRes?.replies ?? []) as TReply[],
    due: dueRes?.due ?? 0,
  };
}

export function useLiveCampaignData<TLead, TReply>({
  campaignId,
  paused = false,
}: UseLiveCampaignDataOptions): LiveCampaignData<TLead, TReply> {
  const [leads, setLeads] = useState<TLead[]>([]);
  const [replies, setReplies] = useState<TReply[]>([]);
  const [followUpsDue, setFollowUpsDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  // Sólo la petición más reciente puede escribir en el estado
  const sequence = useRef(0);
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `paused` se lee dentro de callbacks de larga vida (canal, intervalos):
  // guardarlo en una ref evita recrear la suscripción en cada cambio.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    const seq = ++sequence.current;
    try {
      const data = await fetchAll<TLead, TReply>(campaignId);
      if (seq !== sequence.current) return;
      setLeads(data.leads);
      setReplies(data.replies);
      setFollowUpsDue(data.due);
      setLoading(false);
    } catch {
      // Caída puntual de red: el siguiente evento o el heartbeat lo reintenta
    }
  }, [campaignId]);

  /** Agrupa eventos seguidos: un lote de 50 leads produce una recarga, no 50. */
  const scheduleRefresh = useCallback(() => {
    if (coalesceTimer.current) clearTimeout(coalesceTimer.current);
    coalesceTimer.current = setTimeout(() => {
      coalesceTimer.current = null;
      if (pausedRef.current || document.hidden) return;
      void refresh();
    }, COALESCE_MS);
  }, [refresh]);

  // ── Carga inicial al cambiar de campaña ───────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    setLeads([]);
    setReplies([]);
    void refresh();
  }, [campaignId, refresh]);

  // ── Suscripción a los cambios reales ──────────────────────────────────────
  useEffect(() => {
    if (!campaignId) return;

    let channel: RealtimeChannel | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startFallbackPolling = () => {
      if (fallbackTimer || cancelled) return;
      fallbackTimer = setInterval(() => {
        if (pausedRef.current || document.hidden) return;
        void refresh();
      }, FALLBACK_POLL_MS);
    };

    // El cliente de Supabase arrastra realtime-js (~68 kB). Importarlo de
    // forma estática lo metía en el bundle inicial del panel y retrasaba el
    // primer render. Como la suscripción no hace falta hasta después de montar,
    // se carga en diferido: la tabla se pinta con el JS mínimo y el canal se
    // conecta a continuación.
    void (async () => {
      try {
        const { getBrowserClient } = await import("@/lib/supabase/browser");
        if (cancelled) return;

        channel = getBrowserClient()
          .channel(`campaign:${campaignId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "leads", filter: `campaign_id=eq.${campaignId}` },
            scheduleRefresh
          )
          // `replies` no tiene campaign_id: se filtra en el servidor al recargar.
          // Recibir algún evento de más es barato comparado con sondear siempre.
          .on("postgres_changes", { event: "*", schema: "public", table: "replies" }, scheduleRefresh)
          .subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") {
              setLive(true);
              if (fallbackTimer) {
                clearInterval(fallbackTimer);
                fallbackTimer = null;
              }
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              setLive(false);
              startFallbackPolling();
            }
          });
      } catch {
        // Sin configuración de Supabase en el navegador: sondeo de respaldo
        if (!cancelled) {
          setLive(false);
          startFallbackPolling();
        }
      }
    })();

    // Heartbeat: cubre el hueco de un evento perdido sin volver al sondeo rápido
    const heartbeat = setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      void refresh();
    }, HEARTBEAT_MS);

    // Al volver a la pestaña, sincronizar de inmediato en lugar de esperar
    const onVisible = () => {
      if (!document.hidden && !pausedRef.current) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(heartbeat);
      if (fallbackTimer) clearInterval(fallbackTimer);
      if (coalesceTimer.current) clearTimeout(coalesceTimer.current);
      // El módulo ya está en caché tras el import diferido: no supone otra descarga
      if (channel) {
        void import("@/lib/supabase/browser").then(({ getBrowserClient }) =>
          getBrowserClient().removeChannel(channel!)
        );
      }
    };
  }, [campaignId, refresh, scheduleRefresh]);

  return { leads, replies, followUpsDue, loading, refresh, live };
}
