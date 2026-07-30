# Código potencialmente eliminable

Generado con `node scripts/find-dead-code.mjs`. **Nada se ha eliminado.**

El detector cruza cada exportación con los usos en el resto de archivos. No
mira usos dentro del propio archivo, así que produce falsos positivos que están
marcados abajo.

---

## Falsos positivos (no tocar)

| Símbolo | Motivo |
|---|---|
| `app/layout.tsx: viewport` | Next.js lo consume por convención, no por import |
| `components/ui.tsx: IconX, IconMail` | Se usan dentro del propio `ui.tsx`, en `ToastStack` |
| `lib/agent/llm.ts: getOpenAI, LLM_MODEL` | Se usan dentro de `llm.ts` |
| Tipos e interfaces exportados | Forman parte de la API pública de cada módulo; TypeScript los elimina del bundle |

---

## Candidatos reales

### Eliminables sin impacto

| Símbolo | Archivo | Comentario |
|---|---|---|
| `resetServiceClient` | `lib/supabase/admin.ts` | Se escribió para tests que nunca se llegaron a necesitar |
| `resetEnvCache` | `lib/env.ts` | Ídem |
| `requireUser` | `lib/supabase/server.ts` | `authedRoute` usa `getUser()` directamente y gestiona el 401 |
| `updateCampaignSchema` | `lib/validation/schemas.ts` | Sustituido por el esquema `.strict()` propio de `/api/templates` |
| `monthStart` | `lib/billing/account.ts` | El cálculo pasó a Postgres en `account_overview()` |

### Usados sólo por los tests (legítimo)

`resetRateLimits`, `backoffDelay`, `csvField`, `projectRefFromKey`,
`projectRefFromUrl`, `findProjectRefMismatches`, `LEAD_STATUSES`,
`leadStatusSchema`, `emailSchema`, `companyUrlSchema`.

Son puntos de entrada para probar lógica interna. Eliminarlos obligaría a
probar sólo a través de la API pública, con menos precisión.

---

## Base de datos

| Objeto | Estado |
|---|---|
| Tabla `account` (singular) | **Obsoleta.** Sustituida por `accounts`. `APLICAR-AHORA.sql` la elimina si está vacía |
| `leads.research_raw` | Se escribe pero no se lee en ningún sitio. Es material de auditoría; puede ocupar 8 kB por lead. Candidata a mover a otra tabla o a purgar por antigüedad |
| `replies.error_message` vs `send_error` | Dos columnas para dos tipos de fallo distintos (clasificación / envío). Ambas se escriben y se leen; no son redundantes |
| `supabase/schema.sql` | **Redundante.** Sustituido por `migrations/0001…0008`. Marcado como legacy en la cabecera |
| `supabase/fix-schema-cache.sql` | **Vaciado.** Recreaba columnas con los nombres equivocados; conservado sólo como nota explicativa |

---

## Migraciones redundantes

`0005_reconcile_schema.sql` solapa parcialmente con `0001_baseline.sql` desde
que este último se corrigió con los nombres canónicos. Se conserva porque las
instalaciones que ya aplicaron el `0001` antiguo lo necesitan para converger.

En una instalación nueva basta con `0001` → `0008` en orden; `0005` no hace nada.
