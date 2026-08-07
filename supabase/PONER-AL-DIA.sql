-- ============================================================================
-- PONER AL DÍA LA BASE DE DATOS — proyecto riygxhnrmarvkvrieijd
--
-- ESTADO MEDIDO el 2026-08-04 contra la base de datos real, no supuesto:
--
--   TABLAS QUE EXISTEN:  campaigns, leads, emails_sent, replies
--                        + `account` (en singular, de una versión antigua)
--   TABLAS QUE FALTAN:   accounts, subscriptions, webhook_events,
--                        onboarding_progress, onboarding_events
--   FUNCIONES:           ninguna
--
-- Es decir: sólo llegó a aplicarse la migración 0001. Todo lo demás falta.
--
-- CONSECUENCIA OBSERVADA: al pulsar «Continuar» en el perfil de empresa, la
-- escritura iba contra una tabla inexistente. Antes eso se descartaba en
-- silencio y la pantalla se repetía en bucle; ahora la aplicación lo dice.
--
-- ESTE FICHERO SE GENERA. No lo edites a mano: sale de concatenar las
-- migraciones 0002 a 0011 con `node supabase/build-al-dia.mjs`.
--
-- CÓMO USARLO
--   Supabase → SQL Editor → New query → pegar todo → Run.
--   Tarda unos segundos. Al final imprime una tabla de verificación donde
--   todas las filas deben decir OK.
--
-- ES SEGURO: todo usa `if not exists`, `create or replace` y
-- `drop ... if exists`, así que se puede ejecutar las veces que haga falta.
-- No borra ni modifica ninguno de tus datos actuales.
--
-- La tabla `account` en singular NO se toca: no la usa el código y borrarla
-- es una decisión tuya, no mía.
-- ============================================================================


-- ==========================================================================
-- MIGRACIÓN 0002_multitenancy
-- ==========================================================================

-- ============================================================================
-- 0002 — MULTI-TENANCY: una cuenta por usuario + RLS de aislamiento total
--
-- CAMBIO DE RUPTURA: la tabla `account` era una fila única (id = 1) compartida
-- por toda la instalación. Incompatible con varios clientes. Se sustituye por
-- `accounts`, con user_id como clave primaria.
--
-- Los datos existentes (creados antes del login) tienen campaigns.user_id NULL.
-- No se borran: se reclaman con claim_orphan_data() — ver el final del archivo.
-- ============================================================================

