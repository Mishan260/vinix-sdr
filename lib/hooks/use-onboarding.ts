"use client";

// ============================================================================
// Estado del onboarding dentro del panel.
//
// Encapsula la carga, el descarte de consejos y la gestión de la campaña de
// ejemplo, para que el componente del panel no crezca con otra media docena
// de estados sueltos.
//
// Si la API falla (por ejemplo, migración sin aplicar) el hook devuelve estado
// vacío en silencio: el onboarding es una ayuda y jamás debe impedir usar el
// producto.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import type { OnboardingSnapshot, Task, TipId } from "@/lib/onboarding/steps";

interface OnboardingState {
  snapshot: OnboardingSnapshot | null;
  tasks: Task[];
  progress: { done: number; total: number; percent: number };
  complete: boolean;
}

const INITIAL: OnboardingState = {
  snapshot: null,
  tasks: [],
  progress: { done: 0, total: 0, percent: 0 },
  complete: true,
};

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding");
      if (!res.ok) return;
      const data = await res.json();
      setState({
        snapshot: data.snapshot,
        tasks: data.tasks ?? [],
        progress: data.progress ?? INITIAL.progress,
        complete: Boolean(data.complete),
      });
    } catch {
      // Sin onboarding disponible el panel funciona igual
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      const data = await res.json();
      setState({
        snapshot: data.snapshot,
        tasks: data.tasks ?? [],
        progress: data.progress ?? INITIAL.progress,
        complete: Boolean(data.complete),
      });
    } catch {
      /* silencioso: es estado de ayuda, no de negocio */
    }
  }, []);

  /** Oculta la lista de tareas de forma permanente. */
  const dismissChecklist = useCallback(() => {
    setHidden(true);
    void post({ dismiss: true, event: "onboarding_dismissed" });
  }, [post]);

  /** Descarta un consejo contextual para que no vuelva a aparecer. */
  const dismissTip = useCallback(
    (tip: TipId) => {
      // Actualización optimista: el consejo desaparece al instante
      setState((s) =>
        s.snapshot
          ? { ...s, snapshot: { ...s.snapshot, dismissedTips: [...s.snapshot.dismissedTips, tip] } }
          : s
      );
      void post({ dismissTip: tip });
    },
    [post]
  );

  const isTipDismissed = useCallback(
    (tip: TipId) => state.snapshot?.dismissedTips.includes(tip) ?? true,
    [state.snapshot]
  );

  const createDemo = useCallback(async (): Promise<string | null> => {
    setDemoBusy(true);
    try {
      const res = await fetch("/api/onboarding/demo", { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      await refresh();
      return data.campaignId ?? null;
    } catch {
      return null;
    } finally {
      setDemoBusy(false);
    }
  }, [refresh]);

  const removeDemo = useCallback(async (): Promise<boolean> => {
    setDemoBusy(true);
    try {
      const res = await fetch("/api/onboarding/demo", { method: "DELETE" });
      if (!res.ok) return false;
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      setDemoBusy(false);
    }
  }, [refresh]);

  // Se muestra mientras quede algo pendiente y el usuario no la haya cerrado
  const showChecklist =
    !loading &&
    !hidden &&
    state.tasks.length > 0 &&
    !state.snapshot?.dismissedAt &&
    state.progress.done < state.progress.total;

  return {
    ...state,
    loading,
    showChecklist,
    demoBusy,
    refresh,
    dismissChecklist,
    dismissTip,
    isTipDismissed,
    createDemo,
    removeDemo,
  };
}
