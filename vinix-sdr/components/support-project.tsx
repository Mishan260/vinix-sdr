// components/support-project.tsx
// ============================================================================
// Bloque de aportación voluntaria al proyecto.
//
// DECISIÓN: son enlaces salientes a PayPal.me, no un formulario propio.
// El dinero y los datos de tarjeta se manejan íntegramente en PayPal; aquí no
// se recoge ni se almacena nada. Eso evita cualquier responsabilidad sobre
// datos de pago y hace que el bloque funcione sin JavaScript.
//
// Se distingue a propósito de los planes de pago: una aportación NO desbloquea
// funciones ni cambia el plan. Decirlo explícitamente evita que alguien done
// creyendo que está contratando Pro.
// ============================================================================

import { IconExternal, IconHeart } from "./ui";

/** Usuario de PayPal.me que recibe las aportaciones. */
const PAYPAL_USERNAME = "EdgarTe82";

/**
 * PayPal.me admite el importe en la propia URL: /usuario/5EUR.
 * Sin sufijo de divisa usaría la del visitante, lo que daría cantidades raras
 * (5 USD para un visitante de EE. UU. cuando el proyecto factura en euros).
 */
const paypalUrl = (amount?: number) =>
  amount ? `https://paypal.me/${PAYPAL_USERNAME}/${amount}EUR` : `https://paypal.me/${PAYPAL_USERNAME}`;

const PRESET_AMOUNTS = [3, 5, 10] as const;

export function SupportProject() {
  return (
    <section
      aria-labelledby="support-heading"
      className="mt-16 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        {/* Texto */}
        <div className="max-w-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
              <IconHeart />
            </span>
            <h2 id="support-heading" className="text-base font-semibold tracking-tight text-stone-900">
              Apoya el proyecto
            </h2>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-stone-500">
            Vinix lo mantiene una persona. Si te resulta útil y quieres echar una mano con los costes de
            servidores y APIs, puedes aportar lo que quieras.
          </p>

          <p className="mt-2 text-xs leading-relaxed text-stone-400">
            Es una aportación voluntaria y puntual: no es una suscripción, no se renueva y no cambia tu
            plan ni desbloquea funciones.
          </p>
        </div>

        {/* Importes */}
        <div className="shrink-0 sm:text-right">
          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-stone-400">
            Aportación única
          </p>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            {PRESET_AMOUNTS.map((amount) => (
              <a
                key={amount}
                href={paypalUrl(amount)}
                target="_blank"
                // noreferrer/noopener: sin ellos, la pestaña abierta puede
                // manipular esta página a través de window.opener
                rel="noopener noreferrer"
                aria-label={`Aportar ${amount} euros mediante PayPal (se abre en una pestaña nueva)`}
                className="inline-flex min-w-[64px] items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium tabular-nums text-stone-700 shadow-sm transition-all hover:border-teal-700 hover:bg-teal-50 hover:text-teal-800 active:scale-[0.97]"
              >
                {amount} €
              </a>
            ))}
          </div>

          <a
            href={paypalUrl()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Elegir otra cantidad en PayPal (se abre en una pestaña nueva)"
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 transition-colors hover:text-teal-800 hover:underline"
          >
            Otra cantidad <IconExternal />
          </a>

          <p className="mt-3 max-w-[220px] text-[11px] leading-relaxed text-stone-400 sm:ml-auto">
            Te llevamos a PayPal para completar el pago. No recogemos ni guardamos ningún dato de tu
            tarjeta.
          </p>
        </div>
      </div>
    </section>
  );
}