-- ── ACCOUNTS: una fila por usuario ──────────────────────────────────────────
create table if not exists accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial','free','pro','agency')),
  billing_cycle text check (billing_cycle in ('monthly','annual')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_accounts_stripe_customer on accounts(stripe_customer_id)
  where stripe_customer_id is not null;

drop trigger if exists trg_accounts_updated on accounts;
create trigger trg_accounts_updated before update on accounts
  for each row execute function set_updated_at();

-- ── Alta automática de cuenta al registrarse ────────────────────────────────
-- Sin esto habría que crear la fila desde la app, con condiciones de carrera
-- entre la primera petición y el alta. Postgres lo garantiza atómicamente.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill: cuentas para usuarios que ya existían antes de esta migración
insert into accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ── Migración de la tabla `account` antigua (fila única) ────────────────────
-- Si existía y sólo hay un usuario, se conserva su plan para no degradarlo.
do $$
declare
  v_user uuid;
  v_plan text;
  v_cycle text;
  v_trial timestamptz;
begin
  if to_regclass('public.account') is null then return; end if;

  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then return; end if;

  execute 'select plan, billing_cycle, trial_ends_at from account where id = 1'
    into v_plan, v_cycle, v_trial;

  if v_plan is not null then
    update accounts
       set plan = v_plan, billing_cycle = v_cycle, trial_ends_at = coalesce(v_trial, trial_ends_at)
     where user_id = v_user;
  end if;
end $$;

drop table if exists account;

-- ── RLS: aislamiento por usuario ────────────────────────────────────────────
-- Con estas políticas, una consulta con la anon key NUNCA puede devolver datos
-- de otro usuario, aunque la capa de aplicación olvide filtrar por user_id.
alter table accounts   enable row level security;
alter table campaigns  enable row level security;
alter table leads      enable row level security;
alter table emails_sent enable row level security;
alter table replies    enable row level security;

-- accounts: cada usuario ve y edita sólo la suya. El plan NO es editable por
-- el usuario (lo cambia el webhook de Stripe con service role): por eso el
-- UPDATE se limita vía trigger, no vía política.
drop policy if exists "accounts_select_own" on accounts;
create policy "accounts_select_own" on accounts
  for select using (auth.uid() = user_id);

-- campaigns: propiedad directa
drop policy if exists "own campaigns" on campaigns;
drop policy if exists "campaigns_select_own" on campaigns;
create policy "campaigns_select_own" on campaigns
  for select using (auth.uid() = user_id);

drop policy if exists "campaigns_insert_own" on campaigns;
create policy "campaigns_insert_own" on campaigns
  for insert with check (auth.uid() = user_id);

drop policy if exists "campaigns_update_own" on campaigns;
create policy "campaigns_update_own" on campaigns
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "campaigns_delete_own" on campaigns;
create policy "campaigns_delete_own" on campaigns
  for delete using (auth.uid() = user_id);

-- leads: propiedad transitiva a través de la campaña
drop policy if exists "leads of own campaigns" on leads;
drop policy if exists "leads_select_own" on leads;
create policy "leads_select_own" on leads
  for select using (exists (
    select 1 from campaigns c where c.id = leads.campaign_id and c.user_id = auth.uid()
  ));

drop policy if exists "leads_insert_own" on leads;
create policy "leads_insert_own" on leads
  for insert with check (exists (
    select 1 from campaigns c where c.id = leads.campaign_id and c.user_id = auth.uid()
  ));

drop policy if exists "leads_update_own" on leads;
create policy "leads_update_own" on leads
  for update using (exists (
    select 1 from campaigns c where c.id = leads.campaign_id and c.user_id = auth.uid()
  )) with check (exists (
    select 1 from campaigns c where c.id = leads.campaign_id and c.user_id = auth.uid()
  ));

drop policy if exists "leads_delete_own" on leads;
create policy "leads_delete_own" on leads
  for delete using (exists (
    select 1 from campaigns c where c.id = leads.campaign_id and c.user_id = auth.uid()
  ));

-- emails_sent: sólo lectura desde el cliente (los escribe el servidor)
drop policy if exists "emails of own leads" on emails_sent;
drop policy if exists "emails_select_own" on emails_sent;
create policy "emails_select_own" on emails_sent
  for select using (exists (
    select 1 from leads l join campaigns c on c.id = l.campaign_id
    where l.id = emails_sent.lead_id and c.user_id = auth.uid()
  ));

-- replies: lectura de las propias + las huérfanas (lead_id null) quedan fuera
-- del alcance del cliente por diseño; se sirven vía API con service role.
drop policy if exists "replies of own leads" on replies;
drop policy if exists "replies_select_own" on replies;
create policy "replies_select_own" on replies
  for select using (exists (
    select 1 from leads l join campaigns c on c.id = l.campaign_id
    where l.id = replies.lead_id and c.user_id = auth.uid()
  ));

-- ── Reclamar datos creados antes de que existiera el login ──────────────────
-- Uso: tras registrarte, ejecuta en SQL Editor
--   select claim_orphan_data('TU-USER-UUID');
-- El UUID está en Supabase → Authentication → Users.
create or replace function claim_orphan_data(p_user_id uuid)
returns table (claimed_campaigns int)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
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

comment on function claim_orphan_data is
  'Asigna al usuario indicado todas las campañas sin propietario (creadas antes del login).';


-- ==========================================================================
-- MIGRACIÓN 0003_billing
-- ==========================================================================

-- ============================================================================
-- 0003 — FACTURACIÓN: suscripciones de Stripe sincronizadas
--
-- `accounts.plan` es el campo que la app consulta en caliente para aplicar
-- límites. `subscriptions` es el reflejo fiel del estado en Stripe, y la
-- fuente desde la que se recalcula `accounts.plan` (ver trigger al final).
-- Así una consulta de límites no necesita llamar a la API de Stripe.
-- ============================================================================

create table if not exists subscriptions (
  -- El id de la suscripción en Stripe (sub_...): hace el upsert idempotente
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  stripe_customer_id text not null,
  stripe_price_id text,

  -- Estado tal cual lo reporta Stripe
  status text not null check (status in (
    'trialing','active','past_due','canceled','incomplete',
    'incomplete_expired','unpaid','paused'
  )),
  plan text not null check (plan in ('free','pro','agency')),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),

  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  trial_ends_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on subscriptions(user_id);
create index if not exists idx_subscriptions_customer on subscriptions(stripe_customer_id);
create index if not exists idx_subscriptions_status on subscriptions(status);

drop trigger if exists trg_subscriptions_updated on subscriptions;
create trigger trg_subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();

alter table subscriptions enable row level security;

-- El usuario puede LEER su suscripción (para mostrarla en /pricing).
-- Escribirla es exclusivo del webhook con service role: si el cliente pudiera
-- escribir aquí, se auto-otorgaría el plan Agency gratis.
drop policy if exists "subscriptions_select_own" on subscriptions;
create policy "subscriptions_select_own" on subscriptions
  for select using (auth.uid() = user_id);

-- ── Sincronización subscriptions → accounts.plan ────────────────────────────
-- Un solo lugar decide el plan efectivo. Estados que dan acceso de pago:
-- 'active' y 'trialing'. 'past_due' mantiene el acceso durante el periodo de
-- gracia de Stripe (evita cortar el servicio por un fallo transitorio de la
-- tarjeta); el resto degrada a free.
create or replace function sync_account_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_plan text;
  v_cycle text;
begin
  select
    case when s.status in ('active','trialing','past_due') then s.plan else 'free' end,
    s.billing_cycle
    into v_plan, v_cycle
  from subscriptions s
  where s.user_id = new.user_id
  order by
    case s.status when 'active' then 1 when 'trialing' then 2 when 'past_due' then 3 else 4 end,
    s.current_period_end desc nulls last
  limit 1;

  update accounts
     set plan = coalesce(v_plan, 'free'),
         billing_cycle = case when coalesce(v_plan,'free') = 'free' then null else v_cycle end
   where user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_sync_account_plan on subscriptions;
create trigger trg_sync_account_plan after insert or update on subscriptions
  for each row execute function sync_account_plan();


-- ==========================================================================
-- MIGRACIÓN 0004_reliability
-- ==========================================================================

-- ============================================================================
-- 0004 — FIABILIDAD: idempotencia de webhooks y trazabilidad de trabajos
--
-- Stripe y Resend reintentan cada evento hasta que respondes 2xx. Sin registro
-- de qué se ha procesado, un reintento duplica cobros aplicados, respuestas
-- enviadas y cambios de estado. Esta tabla convierte los webhooks en
-- idempotentes: el id del evento del proveedor es la clave primaria.
-- ============================================================================

create table if not exists webhook_events (
  -- id del evento en el proveedor (evt_... en Stripe, svix-id en Resend)
  id text primary key,
  provider text not null check (provider in ('stripe','resend')),
  event_type text,
  status text not null default 'processing' check (status in ('processing','processed','failed','ignored')),
  attempts int not null default 1,
  error_message text,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_webhook_events_provider on webhook_events(provider, received_at desc);
create index if not exists idx_webhook_events_status on webhook_events(status) where status <> 'processed';

alter table webhook_events enable row level security;
-- Sin políticas: sólo accesible con service role. Los webhooks no tienen usuario.

-- ── Reserva atómica de un evento ────────────────────────────────────────────
-- Devuelve true si este proceso debe encargarse del evento, false si ya está
-- procesado o lo está procesando otra instancia. El INSERT ... ON CONFLICT es
-- atómico: dos entregas simultáneas del mismo evento no pueden ganar ambas.
create or replace function claim_webhook_event(
  p_id text,
  p_provider text,
  p_event_type text default null,
  p_payload jsonb default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_claimed boolean := false;
begin
  insert into webhook_events (id, provider, event_type, payload, status)
  values (p_id, p_provider, p_event_type, p_payload, 'processing')
  on conflict (id) do update
    -- Reintento tras un fallo: se vuelve a intentar. Si ya está 'processed'
    -- o 'ignored', el WHERE lo descarta y no se devuelve fila.
    set attempts = webhook_events.attempts + 1,
        status = 'processing',
        error_message = null
    where webhook_events.status = 'failed'
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

create or replace function complete_webhook_event(
  p_id text,
  p_status text default 'processed',
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update webhook_events
     set status = p_status,
         error_message = p_error,
         processed_at = now()
   where id = p_id;
end;
$$;

-- ── Purga de eventos antiguos ───────────────────────────────────────────────
-- La tabla sólo necesita retener lo suficiente para cubrir la ventana de
-- reintentos de los proveedores (Stripe reintenta hasta 3 días).
create or replace function purge_old_webhook_events(p_days int default 30)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_deleted int;
begin
  delete from webhook_events
   where status = 'processed' and received_at < now() - (p_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;


-- ==========================================================================
-- MIGRACIÓN 0005_reconcile_schema
-- ==========================================================================

-- ============================================================================
-- 0005 — RECONCILIACIÓN DEL ESQUEMA
--
-- Corrige el desajuste que provocaba el error:
--   PGRST204: Could not find the 'followup_delay_days' column of 'campaigns'
--             in the schema cache
--
-- Ese mensaje culpa al cache, pero se emite igual cuando la columna NO EXISTE.
-- Por eso `NOTIFY pgrst, 'reload schema'` nunca lo arreglaba.
--
-- Nomenclatura canónica (la que tiene la BD de producción):
--   campaigns.followups_enabled       (NO follow_up_enabled)
--   campaigns.followup_delay_days     (NO follow_up_days)
--   campaigns.followup_max_touches    (NO max_follow_ups)
--
-- Idempotente y seguro de re-ejecutar.
-- ============================================================================

-- ── 1. Converger nombres antiguos → canónicos ───────────────────────────────
-- Sólo aplica a bases creadas con el baseline anterior. Si ya tienen el nombre
-- nuevo, no se toca nada (y si por accidente existieran ambos, se conserva el
-- canónico y se descarta el viejo para no dejar dos fuentes de verdad).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('follow_up_enabled', 'followups_enabled'),
      ('follow_up_days',    'followup_delay_days'),
      ('max_follow_ups',    'followup_max_touches')
    ) as t(old_name, new_name)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'campaigns' and column_name = r.old_name
    ) then
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'campaigns' and column_name = r.new_name
      ) then
        execute format('alter table public.campaigns drop column %I', r.old_name);
        raise notice 'campaigns.% eliminada (ya existía %)', r.old_name, r.new_name;
      else
        execute format('alter table public.campaigns rename column %I to %I', r.old_name, r.new_name);
        raise notice 'campaigns.% renombrada a %', r.old_name, r.new_name;
      end if;
    end if;
  end loop;
end $$;

-- ── 2. Garantizar que las columnas canónicas existen ────────────────────────
alter table campaigns add column if not exists followups_enabled    boolean not null default true;
alter table campaigns add column if not exists followup_delay_days  int     not null default 3;
alter table campaigns add column if not exists followup_max_touches int     not null default 2;
alter table campaigns add column if not exists daily_send_limit     int     not null default 20;

-- ── 3. Columnas que faltaban en `leads` ─────────────────────────────────────
-- Sin ellas la secuencia de follow-ups no puede funcionar (no hay dónde contar
-- los toques ni cuándo fue el último contacto), y /api/agent/send fallaba al
-- escribir last_contacted_at tras cada envío.
alter table leads add column if not exists follow_ups_sent   int not null default 0;
alter table leads add column if not exists last_contacted_at timestamptz;

-- ── 4. updated_at en campaigns ──────────────────────────────────────────────
-- El trigger trg_campaigns_updated escribe en esta columna: si el trigger
-- existe y la columna no, TODO update sobre campaigns falla.
alter table campaigns add column if not exists updated_at timestamptz not null default now();

-- ── 5. Restricciones de rango (tras poblar los defaults) ────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_followup_delay_days_check') then
    alter table campaigns add constraint campaigns_followup_delay_days_check
      check (followup_delay_days between 1 and 30);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'campaigns_followup_max_touches_check') then
    alter table campaigns add constraint campaigns_followup_max_touches_check
      check (followup_max_touches between 0 and 5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_follow_ups_sent_check') then
    alter table leads add constraint leads_follow_ups_sent_check check (follow_ups_sent >= 0);
  end if;
end $$;

-- ── 6. Índices y triggers que dependen de las columnas nuevas ───────────────
create index if not exists idx_leads_followup_due
  on leads(campaign_id, status, last_contacted_at) where status = 'sent';

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

-- ── 7. Recarga del cache de PostgREST ───────────────────────────────────────
-- Ahora sí es necesario: acabamos de cambiar el esquema de verdad.
notify pgrst, 'reload schema';

-- ── 8. Verificación ─────────────────────────────────────────────────────────
-- Debe devolver 6 filas. Si falta alguna, la migración no se aplicó entera.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'campaigns' and column_name in
       ('followups_enabled','followup_delay_days','followup_max_touches','updated_at'))
     or
     (table_name = 'leads' and column_name in ('follow_ups_sent','last_contacted_at'))
   )
 order by table_name, column_name;


