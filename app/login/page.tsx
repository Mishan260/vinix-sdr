"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";
import { AuthShell, Field, FormAlert, SubmitButton } from "@/components/auth-shell";
import { signInSchema } from "@/lib/validation/schemas";

/**
 * Motivos que puede devolver /auth/callback.
 *
 * Cada mensaje dice qué pasó y qué puede hacer el usuario ahora. Un
 * «enlace inválido» a secas deja a la gente atascada sin saber si el problema
 * es suyo, del correo o del producto.
 */
const MOTIVOS_CALLBACK: Record<string, string> = {
  enlace_caducado:
    "El enlace de confirmación ha caducado. Los enlaces duran 24 horas por seguridad. Vuelve a registrarte con el mismo email y te enviaremos uno nuevo.",
  enlace_invalido:
    "Este enlace ya se ha usado o no es válido. Si ya confirmaste tu cuenta, inicia sesión normalmente abajo.",
  otro_navegador:
    "Has abierto el enlace en un navegador distinto al que usaste para registrarte. Tu cuenta está bien: inicia sesión aquí con tu email y contraseña.",
  enlace_incompleto:
    "El enlace de confirmación llegó incompleto. Suele pasar cuando el correo lo parte en dos líneas: cópialo entero en la barra de direcciones.",
  error_inesperado:
    "No hemos podido completar la verificación. Inténtalo de nuevo en unos minutos; si sigue fallando, inicia sesión y escríbenos.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const motivo = MOTIVOS_CALLBACK[params.get("motivo") ?? ""] ?? null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        next[key] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setPending(true);

    try {
      const { error } = await getBrowserClient().auth.signInWithPassword(parsed.data);

      if (error) {
        // Mensaje deliberadamente genérico: distinguir "email no existe" de
        // "contraseña incorrecta" permite enumerar cuentas registradas.
        setFormError(
          error.message.toLowerCase().includes("email not confirmed")
            ? "Confirma tu email antes de iniciar sesión. Revisa tu bandeja de entrada."
            : "Email o contraseña incorrectos."
        );
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setFormError("No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Inicia sesión"
      subtitle="Accede a tu pipeline y sigue donde lo dejaste."
      footer={
        <>
          ¿Aún no tienes cuenta?{" "}
          <Link href="/signup" className="font-medium text-teal-700 hover:underline">
            Crear cuenta
          </Link>
        </>
      }
    >
      {params.get("registered") === "1" && (
        <FormAlert variant="success">
          Cuenta creada. Confirma tu email y vuelve aquí para iniciar sesión.
        </FormAlert>
      )}
      {params.get("reset") === "1" && (
        <FormAlert variant="success">Contraseña actualizada. Ya puedes iniciar sesión.</FormAlert>
      )}

      {/* Motivos que llegan del callback de confirmación. Sin esto, un enlace
          caducado dejaba al usuario en esta pantalla sin ninguna explicación. */}
      {motivo && <FormAlert variant="error">{motivo}</FormAlert>}

      {formError && <FormAlert variant="error">{formError}</FormAlert>}

      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          required
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          required
        />

        <div className="mb-5 text-right">
          <Link href="/forgot-password" className="text-xs text-stone-500 hover:text-teal-700 hover:underline">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <SubmitButton pending={pending}>{pending ? "Entrando…" : "Entrar"}</SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
