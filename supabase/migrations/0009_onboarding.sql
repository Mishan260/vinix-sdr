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
