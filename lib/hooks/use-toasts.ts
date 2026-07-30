"use client";

// ============================================================================
// Hook de notificaciones. Extraído del dashboard para que /pricing y cualquier
// pantalla futura compartan el mismo comportamiento (apilado, autocierre,
// límite de 4 visibles) en lugar de reimplementarlo.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastItem, ToastVariant } from "@/components/ui";

const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 4;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = ++nextId.current;
      setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, variant, message }]);

      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  // Sin esto, desmontar la pantalla con toasts vivos deja timers que intentan
  // actualizar estado de un componente que ya no existe.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return { toasts, notify, dismiss };
}
