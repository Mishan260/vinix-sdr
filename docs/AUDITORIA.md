# Auditoría técnica — Vinix SDR

**Fecha:** 2026-07-22 · **Alcance:** repositorio completo + base de datos de producción
**Método:** lectura de los 82 archivos fuente, consultas contra el Supabase real, `npm audit`, cobertura de tests, build de producción.

---

## 0. Resumen ejecutivo

El proyecto tiene una base sólida en lo invisible: RLS verificado y funcionando, webhooks idempotentes, validación con Zod, errores tipados, logs estructurados. Eso es más de lo que tienen muchos SaaS ya vendiendo.

Los problemas se concentran en tres frentes:

1. **Tres bugs bloqueantes en producción** por migraciones aplicadas a medias. La app no puede crear campañas ahora mismo.
2. **Ausencia total de producto público**: sin landing, sin SEO, sin modo oscuro, sin dashboard de métricas. Es una herramienta interna, no algo que se pueda vender.
3. **Deuda concentrada en un archivo**: `dashboard/page.tsx` tiene 1.280 líneas y 65 hooks. Es el 40% del código de UI en un único componente.

**Conteo:** 26 hallazgos — 3 bloqueantes, 7 de seguridad, 6 de arquitectura, 6 de UI/UX/SEO, 4 de proceso.

---

## 1. Bloqueantes (la app está rota ahora mismo)

### B1 — No se pueden crear campañas · `accounts` está vacía

**Severidad:** crítica · **Estado:** activo en producción

Verificado contra la BD real:

```
usuario edgarcete2016@gmail.com (ccea4ad4-…)
  fila en accounts:  NO EXISTE
  campañas propias:  1
```

`loadAccount()` no encuentra fila, cae a `FALLBACK_ACCOUNT` (plan `free`, límite 1 campaña), y como ya hay 1 campaña, `assertCanCreateCampaign()` lanza 402.

Es exactamente el motivo por el que hay un `console.log("ACCOUNT STATE:")` en `app/api/campaigns/route.ts:30`.

**Causa raíz:** la migración `0002_multitenancy.sql` se aplicó **parcialmente**. La tabla `accounts` se creó, pero ni el backfill (`insert into accounts select id from auth.users`) ni la función `claim_orphan_data` llegaron a ejecutarse.

**Prueba de que 0002 quedó a medias:**
```
✗ función claim_orphan_data → "Could not find the function public.claim_orphan_data"
```

**Efecto colateral:** cualquier usuario nuevo que se registre **sí** tendrá cuenta (el trigger `handle_new_user` existe). Sólo están afectados los usuarios anteriores a la migración.

---

### B2 — La campaña DEMO es invisible

**Severidad:** alta

```
DEMO — Agencias web Barcelona   user_id = NULL (huérfana)
```

RLS la oculta correctamente. La función que debía reclamarla (`claim_orphan_data`) no existe por B1.

---

### B3 — `leads` sin columnas de seguimiento

**Severidad:** crítica (rompe dos flujos completos)

Faltan `follow_ups_sent` y `last_contacted_at`. Consecuencias:

| Flujo | Qué pasa |
|---|---|
| `/api/agent/send` | Falla al escribir `last_contacted_at` tras enviar |
| Follow-ups (manual y cron) | `countDueFollowUps` y `runFollowUps` consultan columnas inexistentes |

Ya se identificó en la sesión anterior. La migración `0005_reconcile_schema.sql` lo corrige, pero **no se ha aplicado**.

---

**Resolución de B1–B3:** aplicar `0005_reconcile_schema.sql` y la parte no ejecutada de `0002_multitenancy.sql`. Son idempotentes. Después:

```sql
insert into accounts (user_id) select id from auth.users on conflict do nothing;
select claim_orphan_data('ccea4ad4-ddc4-4103-b2a5-1e6d106ff421');
```

---

## 2. Seguridad

### S1 — Next.js 15.5.20 con 4 CVEs de severidad alta

