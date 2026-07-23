"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AuthShell, Field, FormAlert, SubmitButton } from "@/components/auth-shell";
import { signUpSchema } from "@/lib/validation/schemas";
import { TRIAL_DAYS } from "@/lib/billing/plans";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pending, setPending] = useState(false);

  // Validación en tiempo real: sólo tras el primer intento fallido, para no
  // gritarle al usuario mientras aún está escribiendo el primer carácter.
  function revalidate(next: { email?: string; password?: string }) {
    if (Object.keys(fieldErrors).length === 0) return;
    const parsed = signUpSchema.safeParse({ email: next.email ?? email, password: next.password ?? password });
    if (parsed.success) {
      setFieldErrors({});
      return;
    }
    const errs: { email?: string; password?: string } = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "email" | "password";
      errs[key] ??= issue.message;
    }
    setFieldErrors(errs);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const parsed = signUpSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        errs[key] ??= issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setPending(true);

    try {
      const { data, error } = await getBrowserClient().auth.signUp({
        ...parsed.data,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });

      if (error) {
        setFormError(
          error.message.toLowerCase().includes("already registered")
            ? "Ya existe una cuenta con este email. Inicia sesión o recupera tu contraseña."
            : "No se pudo crear la cuenta. Inténtalo de nuevo en unos minutos."
        );
        return;
      }

      // Si el proyecto exige confirmación por email, no hay sesión todavía
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setNeedsConfirmation(true);
      }
    } catch {
      setFormError("No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  if (needsConfirmation) {
    return (
      <AuthShell
        title="Confirma tu email"
        subtitle={`Hemos enviado un enlace a ${email}. Ábrelo para activar tu cuenta.`}
        footer={
          <Link href="/login" className="font-medium text-teal-700 hover:underline">
            Volver a iniciar sesión
          </Link>
        }
      >
        <FormAlert variant="success">
          Si no lo ves en unos minutos, revisa la carpeta de spam.
        </FormAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crea tu cuenta"
      subtitle={`${TRIAL_DAYS} días de plan Pro incluidos. Sin tarjeta para empezar.`}
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-teal-700 hover:underline">
            Iniciar sesión
          </Link>
        </>
      }
    >
      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email de trabajo"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            revalidate({ email: e.target.value });
          }}
          error={fieldErrors.email}
          required
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            revalidate({ password: e.target.value });
          }}
          error={fieldErrors.password}
          hint="Mínimo 8 caracteres."
          required
        />

        <div className="mt-5">
          <SubmitButton pending={pending}>{pending ? "Creando cuenta…" : "Crear cuenta"}</SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