-- ==========================================================================
-- MIGRACIÓN 0006_account_overview
-- ==========================================================================

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


-- ==========================================================================
-- MIGRACIÓN 0007_realtime
-- ==========================================================================

-- ============================================================================
-- 0007 — RENDIMIENTO: sustituir el sondeo periódico por eventos
--
-- PROBLEMA MEDIDO: el panel refrescaba cada 15 s con 3 peticiones en paralelo
-- (leads, replies, followups), estuviera o no cambiando algo:
--
--     3 peticiones / 15 s  =  720 peticiones/hora  por usuario con la pestaña abierta
--
--        10 usuarios →     7.200 peticiones/hora
--       100 usuarios →    72.000 peticiones/hora
--     1.000 usuarios →   720.000 peticiones/hora
--
-- La inmensa mayoría devolvía exactamente los mismos datos.
--
-- SOLUCIÓN: publicar `leads` y `replies` en Realtime para que el navegador
-- reciba un evento cuando algo cambia de verdad, y sólo entonces recargue.
--
-- SEGURIDAD: Realtime aplica las mismas políticas RLS que las consultas
-- normales, así que un usuario sólo recibe eventos de filas que ya podría
-- leer. `replica identity full` es necesario para que el payload incluya los
-- valores anteriores y el cliente pueda filtrar por campaña sin consultar.
-- ============================================================================