| CVE | Impacto |
|---|---|
| `GHSA-m99w-x7hq-7vfj` | DoS en App Router con Server Actions |
| `GHSA-89xv-2m56-2m9x` | SSRF en Server Actions |
| `GHSA-68g3-v927-f742` | Confusión de caché en respuestas con body |
| `GHSA-4633-3j49-mh5q` | Confusión de caché con UTF-8 inválido |

La confusión de caché es la peor para un SaaS multi-tenant: un usuario puede recibir la respuesta cacheada de otro. **Actualizar a 15.5.22 es un parche menor, sin cambios de ruptura.**

### S2 — 12 vulnerabilidades altas en total

Las 8 restantes vienen de `brace-expansion` (DoS) a través de la cadena de ESLint. Sólo afectan a desarrollo, no al runtime de producción. Se resuelven con ESLint 10 (cambio de ruptura, no urgente).

### S3 — Rate limiting inútil en serverless

`lib/api/rate-limit.ts` guarda los contadores en memoria del proceso. En Vercel, cada instancia tiene los suyos: el límite efectivo es `límite × instancias activas`. Con autoescalado, un atacante puede forzar más instancias y multiplicar su cuota.

Los perfiles `auth` (8/min) y `passwordReset` (4/15min) son precisamente los que **no** pueden depender de memoria local.

### S4 — Sin Content-Security-Policy

`next.config.ts` define `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`, pero no CSP. Es la cabecera que realmente mitiga XSS.

### S5 — Sin registro de auditoría

No hay traza de quién hizo qué. Para vender a empresas (SOC 2, ISO 27001, o simplemente el departamento de compras de un cliente mediano) hace falta un `audit_log` inmutable: cambios de plan, envíos, exportaciones, accesos.

### S6 — `console.log` filtrando estado de cuenta

`app/api/campaigns/route.ts:30` imprime el objeto de cuenta completo en cada creación. En producción va a los logs de Vercel en texto plano. Es de depuración y debe salir antes de desplegar.

### S7 — Sin rotación de secretos ni cifrado en reposo

`SUPABASE_SERVICE_ROLE_KEY` bypasea RLS por completo y no caduca. No hay procedimiento de rotación documentado ni cifrado de campos sensibles (los borradores de email contienen datos de terceros → RGPD).

---

## 3. Arquitectura y escalabilidad

### A1 — `dashboard/page.tsx`: 1.280 líneas, 65 hooks, un componente

Es el 40% de todo el código de UI. Contiene tipos, constantes de estado, la fila de tabla memoizada, tres modales, el gestor de toasts, la lógica de polling, ocho funciones asíncronas de negocio y el render completo.

Consecuencias medibles:
- Todo el archivo es `"use client"` → 12,6 kB al bundle del cliente, nada renderizable en servidor.
- Cualquier cambio de estado re-renderiza el árbol entero.
- Imposible de testear por unidades (0% de cobertura).

### A2 — `loadAccount()` hace 5 consultas y se llama en 5 endpoints

```
loadAccount()
├── select accounts
├── count campaigns
├── countLeadsThisMonth()
│   ├── select campaigns (¡otra vez!)
│   └── count leads
└── count subscriptions
```

Se invoca en `/api/account`, `campaigns POST`, `leads/import`, `leads/export` y `followups POST`. Con 1.000 usuarios activos son 5.000 consultas por ciclo, y las dos de `campaigns` son idénticas.

**Solución:** una vista materializada o una función SQL única que devuelva plan + uso en una llamada.

### A3 — Polling: 720 peticiones/hora por usuario

`dashboard/page.tsx` refresca cada 15 s con 3 peticiones en paralelo (leads, replies, followups).

| Usuarios activos | Peticiones/hora |
|---|---|
| 10 | 7.200 |
| 100 | 72.000 |
| 1.000 | **720.000** |

Cada una arrastra su `loadAccount` correspondiente en algunos casos. Esto no llega a 1.000 clientes simultáneos: satura la cuota de Supabase y dispara la factura de Vercel.

**Solución:** Supabase Realtime (websocket) o SSE. El polling pasa a ser sólo el respaldo.

### A4 — `.in("campaign_id", ids)` reintroduce el límite de URL

