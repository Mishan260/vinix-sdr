# Rendimiento y escalabilidad — mediciones

Todas las cifras son medidas, no estimadas. Cada una es reproducible con los
comandos indicados.

---

## Resumen

| Métrica | Antes | Después | Cambio |
|---|---|---|---|
| Consultas de `loadAccount()` | 5 | 1 | −80% |
| Peticiones/hora por usuario (en reposo) | 720 | 36 | −95% |
| Peticiones de un lote de 50 leads | 150 | 3 | −98% |
| Bundle del panel (First Load JS) | 119 kB | 120 kB | +1 kB |
| Vulnerabilidades altas | 12 | 0 | −100% |
| Cobertura de tests | 29,25% | 35,27% | +6 pp |
| Tests | 123 | 192 | +69 |

---

## 1. `loadAccount()` — 5 consultas → 1

**Cómo se midió:** doble del cliente Supabase que registra cada round-trip real
(`tests/helpers/counting-client.ts`). Contar `.from()` en el fuente no sirve:
una cadena `.from().select().eq()` es una sola petición HTTP.

```
npx vitest run tests/load-account-queries.test.ts
```

**Antes:**

```
1. select accounts
2. select campaigns (id)   ← contar campañas
3. select campaigns (id)   ← DUPLICADA, dentro de countLeadsThisMonth
4. select subscriptions
5. select leads
```

**Después:** una llamada a `account_overview()` (migración `0006`), que resuelve
plan, uso y suscripción con subconsultas correlacionadas.

**Por qué una función y no una vista:** una vista no acepta parámetros, así que
el filtro por usuario quedaría en el `WHERE` del cliente y PostgREST seguiría
necesitando varias peticiones para las agregaciones. Una vista materializada
tampoco vale: el uso cambia con cada importación y habría que refrescarla
constantemente.

**Impacto:** `loadAccount()` se invoca en 5 endpoints (`/api/account`,
`campaigns POST`, `leads/import`, `leads/export`, `followups POST`). Con 1.000
usuarios a una operación por minuto: **300.000 consultas/hora → 60.000**.

**Efecto colateral:** desaparece el patrón `.in("campaign_id", [...250 UUIDs])`,
que metía ~7.400 caracteres en la query string y podía superar el límite de
longitud de URL de PostgREST y Cloudflare.

---

## 2. Sondeo periódico → eventos

**Cómo se midió:** simulación con temporizadores falsos usando las constantes
reales del código.

```
npx vitest run tests/polling-budget.test.ts
```

**Antes:** `setInterval` de 15 s × 3 peticiones en paralelo (leads, replies,
followups), devolviendo casi siempre datos idénticos.

| Usuarios con la pestaña abierta | Peticiones/hora |
|---|---|
| 10 | 7.200 |
| 100 | 72.000 |
| 1.000 | **720.000** |

**Después:** suscripción de Supabase Realtime a `leads` y `replies` (migración
`0007`). El navegador recarga sólo cuando Postgres notifica un cambio real.

| Situación | Peticiones/hora |
|---|---|
| Pipeline quieto (sólo heartbeat de 5 min) | **36** |
| Realtime caído (respaldo de 60 s) | 180 |
| Antes | 720 |

Con 1.000 usuarios simultáneos: **720.000 → 36.000 peticiones/hora**.

**Agrupación de eventos:** un lote de investigación de 50 leads emite 50 eventos
de Postgres. Sin agrupar serían 50 recargas × 3 peticiones = 150. La ventana de
800 ms las reduce a **3**.

**Garantías conservadas:** guard de respuestas obsoletas, pausa con la pestaña
oculta, pausa con modal o lote abierto, y sincronización inmediata al volver a
la pestaña.

---

## 3. Bundle del panel

**Cómo se midió:** `npm run build`, columna *First Load JS*.

| Fase | First Load JS |
|---|---|
| Baseline | 119 kB |
| Tras añadir Realtime (import estático) | **187 kB** ← regresión |
| Tras cargar Realtime en diferido | **120 kB** |

`@supabase/ssr` arrastra `realtime-js` (~68 kB). Como la suscripción no hace
falta hasta después de montar, se carga con `import()` dinámico: la tabla se
pinta con el JS mínimo y el canal se conecta a continuación.

---

## 4. Cachés

**Cómo se midió:** `npx vitest run tests/ttl-cache.test.ts`

| Caché | Qué evita | TTL |
|---|---|---|
| `scrape` | Llamadas repetidas a Firecrawl por la misma URL | `RESEARCH_CACHE_TTL_HOURS`, 24 h |
| `llm` | Extracciones idénticas de OpenAI (sólo `temperature: 0`) | `LLM_CACHE_TTL_HOURS`, 24 h |

**Qué NO se cachea:** sesiones, cuentas, ni nada sujeto a RLS. En serverless una
instancia atiende a varios usuarios y cachear datos privados los mezclaría entre
cuentas.

