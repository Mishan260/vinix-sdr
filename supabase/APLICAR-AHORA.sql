-- ============================================================================
-- VINIX — REPARACIÓN COMPLETA DEL ESQUEMA
--
-- CÓMO USARLO
--   1. Supabase → SQL Editor → New query
--   2. Pega TODO este archivo
--   3. Run
--   4. Lee la tabla de verificación del final: todo debe decir OK
--
-- QUÉ ARREGLA
--   B1  No se pueden crear campañas (402): falta la fila en `accounts`
--   B2  La campaña DEMO es invisible: user_id NULL y sin claim_orphan_data
--   B3  Envío y follow-ups rotos: faltan columnas en `leads`
--
-- SEGURIDAD
--   Idempotente: se puede ejecutar las veces que haga falta.
--   Sólo añade. Lo único que elimina es la tabla `account` antigua, y sólo
--   si está vacía (se comprueba antes).
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — Columnas que faltan (equivale a 0005_reconcile_schema.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Converger nombres antiguos → canónicos, si existieran
do $$
declare r record;
begin
  for r in select * from (values
      ('follow_up_enabled', 'followups_enabled'),
      ('follow_up_days',    'followup_delay_days'),
      ('max_follow_ups',    'followup_max_touches')
    ) as t(old_name, new_name)
  loop
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='campaigns' and column_name=r.old_name) then
      if exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='campaigns' and column_name=r.new_name) then
        execute format('alter table public.campaigns drop column %I', r.old_name);
      else
        execute format('alter table public.campaigns rename column %I to %I', r.old_name, r.new_name);
      end if;
    end if;
  end loop;
end $$;

-- 1.2 Columnas canónicas de campaigns
alter table campaigns add column if not exists followups_enabled    boolean not null default true;
alter table campaigns add column if not exists followup_delay_days  int     not null default 3;
alter table campaigns add column if not exists followup_max_touches int     not null default 2;
alter table campaigns add column if not exists daily_send_limit     int     not null default 20;
alter table campaigns add column if not exists updated_at           timestamptz not null default now();
alter table campaigns add column if not exists user_id              uuid references auth.users(id) on delete cascade;

-- 1.3 Columnas de seguimiento en leads  ← B3
--     Sin ellas fallan /api/agent/send y toda la secuencia de follow-ups
alter table leads add column if not exists follow_ups_sent   int not null default 0;
alter table leads add column if not exists last_contacted_at timestamptz;

-- 1.4 Restricciones de rango
do $$
begin
  if not exists (select 1 from pg_constraint where conname='campaigns_followup_delay_days_check') then
    alter table campaigns add constraint campaigns_followup_delay_days_check
      check (followup_delay_days between 1 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname='campaigns_followup_max_touches_check') then
    alter table campaigns add constraint campaigns_followup_max_touches_check
      check (followup_max_touches between 0 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname='leads_follow_ups_sent_check') then
    alter table leads add constraint leads_follow_ups_sent_check check (follow_ups_sent >= 0);
  end if;
end $$;

-- 1.5 Trigger de updated_at
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

drop trigger if exists trg_leads_updated on leads;
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — Multi-tenancy (lo que 0002_multitenancy.sql dejó a medias)
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Tabla accounts: una fila por usuario
create table if not exists accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','free','pro','agency')),
  billing_cycle text check (billing_cycle in ('monthly','annual')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_accounts_stripe_customer
  on accounts(stripe_customer_id) where stripe_customer_id is not null;

drop trigger if exists trg_accounts_updated on accounts;
create trigger trg_accounts_updated before update on accounts
  for each row execute function set_updated_at();

-- 2.2 Alta automática al registrarse
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- 2.3 BACKFILL ← B1: crea la cuenta de los usuarios ya registrados
insert into accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- 2.4 Migrar el plan de la tabla `account` antigua, si tenía datos
do $$
declare v_user uuid; v_plan text; v_cycle text; v_trial timestamptz; v_rows int;
begin
  if to_regclass('public.account') is null then return; end if;

  execute 'select count(*) from account' into v_rows;
  if v_rows = 0 then
    drop table account;   -- vacía: no se pierde nada
    raise notice 'Tabla account antigua (vacía) eliminada';
    return;
  end if;

  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then return; end if;

  execute 'select plan, billing_cycle, trial_ends_at from account where id = 1'
    into v_plan, v_cycle, v_trial;

  if v_plan is not null then
    update accounts
       set plan = v_plan,
           billing_cycle = v_cycle,
           trial_ends_at = coalesce(v_trial, trial_ends_at)
     where user_id = v_user;
    raise notice 'Plan % migrado al usuario %', v_plan, v_user;
  end if;

  drop table account;
end $$;

-- 2.5 Función para reclamar campañas huérfanas ← B2
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

-- 2.6 RLS sobre accounts
alter table accounts enable row level security;

drop policy if exists "accounts_select_own" on accounts;
create policy "accounts_select_own" on accounts
  for select using (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 3 — Índices de rendimiento
-- ════════════════════════════════════════════════════════════════════════════
create index if not exists idx_campaigns_user        on campaigns(user_id);
create index if not exists idx_campaigns_user_status on campaigns(user_id, status);
create index if not exists idx_leads_followup_due    on leads(campaign_id, status, last_contacted_at)
  where status = 'sent';
create index if not exists idx_leads_email_lower     on leads(lower(contact_email))
  where contact_email is not null;

commit;

-- Recargar el cache de PostgREST (fuera de la transacción)
notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — todas las filas deben decir OK
-- ════════════════════════════════════════════════════════════════════════════
select
  'B3 · leads.follow_ups_sent'   as comprobacion,
  case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='leads' and column_name='follow_ups_sent')
    then 'OK' else 'FALTA' end as resultado
union all select
  'B3 · leads.last_contacted_at',
  case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='leads' and column_name='last_contacted_at')
    then 'OK' else 'FALTA' end
union all select
  'campaigns.followups_enabled',
  case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='campaigns' and column_name='followups_enabled')
    then 'OK' else 'FALTA' end
union all select
  'campaigns.followup_delay_days',
  case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='campaigns' and column_name='followup_delay_days')
    then 'OK' else 'FALTA' end
union all select
  'B1 · tabla accounts',
  case when to_regclass('public.accounts') is not null then 'OK' else 'FALTA' end
union all select
  'B1 · usuarios sin cuenta',
  case when (select count(*) from auth.users u
             where not exists (select 1 from accounts a where a.user_id = u.id)) = 0
    then 'OK' else 'QUEDAN SIN CUENTA' end
union all select
  'B2 · función claim_orphan_data',
  case when exists (select 1 from pg_proc where proname='claim_orphan_data') then 'OK' else 'FALTA' end
union all select
  'tabla account antigua eliminada',
  case when to_regclass('public.account') is null then 'OK' else 'TODAVIA EXISTE' end
union all select
  'campañas huérfanas (user_id NULL)',
  case when (select count(*) from campaigns where user_id is null) = 0
    then 'OK'
    else (select count(*)::text from campaigns where user_id is null) || ' pendientes -> ver paso siguiente'
  end;


-- ════════════════════════════════════════════════════════════════════════════
-- PASO FINAL — sólo si arriba quedan campañas huérfanas
-- Descomenta y ejecuta (el UUID es el de tu usuario edgarcete2016@gmail.com):
-- ════════════════════════════════════════════════════════════════════════════
-- select claim_orphan_data('ccea4ad4-ddc4-4103-b2a5-1e6d106ff421');
