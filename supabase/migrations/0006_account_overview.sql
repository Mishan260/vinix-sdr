-- ============================================================================
-- 0006 — RENDIMIENTO: resumen de cuenta en una sola consulta
--
-- PROBLEMA MEDIDO: loadAccount() hacía 5 round-trips a PostgREST, uno de ellos
-- duplicado (`campaigns` se consultaba dos veces: una para contar campañas y
-- otra dentro del cálculo de leads del mes).
--
--   1. select accounts
--   2. select campaigns          ← contar campañas
--   3. select campaigns          ← duplicada
--   4. select subscriptions
--   5. select leads
--
-- Se invoca en 5 endpoints (account, campaigns POST, leads/import,
-- leads/export, followups POST), así que su coste multiplica todo el tráfico
-- de escritura. Con 1.000 usuarios a 1 operación/min eran 300.000 consultas/h.
--
-- SOLUCIÓN: una función STABLE que resuelve todo con subconsultas correlacionadas
-- en un único viaje. Postgres las evalúa sobre índices existentes
-- (idx_campaigns_user, idx_leads_campaign) sin materializar filas intermedias.
--
-- POR QUÉ FUNCIÓN Y NO VISTA: una vista no acepta parámetros, así que el filtro
-- por usuario quedaría en el WHERE del cliente y PostgREST seguiría necesitando
-- varias peticiones para las agregaciones. Una vista materializada tampoco vale:
-- el uso cambia con cada import y tendría que refrescarse constantemente.
--
-- SEGURIDAD: `security invoker` mantiene RLS activo — un usuario no puede leer
-- el resumen de otro aunque pase su UUID. La comprobación explícita de auth.uid()
-- añade una segunda barrera para las llamadas con sesión.
-- ============================================================================

create or replace function account_overview(p_user_id uuid)
returns table (
  plan               text,
  billing_cycle      text,
  trial_ends_at      timestamptz,
  stripe_customer_id text,
  campaigns_count    integer,
  leads_this_month   integer,
  has_subscription   boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(a.plan, 'free')::text                as plan,
    a.billing_cycle::text                         as billing_cycle,
    coalesce(a.trial_ends_at, to_timestamp(0))    as trial_ends_at,
    a.stripe_customer_id                          as stripe_customer_id,

    (select count(*)::integer
       from campaigns c
      where c.user_id = p_user_id)                as campaigns_count,

    -- Leads creados este mes (UTC), a través de la campaña: `leads` no guarda
    -- user_id, la propiedad es transitiva.
    (select count(*)::integer
       from leads l
       join campaigns c2 on c2.id = l.campaign_id
      where c2.user_id = p_user_id
        and l.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
    )                                             as leads_this_month,

    exists (select 1 from subscriptions s where s.user_id = p_user_id)
                                                  as has_subscription
  from (select 1) as anchor
  -- LEFT JOIN: si no hay fila en accounts se devuelven los valores por defecto
  -- en lugar de ninguna fila, para que el llamante distinga "cuenta ausente"
  -- de "usuario inexistente".
  left join accounts a on a.user_id = p_user_id;
$$;

comment on function account_overview is
  'Plan efectivo y uso del mes de un usuario en una sola consulta. Sustituye a las 5 que hacía loadAccount().';

-- ── Índice de apoyo para el recuento mensual de leads ───────────────────────
-- La subconsulta filtra por campaign_id y created_at. El índice compuesto
-- permite resolverla con un index-only scan en lugar de leer la tabla.
create index if not exists idx_leads_campaign_created
  on leads(campaign_id, created_at desc);

-- ── Índice de apoyo para la comprobación de suscripción ─────────────────────
-- `exists (...)` sobre user_id: ya existe idx_subscriptions_user (0003).

notify pgrst, 'reload schema';