-- Publicación que Realtime consume. Existe por defecto en Supabase; se crea
-- aquí para que el script sea autosuficiente en instalaciones nuevas.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── Alta de tablas en la publicación (idempotente) ──────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['leads', 'replies']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Tabla % añadida a supabase_realtime', t;
    end if;
  end loop;
end $$;

-- Sin REPLICA IDENTITY FULL, un UPDATE sólo emite la clave primaria y el
-- cliente no puede saber a qué campaña pertenece la fila sin consultarla,
-- lo que reintroduciría una petición por evento.
alter table leads   replica identity full;
alter table replies replica identity full;

notify pgrst, 'reload schema';


-- ==========================================================================
-- MIGRACIÓN 0008_indexes
-- ==========================================================================

-- ============================================================================
-- 0008 — ÍNDICES: cubrir las consultas calientes que hacían recorrido secuencial
--
-- Cada índice de este archivo corresponde a una consulta concreta del código.
-- Los que ya existían (idx_leads_campaign_status, idx_emails_provider_msg,
-- idx_replies_review…) no se repiten aquí.
--
-- Cómo comprobar el efecto, sustituyendo el UUID por uno real:
--   explain (analyze, buffers) select … ;
-- Antes: "Seq Scan on leads" + "Sort".  Después: "Index Scan using …".
-- ============================================================================

