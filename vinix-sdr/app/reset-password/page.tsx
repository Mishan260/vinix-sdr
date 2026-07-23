"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AuthShell, Field, FormAlert, SubmitButton } from "@/components/auth-shell";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { Skeleton } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // La sesión de recuperación llega por el hash de la URL y el SDK la procesa
  // de forma asíncrona: hasta entonces no sabemos si el enlace es válido.
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const parsed = resetPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setFieldErrors({ password: parsed.error.issues[0]?.message });
      return;
    }
    if (password !== confirm) {
      setFieldErrors({ confirm: "Las contraseñas no coinciden" });
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setPending(true);

    try {
      const { error } = await getBrowserClient().auth.updateUser({ password: parsed.data.password });
      if (error) {
        setFormError("No se pudo actualizar la contraseña. Pide un enlace nuevo e inténtalo otra vez.");
        return;
      }
      await getBrowserClient().auth.signOut();
      router.push("/login?reset=1");
    } catch {
      setFormError("No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  if (checking) {
    return (
      <AuthShell title="Nueva contraseña" subtitle="Comprobando el enlace…">
        <Skeleton className="mb-3 h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell
        title="Enlace no válido"
        subtitle="Este enlace ha caducado o ya se usó."
        footer={
          <a href="/forgot-password" className="font-medium text-teal-700 hover:underline">
            Pedir un enlace nuevo
          </a>
        }
      >
        <FormAlert variant="error">Los enlaces de recuperación caducan a la hora de enviarse.</FormAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Elige una contraseña nueva" subtitle="Se cerrará la sesión para que entres con ella.">
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Nueva contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="Mínimo 8 caracteres."
          required
        />
        <Field
          label="Repite la contraseña"
          name="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
          required
        />
        <div className="mt-5">
          <SubmitButton pending={pending}>{pending ? "Guardando…" : "Guardar contraseña"}</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
