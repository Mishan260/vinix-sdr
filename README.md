# Vinix SDR — Agente Autónomo de Prospección B2B

Pipeline: **Investigación (Firecrawl/fetch) → Redacción (OpenAI) → Aprobación humana → Envío (Resend) → Clasificación de respuestas (webhook) → Propuesta de reunión**.

Stack: Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · OpenAI · Resend · Stripe.

---

## ⚠️ Migración obligatoria desde versiones anteriores

Esta versión introduce **autenticación multi-usuario**. El modelo de datos anterior tenía una tabla `account` de fila única (`id = 1`) compartida por toda la instalación: incompatible con varios clientes.

**Las migraciones eliminan `account` y crean `accounts` (una fila por usuario).** Antes de aplicarlas:

1. Haz una copia: Supabase → Database → Backups.
2. Ejecuta `supabase/migrations/*.sql` **en orden numérico** (SQL Editor, o `npm run db:migrate`).
3. Regístrate en `/signup`.
4. Reclama tus datos existentes (las campañas creadas antes del login tienen `user_id` NULL):
   ```sql
   -- El UUID está en Supabase → Authentication → Users
   select claim_orphan_data('TU-USER-UUID');
   ```

Sin el paso 4 tus campañas existen pero RLS las oculta: no aparecerán en el panel.

---

## Puesta en marcha desde cero

### 1. Supabase
1. [supabase.com](https://supabase.com) → **New project** (región Frankfurt/París para España).
2. **SQL Editor** → **New query** → pega cada archivo de `supabase/migrations/` en orden y ejecuta:
   - `0001_baseline.sql` — tablas núcleo, índices, triggers
   - `0002_multitenancy.sql` — cuentas por usuario, RLS, alta automática al registrarse
   - `0003_billing.sql` — suscripciones de Stripe + sincronización del plan
   - `0004_reliability.sql` — idempotencia de webhooks
3. *(Opcional)* `supabase/seed.sql` para datos de demostración.
4. **Authentication → Providers → Email**: activa *Confirm email* si quieres verificación (recomendado en producción).
5. **Authentication → URL Configuration**: añade `https://tu-dominio.com/auth/callback` a *Redirect URLs*.

### 2. Claves

| Variable | Dónde obtenerla |
|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` → Reveal ⚠️ nunca en cliente ni en Git |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon public` |
| `OPENAI_API_KEY` | platform.openai.com → API keys (requiere método de pago) |
| `RESEND_API_KEY` | resend.com → API Keys |
| `SENDER_EMAIL` | Un email de un dominio verificado en Resend → Domains |
| `FIRECRAWL_API_KEY` | firecrawl.dev → API Keys *(opcional)* |

### 3. Stripe

1. **Products** → crea *Pro* y *Agency*. A cada uno añádele **dos precios recurrentes**: mensual y anual.
2. Copia los cuatro `price_...` a `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_AGENCY_MONTHLY`, `STRIPE_PRICE_AGENCY_ANNUAL`.
3. **Developers → API keys** → `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks → Add endpoint**: `https://tu-dominio.com/api/billing/webhook`.
   Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
   Copia el *Signing secret* a `STRIPE_WEBHOOK_SECRET`.
5. **Settings → Billing → Customer portal**: actívalo (lo usa "Gestionar suscripción").

Pruebas en local:
```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
# usa el whsec_ que imprime como STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```
Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura y CVC.

### 4. Arranque

```bash
cp .env.example .env.local   # rellena los valores
npm install
npm run dev                  # http://localhost:3000
```

⚠️ Si editas `.env.local` con el servidor arrancado, **reinícialo**. Next.js sólo lee las variables al arrancar. Es el error de configuración más frecuente.

### 5. Webhook de respuestas (Resend)

Necesita URL pública. En producción: Resend → **Webhooks** → Add endpoint → `https://tu-dominio.com/api/agent/webhook/inbound`, eventos `email.received` / `email.replied`. Copia el *Signing Secret* a `RESEND_WEBHOOK_SECRET`.
En local: `ngrok http 3000` y usa esa URL.

---

## Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. **Settings → Environment Variables**: pega todas las de `.env.local`, más:
   - `NEXT_PUBLIC_SITE_URL` = tu dominio final (Stripe lo usa para las redirecciones de vuelta)
   - `CRON_SECRET` = valor aleatorio largo (`openssl rand -hex 32`)
3. Deploy. `vercel.json` ya programa el cron de follow-ups cada mañana laborable a las 9:00.
4. Actualiza las URLs de los webhooks de Stripe y Resend al dominio de producción.
5. Añade `https://tu-dominio.com/auth/callback` a las *Redirect URLs* de Supabase.

Orden importante: **primero migraciones, luego deploy**. Si el código nuevo llega antes que las tablas, `/api/health` lo detecta y el panel muestra qué falta.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript sin emitir |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright) |
| `npm run db:migrate` | Aplica las migraciones (requiere `SUPABASE_DB_URL`) |