-- ── 1. Listado principal del panel ──────────────────────────────────────────
-- Consulta:  app/api/leads/route.ts  → GET /api/leads
--   select … from leads
--    where campaign_id = $1
--    order by updated_at desc
--    limit 500
--
-- Es LA consulta más frecuente de la aplicación: se ejecuta en cada carga del
-- panel y en cada refresco. Con idx_leads_campaign (sólo campaign_id) Postgres
-- filtraba por índice pero ordenaba en memoria: con 500 leads por campaña eso
-- es un `Sort` completo en cada petición. Incluir updated_at en el índice deja
-- las filas ya ordenadas.
create index if not exists idx_leads_campaign_updated
  on leads(campaign_id, updated_at desc);

-- ── 2. Último email enviado a un lead ───────────────────────────────────────
-- Consulta:  lib/agent/followups.ts  → runFollowUps()
--   select subject, body from emails_sent
--    where lead_id = $1
--    order by sent_at desc
--    limit 1
--
-- Se ejecuta una vez POR LEAD dentro del bucle de follow-ups. Con
-- idx_emails_lead (sólo lead_id) había que leer todas las filas del lead y
-- ordenarlas para quedarse con una. Con sent_at en el índice, el `limit 1`
-- se resuelve leyendo la primera entrada.
create index if not exists idx_emails_lead_sent
  on emails_sent(lead_id, sent_at desc);

-- ── 3. Lista de supresión global ────────────────────────────────────────────
-- Consulta:  lib/agent/followups.ts y app/api/leads/import/route.ts
--   select contact_email from leads
--    where status = 'not_interested' and contact_email is not null
--
-- Cruza todas las cuentas a propósito (quien pidió no ser contactado no debe
-- recibir emails de nadie), así que recorre la tabla `leads` ENTERA. Sin un
-- índice parcial, ese recorrido crece con el total de leads de la plataforma,
-- no con los del usuario. El índice parcial sólo contiene las filas
-- 'not_interested', que son una fracción del total.
create index if not exists idx_leads_suppression
  on leads(lower(contact_email))
  where status = 'not_interested' and contact_email is not null;

-- ── 4. Presupuesto diario de envíos ─────────────────────────────────────────
-- Consulta:  app/api/agent/send/route.ts y lib/agent/followups.ts
--   select count(*) from emails_sent
--    where campaign_id = $1 and sent_at >= $2
--
-- Ya existe idx_emails_campaign_sent(campaign_id, sent_at desc) desde 0001,
-- que la cubre. No se añade nada.

-- ── 5. Respuestas de una campaña ────────────────────────────────────────────
-- Consulta:  app/api/replies/route.ts
--   select … from replies
--    join leads on … where leads.campaign_id = $1
--    order by created_at desc limit 100
--
-- El join entra por replies.lead_id (idx_replies_lead, ya existe) pero después
-- ordena por created_at. Un índice compuesto permite resolver ambas cosas.
create index if not exists idx_replies_lead_created
  on replies(lead_id, created_at desc);