`countLeadsThisMonth` y `/api/replies` pasan los IDs por la query string. Un usuario del plan Agency (campañas ilimitadas) con 200 campañas genera una URL de ~7.400 caracteres. PostgREST/Cloudflare cortan sobre 8 kB.

Es el mismo fallo que ya se corrigió en `/api/replies` para leads, reaparecido en otra capa.

### A5 — Sin capa de servicios ni repositorios

El SQL vive dentro de los Route Handlers. `authedRoute` aisló bien el *cross-cutting* (auth, validación, errores), pero el acceso a datos sigue mezclado con HTTP. Consecuencia directa: la lógica de negocio sólo se puede probar levantando un servidor, y de ahí el 0% de cobertura en `lib/agent` y `lib/billing/stripe`.

Falta la separación que pides en la Fase 2: `api → service → repository → db`.

### A6 — Sin tipos generados de Supabase

Todas las respuestas son `any` implícito. Los `as unknown as { … }` repartidos por el código (`graph.ts`, `send/route.ts`, `webhook/inbound`) son afirmaciones a ciegas: si una columna cambia de tipo, TypeScript no se entera.

`supabase gen types typescript` elimina esta categoría entera de errores — y habría detectado el bug de `followup_delay_days` en tiempo de compilación, no en producción.

---

## 4. UI, UX y SEO

### U1 — No existe producto público

`app/page.tsx` es un `redirect("/dashboard")`. No hay landing, ni precios públicos, ni blog, ni documentación.

**Para un SaaS que se quiere vender, esto es el bloqueante número uno**: no hay nada que enseñar a un cliente potencial ni nada que Google pueda indexar. `/pricing` está detrás del login, así que ni siquiera los precios son visibles.

### U2 — Sin modo oscuro

`globals.css` fija `color-scheme: light` y `layout.tsx` fija `themeColor: "#fafaf9"`. Todas las clases son `bg-white` / `text-stone-900` sin variantes `dark:`. Linear, Vercel, Raycast y Stripe —las referencias que citas— son todas dark-first.

### U3 — SEO inexistente

| Elemento | Estado |
|---|---|
| Metadata | Sólo `title` y `description` genéricos |
| OpenGraph / Twitter Card | Ausente |
| `sitemap.xml` | Ausente |
| `robots.txt` | Ausente |
| Structured data (JSON-LD) | Ausente |
| Canonical URLs | Ausente |

### U4 — Tipografía sin optimizar

Se usa la pila del sistema desde CSS. Sin `next/font` no hay subsetting, ni `font-display: swap` controlado, ni preload. El resultado es tipografía inconsistente entre Windows/macOS/Linux — muy visible frente a productos que cuidan esto.

### U5 — El dashboard no tiene métricas

Cinco números (`Metric`) y una barra de embudo. No hay series temporales, ni tasas de apertura/respuesta, ni actividad reciente, ni comparativas. Falta todo lo que pides en la Fase 4.

### U6 — Sin onboarding

Tras registrarse, el usuario aterriza en un panel vacío con un modal de "crea tu primera campaña". No hay tour, ni datos de ejemplo, ni checklist de activación. Es donde se pierde la mayoría de los registros en un SaaS.

---

## 5. Proceso y calidad

### P1 — Cobertura del 29,25% (objetivo: 90%)

```
Statements   29.25%  (215/735)
Branches     25.75%  (128/497)
Functions    37.22%  (51/137)
```

| Módulo | Cobertura |
|---|---|
| `lib/leads/csv.ts` | 98,59% ✅ |
| `lib/validation` | 93,93% ✅ |
| `lib/api/rate-limit` | 89,65% ✅ |
| `lib/api/handler.ts` | 17,28% |
| `lib/billing/account.ts` | 44,44% |
| `lib/billing/stripe.ts` | **0%** |
| `lib/agent/*` (5 archivos) | **0%** |
| `lib/supabase/*` | **0%** |

Lo que está probado, está bien probado. Lo que mueve dinero (`stripe.ts`) y lo que gasta dinero (`agent/*`) no tiene ni un test.

### P2 — Sin CI/CD

No hay `.github/workflows`. Nada impide desplegar con los tests en rojo. Los checks (`lint`, `type-check`, `test`, `build`) existen pero dependen de que alguien los ejecute a mano.