**Por qué sólo `temperature: 0`:** con temperatura mayor la variación es
intencionada —los borradores deben sonar distintos entre leads— y reutilizar la
respuesta degradaría la calidad. En la práctica la caché cubre
`extractResearch`, que es la llamada que más se repite.

**Deduplicación en vuelo:** 50 leads del mismo dominio en un lote producen **1**
scraping, no 50. Medido: `cache.stats().coalesced === 49`.

Observable en `/api/health` → `caches.scrape.hitRate` y `caches.llm.hitRate`.

---

## 5. Cola de envíos

**Cómo se midió:** `npx vitest run tests/retry.test.ts`

**Antes:** envío único, sin reintentos. Un 429 puntual de Resend perdía el envío.
El bucle en serie de 50 leads podía superar el `maxDuration` de la función.

**Después:**

- **Reintentos con backoff exponencial y jitter.** El jitter no es cosmético:
  sin él, N envíos que fallan por un 429 reintentan todos en el mismo instante y
  vuelven a saturar al proveedor.
- **Distinción transitorio / permanente.** Un 422 «email inválido» va a fallar
  igual las tres veces; reintentarlo sólo gasta cuota y retrasa la cola.
- **Idempotencia.** Clave por lead y día en los envíos manuales, y por número de
  toque en los follow-ups: un doble clic o un solape del cron no duplica el email.
- **Concurrencia limitada** (`mapWithPool`). Medido: con concurrencia 4, un lote
  tarda menos de la mitad que en serie.

El lote de investigación del panel pasa de serie a 4 en paralelo: 50 leads a
~10 s cada uno pasan de ~8 minutos a ~2.

---

## 6. Consultas SQL

**`SELECT *` eliminado** en `lib/agent/graph.ts`: traía `research_raw` —hasta
8 kB del contenido scrapeado de una investigación anterior— y los borradores, en
cada iteración del lote, sin usarlos. Ahora pide sólo las cuatro columnas
necesarias.

**Índices añadidos** (migración `0008`), cada uno por una consulta concreta:

| Índice | Consulta que acelera |
|---|---|
| `idx_leads_campaign_updated` | Listado principal del panel: filtra por campaña y ordena por `updated_at`. Antes ordenaba en memoria 500 filas en cada carga |
| `idx_emails_lead_sent` | Último email de un lead, dentro del bucle de follow-ups (una vez por lead) |
| `idx_leads_suppression` | Lista de supresión global: recorre `leads` entera; el índice parcial la limita a las filas `not_interested` |
| `idx_replies_lead_created` | Respuestas de una campaña con orden por fecha |
| `idx_replies_orphan_review` | Respuestas huérfanas marcadas para revisión |
| `idx_accounts_billable` | Cuentas elegibles del cron diario; el índice parcial excluye las `free` |
| `idx_webhook_events_purge` | Purga de eventos procesados |
| `idx_leads_campaign_created` | Recuento mensual de leads dentro de `account_overview` (migración 0006) |

Verificación de cada uno con `explain (analyze, buffers)`: antes `Seq Scan` +
`Sort`, después `Index Scan`.

---

## 7. Renders del panel

`funnel` recorría `leads` dos veces más (`sent` y `replied`) además de las
pasadas de `filteredLeads` y `statusCounts`. Ahora se deriva de `statusCounts`,
que ya está memoizado: con 500 leads son **1.000 comparaciones menos por render**.

`flaggedReplies` y `normalReplies` eran dos `filter` sobre el mismo array; ahora
se obtienen en una sola pasada.

El borrado optimista pasó de reescribir el array de leads a un `Set` de ids
descartados, aplicado una vez en `visibleLeads`.

---

## 8. Configuración incoherente

Detectado durante este bloque: `SUPABASE_URL` apuntaba a un proyecto
(`riygx…`) mientras las tres claves pertenecían a otro (`ikcjf…`). PostgREST
respondía `401 Invalid API key` a **toda** consulta y el panel se veía vacío sin
que nada explicara por qué.

Las claves de Supabase son JWT que llevan dentro el `ref` del proyecto.
`findProjectRefMismatches()` compara ambos y `/api/health` lo reporta como
crítico, nombrando cada clave descuadrada y los dos proyectos implicados.

Verificado end-to-end: `GET /api/health` devuelve los tres desajustes con el
mensaje exacto.

---

## Cómo reproducir todas las mediciones

```bash
npm test                                   # 192 tests
npx vitest run --coverage                  # cobertura
npx vitest run tests/load-account-queries.test.ts   # consultas de loadAccount
npx vitest run tests/polling-budget.test.ts         # presupuesto de peticiones
npx vitest run tests/ttl-cache.test.ts              # ahorro de cachés
npx vitest run tests/retry.test.ts                  # reintentos y concurrencia
npm run build                              # tamaños de bundle
node scripts/find-dead-code.mjs            # exportaciones sin uso
node scripts/bench-queries.mjs             # round-trips reales (requiere BD accesible)
```