-- ── 6. Respuestas huérfanas pendientes de revisión ──────────────────────────
-- Consulta:  app/api/replies/route.ts (segunda consulta, con service role)
--   select … from replies
--    where lead_id is null and flagged_for_review = true
--    order by created_at desc limit 20
--
-- idx_replies_review es un índice sobre la columna booleana, poco selectivo
-- para esta combinación. Un índice parcial sobre las huérfanas marcadas —que
-- son pocas por definición— la resuelve directamente.
create index if not exists idx_replies_orphan_review
  on replies(created_at desc)
  where lead_id is null and flagged_for_review = true;

-- ── 7. Cuentas elegibles para el cron de follow-ups ─────────────────────────
-- Consulta:  app/api/agent/followups/route.ts → runScheduled()
--   select user_id, plan, trial_ends_at from accounts
--    where plan in ('trial','pro','agency')
--
-- Se ejecuta cada mañana laborable y recorre TODA la tabla de cuentas. El
-- índice parcial excluye las cuentas 'free', que serán la mayoría.
create index if not exists idx_accounts_billable
  on accounts(plan)
  where plan in ('trial', 'pro', 'agency');

-- ── 8. Purga de eventos de webhook procesados ───────────────────────────────
-- Consulta:  purge_old_webhook_events()
--   delete from webhook_events
--    where status = 'processed' and received_at < $1
create index if not exists idx_webhook_events_purge
  on webhook_events(received_at)
  where status = 'processed';

-- ── Actualización de estadísticas ───────────────────────────────────────────
-- Sin esto el planificador sigue usando las estadísticas anteriores y puede
-- ignorar los índices recién creados hasta el siguiente autovacuum.
analyze leads;
analyze emails_sent;
analyze replies;
analyze accounts;
analyze webhook_events;

notify pgrst, 'reload schema';


-- ==========================================================================
-- MIGRACIÓN 0009_onboarding
-- ==========================================================================

-- ============================================================================
-- 0009 — ONBOARDING: progreso, analítica de embudo y datos de ejemplo
--
-- PRINCIPIO DE DISEÑO: la mayor parte del estado NO se guarda, se deriva.
-- Si hay campañas, el paso «crear campaña» está hecho. Si hay leads, el paso
-- «importar leads» está hecho. Guardar esos booleanos por separado crea una
-- segunda fuente de verdad que se desincroniza en cuanto el usuario borra algo.
--
-- Aquí sólo se persiste lo que NO puede deducirse de los datos:
--   • si ya vio la bienvenida
--   • si cerró la lista de tareas
--   • marcas de tiempo del primer hito (para medir, no para decidir)
--   • eventos del embudo (dónde abandona)
-- ============================================================================

-- ── Progreso por usuario ────────────────────────────────────────────────────
create table if not exists onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Estado que no se puede derivar
  welcomed_at   timestamptz,
  dismissed_at  timestamptz,
  completed_at  timestamptz,

  -- Qué vende el usuario. Se pregunta en la bienvenida porque es lo único que
  -- el agente no puede inferir leyendo webs ajenas.
  value_proposition text,

  -- Marcas de tiempo de cada hito. Sirven para medir «tiempo hasta X», que es
  -- la métrica de activación que de verdad importa; el estado de la lista de
  -- tareas se deriva de los datos, no de estos campos.
  first_campaign_at timestamptz,
  first_lead_at     timestamptz,
  first_research_at timestamptz,
  first_draft_at    timestamptz,
  first_send_at     timestamptz,

  -- Consejos contextuales ya descartados, para no repetirlos
  dismissed_tips text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_onboarding_updated on onboarding_progress;
create trigger trg_onboarding_updated before update on onboarding_progress
  for each row execute function set_updated_at();

-- Alta automática junto con la cuenta: evita condiciones de carrera entre el
-- registro y la primera petición del panel.
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
insert into onboarding_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table onboarding_progress enable row level security;

drop policy if exists "onboarding_select_own" on onboarding_progress;
create policy "onboarding_select_own" on onboarding_progress
  for select using (auth.uid() = user_id);

-- El usuario sí puede actualizar su propio progreso (marcar la bienvenida
-- como vista, descartar un consejo). No hay riesgo: son preferencias de UI.
drop policy if exists "onboarding_update_own" on onboarding_progress;
create policy "onboarding_update_own" on onboarding_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── Eventos del embudo ──────────────────────────────────────────────────────
-- Responde a «dónde abandonan» y «cuánto tardan». Deliberadamente sin PII:
-- sólo el paso, el resultado y cuándo. Nada del contenido que escribió el
-- usuario ni de las empresas que investigó.
create table if not exists onboarding_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  step text not null check (step in (
    'welcome_viewed', 'offer_submitted', 'sample_requested',
    'first_company_submitted', 'research_started', 'research_succeeded',
    'research_failed', 'draft_viewed', 'onboarding_completed',
    'onboarding_dismissed', 'demo_data_created', 'demo_data_removed'
  )),

  -- Milisegundos desde que empezó el onboarding. Permite medir la duración de
  -- cada paso sin unir tablas ni exponer marcas de tiempo absolutas.
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0),

  -- Detalle acotado: nunca texto libre del usuario
  detail jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_onboarding_events_user on onboarding_events(user_id, created_at);
