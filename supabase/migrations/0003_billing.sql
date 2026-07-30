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