Los E2E del flujo completo se omiten salvo que definas credenciales de un usuario de pruebas:
```bash
E2E_EMAIL=test@tudominio.com E2E_PASSWORD=... npm run test:e2e
```
Úsalo contra un proyecto de Supabase **desechable**: crea y borra datos reales.

---

## Arquitectura

```
lib/
├── env.ts                    # Validación de entorno con Zod (perezosa, no rompe el build)
├── errors.ts                 # AppError + traducción a HTTP, sin filtrar internals
├── logger.ts                 # Logs estructurados JSON + redacción de secretos
├── api/
│   ├── handler.ts            # Wrapper de rutas: requestId, auth, Zod, errores
│   └── rate-limit.ts         # Ventana deslizante por usuario/IP
├── supabase/
│   ├── admin.ts              # service role (webhooks, cron, supresión global)
│   ├── server.ts             # sesión del usuario → RLS (uso por defecto)
│   └── browser.ts            # cliente de navegador (login)
├── billing/
│   ├── plans.ts              # Fuente de verdad de planes y límites
│   ├── stripe.ts             # Checkout, portal, sincronización
│   └── account.ts            # Plan efectivo, uso y comprobación de límites
├── agent/                    # llm, graph, prompts, followups, tools/
├── leads/csv.ts              # Parseo y serialización de CSV
└── validation/schemas.ts     # Esquemas Zod de toda la API

supabase/migrations/          # 0001…0004, idempotentes y en orden
tests/                        # Vitest (unitarios) + e2e/ (Playwright)
```

### Decisiones de seguridad

| Decisión | Motivo |
|---|---|
| RLS impone el aislamiento, no la aplicación | Un `.eq("user_id")` olvidado no filtra datos: Postgres lo bloquea |
| `authedRoute` usa la sesión del usuario, no service role | El service role bypasea RLS; se reserva a webhooks y cron |
| El plan sólo lo concede el webhook de Stripe | El endpoint anterior permitía auto-otorgarse Agency gratis |
| Webhooks idempotentes por id de evento | Un reintento no duplica cobros ni reenvía respuestas |
| Login con mensaje genérico | Distinguir "no existe" de "contraseña incorrecta" permite enumerar cuentas |
| `getUser()` en middleware, no `getSession()` | `getSession()` se fía de la cookie, que es falsificable |
| Guard anti-SSRF en el scraper | La URL viene de un CSV: sin filtro, el servidor consultaría `169.254.169.254` |
| Prefijo `'` en campos CSV que empiezan por `= + - @` | Excel ejecutaría el contenido scrapeado como fórmula |
| Contenido de emails delimitado en el prompt | Es texto no confiable de terceros; se clasifica, no se obedece |

---

## Robustez

| Fallo | Comportamiento |
|---|---|
| Variables de entorno ausentes | `/api/health` lo detalla; las APIs devuelven 503 con mensaje accionable |
| Tablas sin crear | El health check indica qué migración falta |
| Scraping falla | Lead → `research_failed` con el motivo. **Nunca se alucina** |
| Investigación sin hook ni dolor | Revisión manual (un email genérico es spam) |
| Rate limit de OpenAI | 2 reintentos con backoff + timeout 45 s; 401/429 con mensaje claro |
| Email > 120 palabras | 1 reintento de recorte; si persiste, error explícito |
| CSV de Excel español (`;`, BOM, saltos en celda) | Autodetección y parseo con comillas |
| Firma de webhook inválida | 401/400, no se procesa |
| Reintento de webhook | Idempotente: se detecta y se responde sin reprocesar |
| Fallo al procesar un webhook | Se marca `failed` y se devuelve 500 para que el proveedor reintente |
| Pago fallido | `past_due` mantiene el acceso durante el periodo de gracia de Stripe |
| Suscripción cancelada | El plan cae a Free al final del periodo pagado, sin perder datos |
| Clasificación IA falla | Lead → `replied`, marcado para revisión, webhook responde 200 |
| `Could not find the '…' column in the schema cache` | Ejecuta `supabase/fix-schema-cache.sql` |

---

## Pendiente conocido

- **Rate limiting en memoria**: en Vercel cada instancia tiene su contador, así que el límite efectivo es `límite × instancias`. Suficiente contra fuerza bruta; para límites estrictos, migrar a Upstash Redis (la interfaz de `check()` está preparada para sustituirse).
- **Sentry no instalado**: `captureException()` ya centraliza la captura; sólo falta `npm i @sentry/nextjs` y cambiar el cuerpo de esa función.
- **Sin roles dentro de una cuenta**: cada usuario es dueño de sus campañas. Equipos con varios miembros requerirían una tabla `memberships`.
