-- ============================================================================
-- FUNCIONES QUE FALTAN — proyecto riygxhnrmarvkvrieijd
--
-- DIAGNÓSTICO: las TABLAS existen (accounts, onboarding_progress, campaigns…)
-- pero NINGUNA de las funciones SQL llegó a crearse:
--
--     account_overview      NO EXISTE
--     onboarding_overview   NO EXISTE
--     claim_orphan_data     NO EXISTE
--
-- Consecuencia medida: `loadOnboarding` no podía leer la propuesta de valor,
-- así que devolvía null y el usuario recibía «necesitamos saber qué vendes»
-- aunque ya lo hubiera rellenado.
--
-- El código ya funciona sin estas funciones (cae a un camino lento que lee las
-- tablas), pero con ellas cada carga del panel pasa de 5 consultas a 1.
--
-- CÓMO USARLO: Supabase → SQL Editor → New query → pegar todo → Run.
-- Idempotente: se puede ejecutar las veces que haga falta.
-- ============================================================================

-- ── Columnas del perfil de empresa (migración 0010) ─────────────────────────
alter table onboarding_progress add column if not exists target_audience text;
alter table onboarding_progress add column if not exists main_product text;

-- ── Alta automática de cuenta y progreso al registrarse ─────────────────────
-- Sin este trigger, cada usuario nuevo se queda sin fila en `accounts` y el
-- plan cae a Free (1 campaña) sin explicación.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.onboarding_progress (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill para los usuarios ya registrados
insert into accounts (user_id) select id from auth.users on conflict (user_id) do nothing;
insert into onboarding_progress (user_id) select id from auth.users on conflict (user_id) do nothing;

-- ── Resumen de cuenta en una consulta ───────────────────────────────────────
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
    coalesce(a.plan, 'free')::text,
    a.billing_cycle::text,
    coalesce(a.trial_ends_at, to_timestamp(0)),
    a.stripe_customer_id,

    (select count(*)::integer from campaigns c
      where c.user_id = p_user_id and not coalesce(c.is_demo, false)),

    (select count(*)::integer
       from leads l
       join campaigns c2 on c2.id = l.campaign_id
      where c2.user_id = p_user_id
        and l.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')),

    exists (select 1 from subscriptions s where s.user_id = p_user_id)
  from (select 1) as anchor
  left join accounts a on a.user_id = p_user_id;
$$;

-- ── Resumen del onboarding en una consulta ──────────────────────────────────
create or replace function onboarding_overview(p_user_id uuid)
returns table (
  welcomed_at        timestamptz,
  dismissed_at       timestamptz,
  completed_at       timestamptz,
  value_proposition  text,
  target_audience    text,
  main_product       text,
  dismissed_tips     text[],
  first_campaign_at  timestamptz,
  first_lead_at      timestamptz,
  first_research_at  timestamptz,
  first_draft_at     timestamptz,
  first_send_at      timestamptz,
  has_real_campaign  boolean,
  has_demo_campaign  boolean,
  lead_count         integer,
  researched_count   integer,
  draft_count        integer,
  sent_count         integer,
  has_sender_domain  boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.welcomed_at,
    p.dismissed_at,
    p.completed_at,
    p.value_proposition,
    p.target_audience,
    p.main_product,
    coalesce(p.dismissed_tips, '{}'),
    p.first_campaign_at,
    p.first_lead_at,
    p.first_research_at,
    p.first_draft_at,
    p.first_send_at,

    exists (select 1 from campaigns c where c.user_id = p_user_id and not coalesce(c.is_demo, false)),
    exists (select 1 from campaigns c where c.user_id = p_user_id and coalesce(c.is_demo, false)),

    (select count(*)::integer from leads l join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not coalesce(c.is_demo, false)),

    (select count(*)::integer from leads l join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not coalesce(c.is_demo, false)
        and l.status not in ('pending', 'researching')),

    (select count(*)::integer from leads l join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not coalesce(c.is_demo, false)
        and l.draft_body is not null),

    (select count(*)::integer from emails_sent e join campaigns c on c.id = e.campaign_id
      where c.user_id = p_user_id and not coalesce(c.is_demo, false)),

    exists (select 1 from campaigns c
      where c.user_id = p_user_id and not coalesce(c.is_demo, false) and c.sender_email <> '')
  from onboarding_progress p
  where p.user_id = p_user_id;
$$;

-- ── Idempotencia de webhooks ────────────────────────────────────────────────
create or replace function claim_webhook_event(
  p_id text, p_provider text, p_event_type text default null, p_payload jsonb default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_claimed boolean := false;
begin
  insert into webhook_events (id, provider, event_type, payload, status)
  values (p_id, p_provider, p_event_type, p_payload, 'processing')
  on conflict (id) do update
    set attempts = webhook_events.attempts + 1, status = 'processing', error_message = null
    where webhook_events.status = 'failed'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

create or replace function complete_webhook_event(
  p_id text, p_status text default 'processed', p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update webhook_events
     set status = p_status, error_message = p_error, processed_at = now()
   where id = p_id;
end;
$$;

-- ── Reclamar campañas sin propietario ───────────────────────────────────────
create or replace function claim_orphan_data(p_user_id uuid)
returns table (claimed_campaigns int)
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'El usuario % no existe', p_user_id;
  end if;
  update campaigns set user_id = p_user_id where user_id is null;
  get diagnostics v_count = row_count;
  insert into accounts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  return query select v_count;
end;
$$;

-- ── Recargar el cache de PostgREST ──────────────────────────────────────────
notify pgrst, 'reload schema';

-- ── Verificación: todo debe decir OK ────────────────────────────────────────
select 'account_overview' as objeto,
  case when exists (select 1 from pg_proc where proname='account_overview') then 'OK' else 'FALTA' end as estado
union all select 'onboarding_overview',
  case when exists (select 1 from pg_proc where proname='onboarding_overview') then 'OK' else 'FALTA' end
union all select 'claim_webhook_event',
  case when exists (select 1 from pg_proc where proname='claim_webhook_event') then 'OK' else 'FALTA' end
union all select 'claim_orphan_data',
  case when exists (select 1 from pg_proc where proname='claim_orphan_data') then 'OK' else 'FALTA' end
union all select 'trigger alta de usuario',
  case when exists (select 1 from pg_trigger where tgname='trg_auth_user_created') then 'OK' else 'FALTA' end
union all select 'usuarios sin fila en accounts',
  case when (select count(*) from auth.users u
             where not exists (select 1 from accounts a where a.user_id=u.id)) = 0
       then 'OK' else 'QUEDAN' end
union all select 'onboarding_progress.target_audience',
  case when exists (select 1 from information_schema.columns
    where table_name='onboarding_progress' and column_name='target_audience') then 'OK' else 'FALTA' end;
