"use client";

import { useState } from "react";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AuthShell, Field, FormAlert, SubmitButton } from "@/components/auth-shell";
import { forgotPasswordSchema } from "@/lib/validation/schemas";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }

    setFieldError(undefined);
    setPending(true);

    try {
      await getBrowserClient().auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
    } catch {
      /* se ignora deliberadamente: ver comentario abajo */
    } finally {
      setPending(false);
      // Confirmación idéntica exista o no la cuenta: revelar la diferencia
      // convertiría este formulario en un oráculo de qué emails están dados
      // de alta.
      setSent(true);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Revisa tu correo"
        subtitle={`Si hay una cuenta asociada a ${email}, recibirás un enlace para restablecer la contraseña.`}
        footer={
          <Link href="/login" className="font-medium text-teal-700 hover:underline">
            Volver a iniciar sesión
          </Link>
        }
      >
        <FormAlert variant="success">El enlace caduca en 1 hora por seguridad.</FormAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recupera tu contraseña"
      subtitle="Te enviamos un enlace para elegir una nueva."
      footer={
        <Link href="/login" className="font-medium text-teal-700 hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email de tu cuenta"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
          required
        />
        <div className="mt-5">
          <SubmitButton pending={pending}>{pending ? "Enviando…" : "Enviar enlace"}</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