create index if not exists idx_onboarding_events_step on onboarding_events(step, created_at desc);

alter table onboarding_events enable row level security;
-- Sin políticas de lectura: la analítica se consulta con service role. El
-- usuario no necesita leer su propio embudo.


-- ── Datos de ejemplo ────────────────────────────────────────────────────────
-- Marcar la campaña de demostración permite: (1) señalarla claramente en la
-- interfaz para que nadie la confunda con datos reales, (2) borrarla de un
-- clic, y (3) excluirla de métricas y del cron de seguimientos.
alter table campaigns add column if not exists is_demo boolean not null default false;

create index if not exists idx_campaigns_demo on campaigns(user_id) where is_demo = true;

-- Las campañas de ejemplo nunca deben enviar emails de verdad
alter table campaigns drop constraint if exists campaigns_demo_never_sends;
alter table campaigns add constraint campaigns_demo_never_sends
  check (not is_demo or status <> 'active');


-- ── Resumen del onboarding en una sola consulta ─────────────────────────────
-- El panel necesita saber, en cada carga, qué pasos faltan. Hacerlo con cinco
-- consultas sueltas repetiría el problema que se corrigió en loadAccount().
create or replace function onboarding_overview(p_user_id uuid)
returns table (
  welcomed_at        timestamptz,
  dismissed_at       timestamptz,
  completed_at       timestamptz,
  value_proposition  text,
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
    coalesce(p.dismissed_tips, '{}'),
    p.first_campaign_at,
    p.first_lead_at,
    p.first_research_at,
    p.first_draft_at,
    p.first_send_at,

    exists (select 1 from campaigns c where c.user_id = p_user_id and not c.is_demo),
    exists (select 1 from campaigns c where c.user_id = p_user_id and c.is_demo),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo
        and l.status not in ('pending', 'researching')),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo
        and l.draft_body is not null),

    (select count(*)::integer from emails_sent e
       join campaigns c on c.id = e.campaign_id
      where c.user_id = p_user_id and not c.is_demo),

    -- Hay remitente configurado si alguna campaña real tiene email de envío
    exists (
      select 1 from campaigns c
      where c.user_id = p_user_id and not c.is_demo and c.sender_email <> ''
    )
  from onboarding_progress p
  where p.user_id = p_user_id;
$$;

comment on function onboarding_overview is
  'Estado completo del onboarding en una consulta: progreso persistido + hitos derivados de los datos reales.';


-- ── Embudo agregado, para el operador ───────────────────────────────────────
-- Responde «qué porcentaje completa el onboarding» y «dónde se cae la gente».
create or replace function onboarding_funnel(p_since timestamptz default now() - interval '30 days')
returns table (
  step            text,
  users           integer,
  median_elapsed_ms integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.step,
    count(distinct e.user_id)::integer as users,
    percentile_cont(0.5) within group (order by e.elapsed_ms)::integer as median_elapsed_ms
  from onboarding_events e
  where e.created_at >= p_since
  group by e.step
  order by users desc;
$$;

notify pgrst, 'reload schema';


-- ==========================================================================
-- MIGRACIÓN 0010_company_profile
-- ==========================================================================

-- ============================================================================
-- 0010 — PERFIL DE EMPRESA: tres preguntas en lugar de un campo suelto
--
-- MOTIVO: al pedir sólo «qué vendes» en un textarea, el agente recibía una
-- frase suelta sin saber a quién se dirige ni cuál es el producto principal.
-- Separar las tres piezas produce emails mejor dirigidos y, sobre todo,
-- permite preguntar UNA vez y no volver a hacerlo.
--
-- `value_proposition` se conserva: sigue siendo el texto compuesto que consume
-- el agente, y las filas antiguas siguen funcionando sin migración de datos.
-- ============================================================================

alter table onboarding_progress add column if not exists target_audience text;
alter table onboarding_progress add column if not exists main_product text;

comment on column onboarding_progress.value_proposition is
  'Texto compuesto que consume el agente. Se deriva de las tres respuestas del perfil.';
comment on column onboarding_progress.target_audience is
  'A quién se dirige la oferta. Segunda pregunta del asistente de perfil.';
comment on column onboarding_progress.main_product is
  'Producto o servicio principal. Tercera pregunta del asistente de perfil.';

-- ── Resumen actualizado con las columnas nuevas ─────────────────────────────
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

    exists (select 1 from campaigns c where c.user_id = p_user_id and not c.is_demo),
    exists (select 1 from campaigns c where c.user_id = p_user_id and c.is_demo),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo
        and l.status not in ('pending', 'researching')),

    (select count(*)::integer from leads l
       join campaigns c on c.id = l.campaign_id
      where c.user_id = p_user_id and not c.is_demo
        and l.draft_body is not null),

    (select count(*)::integer from emails_sent e
       join campaigns c on c.id = e.campaign_id
      where c.user_id = p_user_id and not c.is_demo),

    exists (
      select 1 from campaigns c
      where c.user_id = p_user_id and not c.is_demo and c.sender_email <> ''
    )
  from onboarding_progress p
  where p.user_id = p_user_id;
