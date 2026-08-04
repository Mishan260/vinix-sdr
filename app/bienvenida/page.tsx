"use client";

// ============================================================================
// Recorrido guiado inicial.
//
// Cuatro pantallas, dos campos, un resultado real. El objetivo no es enseñar
// la aplicación: es que el usuario vea a Vinix leer una empresa de verdad y
// escribir un email que merezca su firma.
//
// PERSISTENCIA: el paso activo se deriva del estado del servidor, no de la URL
// ni de un estado local. Quien cierra la pestaña a mitad y vuelve mañana
// aterriza exactamente donde lo dejó.
// ============================================================================

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ButtonLink, Logo } from "@/components/brand";
import { Spinner, ToastStack } from "@/components/ui";
import { useToasts } from "@/lib/hooks/use-toasts";
import { GUIDED_STEPS, SUGGESTED_COMPANIES, type GuidedStep } from "@/lib/onboarding/steps";
import { PROFILE_QUESTIONS } from "@/lib/onboarding/profile";

/** Respuesta de POST /api/onboarding: el estado ya recalculado. */
interface ProgressResponse {
  snapshot: {
    welcomedAt: string | null;
    dismissedAt: string | null;
    valueProposition: string | null;
    targetAudience: string | null;
    mainProduct: string | null;
  } | null;
}

interface TryResult {
  outcome: "drafted" | "no_hook";
  campaignId: string;
  leadId: string;
  companyName: string;
  reason?: string;
  research?: {
    sector: string | null;
    size: string | null;
    painPoint: string | null;
    decisionMaker: string | null;
  };
  draft?: { subject: string; body: string; wordCount: number };
}

function GuideContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { toasts, notify, dismiss } = useToasts();

  const [step, setStep] = useState<GuidedStep>("welcome");
  const [loadingState, setLoadingState] = useState(true);
  /** Evita dobles pulsaciones en «Saltar» / «Ir a mi panel». */
  const [leaving, setLeaving] = useState(false);

  /** Llega desde /auth/callback tras confirmar el email. */
  const verificado = params.get("verificado") === "1";

  // Perfil de empresa: las tres cosas que el agente no puede deducir solo
  const [profile, setProfile] = useState<CompanyProfileForm>({
    valueProposition: "",
    targetAudience: "",
    mainProduct: "",
  });
  const [offerError, setOfferError] = useState<string | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);

  const [companyUrl, setCompanyUrl] = useState("");
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);

  // Empresa que el usuario pidió investigar antes de que le pidiéramos el
  // perfil. Se guarda para reanudar automáticamente y no perder su trabajo.
  const [pendingCompany, setPendingCompany] = useState<string | null>(null);

  // Instante en que arrancó el recorrido: permite medir cuánto tarda cada paso
  const startedAt = useRef(new Date().toISOString());

  /** Último mensaje de error del servidor, para mostrarlo en vez de uno genérico. */
  const lastPostError = useRef<string | null>(null);

  /**
   * El perfil se acaba de guardar y estamos reanudando la investigación.
   * Si aun así el servidor lo vuelve a pedir, hay una inconsistencia real y
   * repetir la pantalla sería el bucle que veía el usuario.
   */
  const profileJustSaved = useRef(false);

  /**
   * Guarda progreso y devuelve el estado recalculado por el servidor.
   *
   * Devuelve `null` si la escritura no llegó a la base de datos. Antes se
   * descartaba también el mensaje del servidor, así que el usuario sólo veía
   * que la pantalla no avanzaba, sin ninguna pista de por qué.
   */
  const post = useCallback(async (payload: Record<string, unknown>): Promise<ProgressResponse | null> => {
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        lastPostError.current = typeof data?.error === "string" ? data.error : null;
        return null;
      }
      lastPostError.current = null;
      return data as ProgressResponse;
    } catch {
      lastPostError.current = null;
      return null;
    }
  }, []);

  // ── Estado inicial: retomar donde se dejó ─────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/onboarding");
        if (!res.ok) {
          // Sin onboarding disponible el producto sigue siendo usable: se
          // envía al panel en lugar de bloquear con un error.
          router.replace("/dashboard");
          return;
        }
        const data = await res.json();

        // Si ya respondió antes, se rellena y no se vuelve a preguntar
        setProfile({
          valueProposition: data.snapshot?.valueProposition ?? "",
          targetAudience: data.snapshot?.targetAudience ?? "",
          mainProduct: data.snapshot?.mainProduct ?? "",
        });

        // El parámetro de la URL sólo puede adelantar a un paso ya alcanzable
        const requested = params.get("paso") as GuidedStep | null;
        const allowed = GUIDED_STEPS.indexOf(data.resumeAt as GuidedStep);
        const wanted = requested ? GUIDED_STEPS.indexOf(requested) : -1;
        setStep(wanted >= 0 && wanted <= allowed ? (requested as GuidedStep) : (data.resumeAt as GuidedStep));
      } catch {
        router.replace("/dashboard");
      } finally {
        setLoadingState(false);
      }
    })();
  }, [params, router]);

  // ── Paso 1 → 2 ────────────────────────────────────────────────────────────
  async function startGuide() {
    setStep("offer");
    void post({ markWelcomed: true, event: "welcome_viewed", startedAt: startedAt.current });
  }

  // ── Paso 2: perfil de empresa ─────────────────────────────────────────────
  async function submitProfile() {
    const oferta = profile.valueProposition.trim();

    if (oferta.length < 15) {
      setOfferError(
        "Necesitamos un poco más de detalle en la primera pregunta. Describe qué vendes y con qué resultado concreto: es lo que el agente usará para conectar tu oferta con el dolor de cada empresa."
      );
      return;
    }

    setOfferError(null);
    setSavingOffer(true);
    try {
      const data = await post({
        valueProposition: oferta,
        targetAudience: profile.targetAudience.trim(),
        mainProduct: profile.mainProduct.trim(),
        event: "offer_submitted",
        startedAt: startedAt.current,
      });

      if (!data) {
        setOfferError(
          lastPostError.current ??
            "No hemos podido guardar tus respuestas. Comprueba tu conexión e inténtalo de nuevo; no se ha perdido lo que has escrito."
        );
        return;
      }

      // No basta con que el servidor responda 200: hay que comprobar que la
      // oferta está REALMENTE en la base de datos antes de avanzar. Avanzar a
      // ciegas era lo que producía el bucle: el paso siguiente releía el
      // estado, no encontraba nada y devolvía a esta misma pantalla.
      if (!data.snapshot?.valueProposition?.trim()) {
        setOfferError(
          "El servidor ha aceptado tus respuestas pero no las ha guardado. Vuelve a pulsar «Continuar»; " +
            "lo que has escrito sigue aquí. Si se repite, es un problema de la base de datos y no de lo que has puesto."
        );
        return;
      }

      // Si llegó aquí porque pidió investigar una empresa antes de tener
      // perfil, se reanuda esa investigación sola. Su trabajo no se pierde.
      if (pendingCompany) {
        const url = pendingCompany;
        setPendingCompany(null);
        setCompanyUrl(url);
        setStep("company");
        profileJustSaved.current = true;
        await runResearch(url);
        return;
      }

      setStep("company");
    } finally {
      setSavingOffer(false);
    }
  }

  // ── Paso 3: investigar una empresa ────────────────────────────────────────
  async function runResearch(url: string) {
    const target = url.trim();
    if (!target) {
      setCompanyError("Escribe la web de una empresa, por ejemplo: stripe.com");
      return;
    }

    setCompanyError(null);
    setResearching(true);
    try {
      const res = await fetch("/api/onboarding/try", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyUrl: target, startedAt: startedAt.current }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCompanyError(
          data?.error ??
            "No se pudo completar la investigación. Prueba con otra empresa o inténtalo de nuevo en un momento."
        );
        return;
      }

      // Falta el perfil: no es un fallo. Se guarda la empresa que pidió y se
      // le llevan las preguntas; al responder, la investigación se reanuda sola.
      if (data.outcome === "needs_profile") {
        // Si ya venimos de contestar el perfil, volver a pedirlo sería el bucle
        // otra vez. Se para aquí y se dice la verdad en lugar de repetir la
        // misma pantalla indefinidamente.
        if (profileJustSaved.current) {
          profileJustSaved.current = false;
          setCompanyError(
            "Has respondido el perfil pero el servidor sigue sin encontrarlo. Recarga la página: " +
              "si tras recargar tus respuestas siguen ahí, vuelve a pulsar «Investigar»."
          );
          return;
        }
        setPendingCompany(data.pendingCompanyUrl ?? target);
        setStep("offer");
        return;
      }

      profileJustSaved.current = false;
      setResult(data as TryResult);
      setStep("result");
      void post({ event: "draft_viewed", startedAt: startedAt.current });
    } catch {
      setCompanyError(
        "No hemos podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo; no se ha perdido nada de lo que llevas hecho."
      );
    } finally {
      setResearching(false);
    }
  }

  // ── Cierre ────────────────────────────────────────────────────────────────
  async function finish() {
    if (leaving) return;
    setLeaving(true);
    await post({ complete: true, event: "onboarding_completed", startedAt: startedAt.current });
    // Aquí sí se sale pase lo que pase: el usuario ya ha visto el resultado y
    // no perder la marca de «completado» justifica retenerle.
    router.push("/dashboard");
  }

  /**
   * Abandonar el recorrido.
   *
   * Hay que ESPERAR a que `dismissed_at` quede escrito antes de navegar. El
   * panel reenvía aquí a quien no lo ha descartado, así que salir sin haberlo
   * guardado devolvía al usuario a esta misma pantalla: parecía que el botón
   * «Saltar» no hacía nada.
   */
  async function skip() {
    if (leaving) return;
    setLeaving(true);

    const data = await post({ dismiss: true, event: "onboarding_dismissed", startedAt: startedAt.current });

    if (!data?.snapshot?.dismissedAt) {
      setLeaving(false);
      notify(
        "error",
        lastPostError.current ??
          "No hemos podido guardar que quieres saltarte el recorrido, así que el panel te traería de vuelta aquí. Inténtalo otra vez."
      );
      return;
    }

    router.push("/dashboard");
  }

  if (loadingState) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-ink-subtle" />
        <span className="sr-only">Cargando tu progreso</span>
      </div>
    );
  }

  const stepIndex = GUIDED_STEPS.indexOf(step);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Cabecera con progreso */}
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 py-4 sm:px-8">
          <Logo className="h-7 w-7" />

          <ol className="ml-2 flex flex-1 items-center gap-2" aria-label="Progreso del recorrido">
            {GUIDED_STEPS.map((s, i) => (
              <li key={s} className="flex flex-1 items-center gap-2">
                <span
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                    i <= stepIndex ? "bg-brand-500" : "bg-line"
                  }`}
                />
              </li>
            ))}
          </ol>

          <span className="text-xs tabular-nums text-ink-subtle" aria-live="polite">
            {stepIndex + 1} de {GUIDED_STEPS.length}
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-2xl">
          {/* Confirmación de la cuenta recién verificada. Antes el usuario
              volvía del email sin ninguna señal de que hubiera funcionado. */}
          {verificado && (
            <div
              role="status"
              className="animate-rise-in mb-8 flex items-start gap-3 rounded-card border border-positive/30 bg-positive-soft px-4 py-3.5"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-positive/20 text-positive-strong">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-medium text-ink">Cuenta verificada correctamente</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  Ya puedes empezar a utilizar Vinix.
                </p>
              </div>
            </div>
          )}

          {step === "welcome" && <WelcomeStep onStart={startGuide} onSkip={skip} leaving={leaving} />}

          {step === "offer" && (
            <ProfileStep
              profile={profile}
              onChange={setProfile}
              error={offerError}
              pending={savingOffer}
              pendingCompany={pendingCompany}
              onSubmit={submitProfile}
              onSkip={skip}
              leaving={leaving}
            />
          )}

          {step === "company" && (
            <CompanyStep
              value={companyUrl}
              onChange={setCompanyUrl}
              error={companyError}
              pending={researching}
              onSubmit={() => runResearch(companyUrl)}
              onPick={(url) => {
                setCompanyUrl(url);
                void runResearch(url);
              }}
              onSkip={skip}
              leaving={leaving}
            />
          )}

          {step === "result" && result && (
            <ResultStep result={result} onFinish={finish} leaving={leaving} />
          )}

          {step === "result" && !result && (
            <ResumedStep onFinish={finish} onRetry={() => setStep("company")} leaving={leaving} />
          )}
        </div>
      </main>

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      {/* Anuncio para lectores de pantalla: la espera larga debe ser audible */}
      <span className="sr-only" role="status" aria-live="polite">
        {researching ? "Investigando la empresa. Esto tarda entre 10 y 30 segundos." : ""}
      </span>
    </div>
  );
}

/**
 * Botón de abandono, idéntico en las tres pantallas.
 *
 * Se deshabilita mientras se guarda: descartar el recorrido es una escritura en
 * la base de datos, y sin esta señal el botón parecía roto durante el viaje de
 * ida y vuelta al servidor.
 */
function SkipButton({ onSkip, leaving }: { onSkip: () => void; leaving: boolean }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      disabled={leaving}
      className="text-xs text-ink-subtle underline-offset-4 transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
    >
      {leaving ? "Saliendo…" : "Saltar"}
    </button>
  );
}

// ── Paso 1: bienvenida ──────────────────────────────────────────────────────
function WelcomeStep({
  onStart,
  onSkip,
  leaving,
}: {
  onStart: () => void;
  onSkip: () => void;
  leaving: boolean;
}) {
  return (
    <div className="animate-rise-in text-center">
      <h1 className="text-display text-balance">
        <span className="text-ink">No vas a enviar más emails.</span>
        <br />
        <span className="text-gradient">Vas a enviar muchos menos, y mejores.</span>
      </h1>

      <p className="mx-auto mt-6 max-w-xl text-lead text-pretty text-ink-muted">
        Vinix lee la web de cada empresa antes de escribir. Si encuentra un motivo real para
        contactarla, redacta un email de menos de 120 palabras. Si no lo encuentra, te lo dice en
        lugar de rellenar el hueco con un halago genérico.
      </p>

      <div className="mx-auto mt-10 grid max-w-lg gap-3 text-left">
        {[
          "Vas a contarnos qué vendes",
          "Vas a elegir una empresa cualquiera",
          "Vas a ver el email que Vinix escribiría",
        ].map((text, i) => (
          <div key={text} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 font-mono text-xs font-medium text-brand-700 dark:text-brand-400">
              {i + 1}
            </span>
            <span className="text-sm text-ink">{text}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-ink-subtle">Dos minutos. Sin configurar nada.</p>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button size="lg" onClick={onStart} className="w-full sm:w-auto">
          Empezar
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Button>
        <button
          type="button"
          onClick={onSkip}
          disabled={leaving}
          className="text-xs text-ink-subtle underline-offset-4 transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
        >
          {leaving ? "Saliendo…" : "Prefiero explorar por mi cuenta"}
        </button>
      </div>
    </div>
  );
}

// ── Paso 2: perfil de empresa ───────────────────────────────────────────────
const OFFER_EXAMPLES = [
  "Llenamos el calendario de discovery calls de agencias de marketing; 5-10 reuniones cualificadas al mes.",
  "Auditamos la infraestructura cloud de startups y les recortamos entre un 30% y un 50% la factura de AWS.",
  "Formamos a equipos de soporte para que resuelvan el 40% más de tickets sin ampliar plantilla.",
];

interface CompanyProfileForm {
  valueProposition: string;
  targetAudience: string;
  mainProduct: string;
}

function ProfileStep({
  profile,
  onChange,
  error,
  pending,
  pendingCompany,
  onSubmit,
  onSkip,
  leaving,
}: {
  profile: CompanyProfileForm;
  onChange: (p: CompanyProfileForm) => void;
  error: string | null;
  pending: boolean;
  /** Empresa que el usuario ya pidió investigar; se reanudará al guardar. */
  pendingCompany: string | null;
  onSubmit: () => void;
  onSkip: () => void;
  leaving: boolean;
}) {
  const set = (campo: keyof CompanyProfileForm) => (valor: string) =>
    onChange({ ...profile, [campo]: valor });

  return (
    <div className="animate-rise-in">
      {/* Si viene de pedir una investigación, se explica por qué se le
          interrumpe y se le promete continuar donde estaba. */}
      {pendingCompany && (
        <div className="mb-6 flex items-start gap-3 rounded-card border border-brand-500/25 bg-brand-500/[0.06] px-4 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-400">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </span>
          <p className="text-xs leading-relaxed text-ink-muted">
            Antes de investigar <strong className="font-medium text-ink">{pendingCompany}</strong>{" "}
            necesitamos conocer tu oferta. En cuanto respondas seguimos por donde ibas,
            automáticamente.
          </p>
        </div>
      )}

      <h1 className="text-title text-balance text-ink">Cuéntanos de tu empresa</h1>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Son las tres cosas que el agente no puede averiguar leyendo webs ajenas. Te lo preguntamos
        una vez y no volvemos a hacerlo.
      </p>

      <div className="mt-7 space-y-6">
        {PROFILE_QUESTIONS.map((question, index) => {
          const campo = question.id as keyof CompanyProfileForm;
          const esPrimera = index === 0;
          const errorAqui = esPrimera ? error : null;

          return (
            <div key={question.id}>
              <label htmlFor={question.id} className="mb-1 block text-sm font-medium text-ink">
                {question.label}
                {!question.required && (
                  <span className="ml-2 text-xs font-normal text-ink-subtle">(opcional)</span>
                )}
              </label>
              <p className="mb-2 text-xs leading-relaxed text-ink-subtle">{question.help}</p>

              <textarea
                id={question.id}
                value={profile[campo]}
                onChange={(e) => set(campo)(e.target.value)}
                rows={esPrimera ? 3 : 2}
                autoFocus={esPrimera}
                aria-invalid={Boolean(errorAqui)}
                aria-describedby={errorAqui ? `${question.id}-error` : undefined}
                placeholder={question.placeholder}
                className={`w-full rounded-card border bg-surface p-3.5 text-sm leading-relaxed text-ink transition-colors placeholder:text-ink-subtle focus:outline-none ${
                  errorAqui ? "border-critical focus:border-critical" : "border-line focus:border-brand-500"
                }`}
              />

              {errorAqui && (
                <p id={`${question.id}-error`} role="alert" className="mt-2 text-xs leading-relaxed text-critical-strong">
                  {errorAqui}
                </p>
              )}

              {/* Los ejemplos sólo en la primera: es la que cuesta arrancar */}
              {esPrimera && (
                <div className="mt-3">
                  <p className="text-micro font-semibold uppercase text-ink-subtle">O empieza desde un ejemplo</p>
                  <div className="mt-2 space-y-2">
                    {OFFER_EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => set("valueProposition")(example)}
                        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-left text-xs leading-relaxed text-ink-muted transition-all hover:border-brand-500/50 hover:text-ink"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <SkipButton onSkip={onSkip} leaving={leaving} />
        <Button size="lg" onClick={onSubmit} disabled={pending || leaving}>
          {pending && <Spinner className="h-4 w-4" />}
          {pending ? "Guardando…" : pendingCompany ? "Guardar y continuar" : "Continuar"}
        </Button>
      </div>
    </div>
  );
}

// ── Paso 3: elegir empresa ──────────────────────────────────────────────────
function CompanyStep({
  value,
  onChange,
  error,
  pending,
  onSubmit,
  onPick,
  onSkip,
  leaving,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  pending: boolean;
  onSubmit: () => void;
  onPick: (url: string) => void;
  onSkip: () => void;
  leaving: boolean;
}) {
  if (pending) return <ResearchingState />;

  return (
    <div className="animate-rise-in">
      <h1 className="text-title text-balance text-ink">Elige una empresa cualquiera</h1>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Vinix va a leer su web ahora mismo y a escribir el email que le mandaría. Puede ser un
        cliente potencial real o una empresa conocida para probar.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mt-7"
      >
        <label htmlFor="company" className="mb-2 block text-sm font-medium text-ink">
          Web de la empresa
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="company"
            type="text"
            inputMode="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "company-error" : undefined}
            placeholder="stripe.com"
            className={`flex-1 rounded-card border bg-surface px-4 py-3 text-sm text-ink transition-colors placeholder:text-ink-subtle focus:outline-none ${
              error ? "border-critical focus:border-critical" : "border-line focus:border-brand-500"
            }`}
          />
          <Button type="submit" size="lg" className="shrink-0">
            Investigar
          </Button>
        </div>

        {error && (
          <p id="company-error" role="alert" className="mt-2 text-xs leading-relaxed text-critical-strong">
            {error}
          </p>
        )}
      </form>

      <div className="mt-7">
        <p className="text-micro font-semibold uppercase text-ink-subtle">O prueba con una de estas</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {SUGGESTED_COMPANIES.map((company) => (
            <button
              key={company.url}
              onClick={() => onPick(company.url)}
              className="rounded-lg border border-line bg-surface px-4 py-3 text-left transition-all hover:border-brand-500/50"
            >
              <span className="block text-sm font-medium text-ink">{company.name}</span>
              <span className="mt-0.5 block text-xs text-ink-subtle">{company.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <SkipButton onSkip={onSkip} leaving={leaving} />
      </div>
    </div>
  );
}

/** Espera activa: se explica qué está pasando en cada momento. */
function ResearchingState() {
  const PHASES = [
    "Abriendo su web…",
    "Leyendo el contenido…",
    "Buscando un motivo real para escribir…",
    "Redactando el email…",
  ];
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 2600);
    return () => clearInterval(timer);
  }, [PHASES.length]);

  return (
    <div className="animate-fade-in py-10 text-center">
      <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-brand-500/30" />
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/12">
          <Spinner className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        </span>
      </div>

      <p className="mt-6 text-heading text-ink" aria-live="polite">
        {PHASES[phase]}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
        Suele tardar entre 10 y 30 segundos. Estamos leyendo la web de verdad, no consultando una
        base de datos.
      </p>
    </div>
  );
}

// ── Paso 4: el resultado ────────────────────────────────────────────────────
function ResultStep({
  result,
  onFinish,
  leaving,
}: {
  result: TryResult;
  onFinish: () => void;
  leaving: boolean;
}) {
  if (result.outcome === "no_hook") {
    return (
      <div className="animate-rise-in">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-caution/15 text-caution-strong">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 8v5M12 17h.01" />
            </svg>
          </span>
          <span className="text-micro font-semibold uppercase text-caution-strong">
            Esto es lo que nos diferencia
          </span>
        </div>

        <h1 className="text-title text-balance text-ink">Vinix no ha escrito nada. A propósito.</h1>

        <p className="mt-4 leading-relaxed text-ink-muted">
          No encontró en la web de <strong className="font-medium text-ink">{result.companyName}</strong>{" "}
          nada concreto y verificable con lo que abrir un email. En lugar de rellenar el hueco con un
          halago genérico, lo marca para que lo revises tú.
        </p>

        <div className="mt-6 rounded-card border border-caution/30 bg-caution-soft p-5">
          <p className="text-micro font-semibold uppercase text-caution-strong">Motivo registrado</p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{result.reason}</p>
        </div>

        <div className="mt-6 rounded-card border border-line bg-surface p-5">
          <p className="text-sm leading-relaxed text-ink-muted">
            Cualquier otra herramienta habría generado aquí un{" "}
            <em>&laquo;me encanta lo que hacéis en {result.companyName}&raquo;</em>. Ese es
            exactamente el email que quema una lista y acaba en spam.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={onFinish} disabled={leaving} className="w-full sm:w-auto">
            {leaving && <Spinner className="h-4 w-4" />}
            Entendido, ir al panel
          </Button>
          <ButtonLink href="/bienvenida?paso=company" variant="secondary" size="lg" className="w-full sm:w-auto">
            Probar con otra empresa
          </ButtonLink>
        </div>
      </div>
    );
  }

  const research = result.research;
  const draft = result.draft;

  return (
    <div className="animate-rise-in">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-positive/15 text-positive-strong">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="text-micro font-semibold uppercase text-positive-strong">Tu primer email</span>
      </div>

      <h1 className="text-title text-balance text-ink">
        Esto es lo que Vinix le escribiría a {result.companyName}
      </h1>

      {/* La investigación va PRIMERO: es la prueba de que el email no está inventado */}
      {research && (research.painPoint || research.sector) && (
        <div className="mt-7 rounded-card border border-line bg-surface p-5">
          <p className="text-micro font-semibold uppercase text-ink-subtle">Lo que encontró en su web</p>
          <dl className="mt-3 space-y-2.5">
            {research.sector && (
              <div className="flex gap-3 text-sm">
                <dt className="w-24 shrink-0 text-ink-subtle">Sector</dt>
                <dd className="text-ink">{research.sector}</dd>
              </div>
            )}
            {research.size && (
              <div className="flex gap-3 text-sm">
                <dt className="w-24 shrink-0 text-ink-subtle">Tamaño</dt>
                <dd className="text-ink">{research.size}</dd>
              </div>
            )}
            {research.painPoint && (
              <div className="flex gap-3 text-sm">
                <dt className="w-24 shrink-0 text-ink-subtle">Gancho</dt>
                <dd className="font-medium text-ink">{research.painPoint}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* El email */}
      {draft && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface">
          <div className="border-b border-line bg-elevated px-5 py-3">
            <p className="text-xs text-ink-subtle">Asunto</p>
            <p className="mt-0.5 text-sm font-medium text-ink">{draft.subject}</p>
          </div>
          <div className="px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</p>
          </div>
          <div className="flex items-center justify-between border-t border-line bg-elevated px-5 py-2.5">
            <span className="text-xs tabular-nums text-ink-subtle">{draft.wordCount} palabras</span>
            <span className="text-xs text-positive-strong">Bajo el límite de 120</span>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-card border border-line bg-surface p-5">
        <p className="text-sm leading-relaxed text-ink-muted">
          Este borrador ya está en tu panel, pendiente de tu aprobación.{" "}
          <strong className="font-medium text-ink">Ningún email sale sin que tú lo apruebes.</strong>
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={onFinish} disabled={leaving} className="w-full sm:w-auto">
          Ir a mi panel
          {leaving ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </Button>
        <ButtonLink href="/bienvenida?paso=company" variant="secondary" size="lg" className="w-full sm:w-auto">
          Probar con otra empresa
        </ButtonLink>
      </div>
    </div>
  );
}

/** Se llega aquí al volver tras haber completado ya una investigación. */
function ResumedStep({
  onFinish,
  onRetry,
  leaving,
}: {
  onFinish: () => void;
  onRetry: () => void;
  leaving: boolean;
}) {
  return (
    <div className="animate-rise-in text-center">
      <h1 className="text-title text-balance text-ink">Ya has visto a Vinix trabajar</h1>
      <p className="mx-auto mt-3 max-w-md leading-relaxed text-ink-muted">
        Tu primer borrador está en el panel esperando revisión. Desde ahí puedes importar el resto de
        tus leads y configurar el remitente.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" onClick={onFinish} disabled={leaving}>
          {leaving && <Spinner className="h-4 w-4" />}
          Ir a mi panel
        </Button>
        <Button variant="secondary" size="lg" onClick={onRetry} disabled={leaving}>
          Probar otra empresa
        </Button>
      </div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <Suspense fallback={null}>
      <GuideContent />
    </Suspense>
  );
}