### P3 — Sin observabilidad en producción

`captureException()` está preparado pero Sentry no está instalado. No hay métricas, ni alertas, ni health checks monitorizados. Un fallo en el webhook de Stripe (= cobros que no conceden plan) pasaría inadvertido hasta que el cliente se queje.

### P4 — Sin Docker ni copias de seguridad documentadas

No hay `Dockerfile` ni `docker-compose.yml`, así que el entorno no es reproducible. No hay procedimiento de backup/restore documentado más allá de los backups automáticos de Supabase.

---

## 6. Lo que está bien (no tocar)

Para no perderlo en un refactor:

- **RLS verificado funcionando.** Comprobado con la anon key: 0 filas en las 4 tablas. El aislamiento entre cuentas lo impone Postgres, no la aplicación.
- **Webhooks idempotentes.** `claim_webhook_event()` es atómico. Un reintento de Stripe no duplica un cobro.
- **El plan sólo lo concede el webhook.** No hay forma de auto-otorgarse Agency desde el cliente.
- **Errores tipados sin fugas.** `AppError` + `fromDbError` no filtran nombres de tabla al cliente.
- **Parser CSV robusto.** 98,59% de cobertura, maneja BOM, `;`, comillas y saltos de línea internos.
- **Guard anti-SSRF en el scraper** y protección contra inyección de fórmulas en la exportación.
- **Validación Zod en toda la API**, con `.strict()` donde importa.

---

## 7. Priorización

Orden recomendado, por retorno sobre esfuerzo:

| Prioridad | Hallazgos | Esfuerzo | Por qué primero |
|---|---|---|---|
| **0 — Ahora** | B1, B2, B3, S6 | 30 min | La app está rota; son migraciones ya escritas |
| **1 — Esta semana** | S1, A6, P2 | 1–2 días | CVEs + tipos generados + CI. Barato, evita regresiones |
| **2 — Antes de vender** | U1, U3, S4, P3 | 1–2 semanas | Sin landing no hay clientes; sin Sentry no hay soporte |
| **3 — Antes de escalar** | A1, A2, A3, A4, S3 | 3–4 semanas | Aguantan 10 clientes; no aguantan 1.000 |
| **4 — Producto** | U2, U5, U6, A5, P1 | 2–3 meses | Rediseño, dashboard, refactor por capas, cobertura |

---

## 8. Nota sobre el alcance solicitado

Las fases 2–15 del encargo suman, con estimación honesta, **entre 12 y 24 meses de trabajo** para un equipo pequeño. Tres puntos concretos que conviene decidir antes de empezar:

**El editor visual de automatizaciones** (Fase 6, tipo Zapier/n8n/Make) es por sí solo un producto: motor de ejecución con estado, reintentos, versionado de flujos, editor de grafos en canvas. n8n tiene ~80 ingenieros. Recomendación: empezar por secuencias lineales configurables (que es lo que el 90% de los clientes de Instantly/Smartlead usan realmente) y dejar el editor de grafos para cuando haya demanda que lo pague.

**La importación desde LinkedIn** (Fase 7) infringe sus Términos de Servicio. LinkedIn litiga activamente contra el scraping (*hiQ v. LinkedIn*) y banea cuentas. Ofrecerlo como función expone a tus clientes y a ti. Alternativa legal: importar CSV exportado por el propio usuario desde Sales Navigator.

**Salesforce, HubSpot y Pipedrive** (Fase 8) requieren programas de partner, revisión de sus marketplaces y OAuth verificado. Los plazos de aprobación son de semanas a meses y no dependen del código.

Sobre competir con Apollo, Clay y Salesforce: son empresas de 100 a 10.000 ingenieros. La vía realista para un producto de una persona no es igualar su superficie funcional, sino ser claramente mejor en una cosa concreta. Vinix ya tiene esa cosa: **investigación real de cada empresa antes de escribir, con fallo explícito en vez de alucinación**. Apollo y Clay generan volumen; Vinix genera emails que un humano firmaría. Ese es el argumento de venta, y casi todo lo que hace falta para explotarlo está en las prioridades 0 a 2.