$$;

notify pgrst, 'reload schema';


-- ==========================================================================
-- MIGRACIÓN 0011_onboarding_insert_policy
-- ==========================================================================

-- ============================================================================
-- 0011 — El usuario puede crear su propia fila de progreso
--
-- MOTIVO: `onboarding_progress` sólo tenía políticas de SELECT y UPDATE. La
-- fila la creaba el trigger `handle_new_user` al registrarse, así que nadie
-- necesitaba insertar... hasta que el trigger no existía en el proyecto.
--
-- Sin fila, `update ... where user_id = ?` afecta a CERO filas y PostgREST lo
-- devuelve como éxito. El resultado observado:
--
--   · «Continuar» en el perfil de empresa no guardaba la oferta, la
--     investigación volvía a pedirla y la pantalla se repetía en bucle.
--   · «Saltar» no marcaba `dismissed_at`, así que el panel devolvía al
--     usuario al recorrido guiado una y otra vez.
--
-- El código ya no depende de esto (crea la fila con el cliente de servicio si
-- hace falta), pero con la política el camino normal no necesita escalar
-- privilegios. `with check` impone que sólo se pueda crear la fila propia.
-- ============================================================================

drop policy if exists "onboarding_insert_own" on onboarding_progress;
create policy "onboarding_insert_own" on onboarding_progress
  for insert with check (auth.uid() = user_id);

-- Filas que faltan por no haber existido el trigger cuando se registraron
insert into onboarding_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Lo mismo para las cuentas: sin fila, el plan cae a Free sin explicación
insert into accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;


-- ============================================================================
-- VERIFICACIÓN — todas las filas deben decir OK
-- ============================================================================

notify pgrst, 'reload schema';

with comprobaciones as (
  select 'tabla accounts' as objeto,
    exists (select 1 from information_schema.tables
            where table_schema='public' and table_name='accounts') as ok
  union all select 'tabla subscriptions',
    exists (select 1 from information_schema.tables
            where table_schema='public' and table_name='subscriptions')
  union all select 'tabla webhook_events',
    exists (select 1 from information_schema.tables
            where table_schema='public' and table_name='webhook_events')
  union all select 'tabla onboarding_progress',
    exists (select 1 from information_schema.tables
            where table_schema='public' and table_name='onboarding_progress')
  union all select 'tabla onboarding_events',
    exists (select 1 from information_schema.tables
            where table_schema='public' and table_name='onboarding_events')
  union all select 'columna campaigns.is_demo',
    exists (select 1 from information_schema.columns
            where table_name='campaigns' and column_name='is_demo')
  union all select 'columna onboarding_progress.target_audience',
    exists (select 1 from information_schema.columns
            where table_name='onboarding_progress' and column_name='target_audience')
  union all select 'columna onboarding_progress.main_product',
    exists (select 1 from information_schema.columns
            where table_name='onboarding_progress' and column_name='main_product')
  union all select 'funcion account_overview',
    exists (select 1 from pg_proc where proname='account_overview')
  union all select 'funcion onboarding_overview',
    exists (select 1 from pg_proc where proname='onboarding_overview')
  union all select 'funcion claim_webhook_event',
    exists (select 1 from pg_proc where proname='claim_webhook_event')
  union all select 'funcion claim_orphan_data',
    exists (select 1 from pg_proc where proname='claim_orphan_data')
  union all select 'trigger de alta de usuario',
    exists (select 1 from pg_trigger where tgname='trg_auth_user_created')
  union all select 'politica onboarding_insert_own',
    exists (select 1 from pg_policies
            where tablename='onboarding_progress' and policyname='onboarding_insert_own')
  union all select 'todos los usuarios tienen fila en accounts',
    (select count(*) from auth.users u
      where not exists (select 1 from accounts a where a.user_id=u.id)) = 0
  union all select 'todos los usuarios tienen fila en onboarding_progress',
    (select count(*) from auth.users u
      where not exists (select 1 from onboarding_progress p where p.user_id=u.id)) = 0
)
select objeto, case when ok then 'OK' else '>>> FALTA <<<' end as estado
from comprobaciones
order by ok, objeto;
