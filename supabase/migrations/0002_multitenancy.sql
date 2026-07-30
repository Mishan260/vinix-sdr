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
