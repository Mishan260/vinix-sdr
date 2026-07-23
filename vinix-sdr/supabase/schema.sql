-- ⚠️ LEGACY: usa supabase/migrations/*.sql. Se conserva como referencia historica.
-- ============================================================================
-- VINIX SDR — Esquema de base de datos (Supabase / PostgreSQL)
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query > Run
-- Idempotente: se puede re-ejecutar sin romper nada.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- CAMPAIGNS: agrupa leads bajo una oferta/plantilla común
-- ============================================================================
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  -- Plantilla base editable desde el panel. El agente la usa como esqueleto
  -- pero SIEMPRE la personaliza con datos de la investigación.
  base_template text not null default '',
  -- Propuesta de valor de TU oferta. El agente la necesita para redactar.
  value_proposition text not null default '',
  sender_name text not null default '',
  sender_email text not null default '',
  daily_send_limit int not null default 20 check (daily_send_limit between 1 and 500),
  -- Secuencia de follow-ups: reintentos automáticos a leads sin respuesta
  followups_enabled boolean not null default true,
  followup_delay_days int not null default 3 check (followup_delay_days between 1 and 30),
  followup_max_touches int not null default 2 check (followup_max_touches between 0 and 5),
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- LEADS: el pipeline. `status` es la máquina de estados del agente.
-- ============================================================================
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 300),
  company_url text,
  contact_name text,
  contact_email text,
  contact_role text,

  -- Resultado del Paso 1 (Investigación)
  research_sector text,
  research_size text,
  research_pain_point text,
  research_decision_maker text,
  research_raw jsonb,            -- dump para auditoría
  research_error text,           -- si el scraping falla se registra AQUÍ (no se alucina)

  -- Resultado del Paso 2 (borrador pendiente de aprobación humana)
  draft_subject text,
  draft_body text,

  -- Seguimiento de la secuencia de follow-ups
  follow_ups_sent int not null default 0,
  last_contacted_at timestamptz,

  -- Máquina de estados del pipeline
  status text not null default 'pending' check (status in (
    'pending',         -- recién importado
    'researching',     -- Paso 1 en curso
    'research_failed', -- scraping/redacción falló → revisión manual
    'ready_to_send',   -- borrador listo, esperando aprobación
    'sent',            -- email enviado
    'replied',         -- respondió (sin clasificar o unclear)
    'interested',
    'not_interested',
    'out_of_scope',
    'meeting_booked'   -- respuesta con huecos enviada
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_campaign on leads(campaign_id);
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_campaign_status on leads(campaign_id, status);

-- ============================================================================
-- EMAILS_SENT: cada email saliente. `provider_message_id` vincula respuestas
-- entrantes (header In-Reply-To del webhook) con el envío original.
-- ============================================================================
create table if not exists emails_sent (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  subject text not null,
  body text not null,
  provider text not null default 'resend',
  provider_message_id text unique,
  word_count int check (word_count is null or word_count > 0),
  sent_at timestamptz not null default now()
);

create index if not exists idx_emails_provider_msg on emails_sent(provider_message_id);
create index if not exists idx_emails_lead on emails_sent(lead_id);

-- ============================================================================
-- REPLIES: respuestas entrantes clasificadas por el agente (Paso 3)
-- lead_id ON DELETE CASCADE: al borrar un lead desde el panel se eliminan
-- también sus respuestas (coherente con el aviso mostrado al usuario).
-- lead_id nullable: las respuestas huérfanas (sin email original) se guardan
-- sin lead para revisión manual.
-- ============================================================================
create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  email_sent_id uuid references emails_sent(id) on delete set null,
  raw_body text not null,
  raw_headers jsonb,
  classification text check (classification in ('interested','not_interested','out_of_scope','unclear')),
  classification_confidence numeric(3,2) default 0 check (classification_confidence between 0 and 1),
  agent_response_draft text,
  agent_response_sent boolean default false,
  send_error text,
  error_message text,
  flagged_for_review boolean default false,
  review_reason text,   -- 'orphaned_reply' | 'suspicious_content' | 'ai_classification_failed'
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_replies_lead on replies(lead_id);
create index if not exists idx_replies_created on replies(created_at desc);
create index if not exists idx_replies_review on replies(flagged_for_review) where flagged_for_review = true;

-- Migración suave para BDs creadas con la versión anterior del esquema
-- (cambia replies.lead_id de SET NULL a CASCADE si ya existía):
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'replies' and constraint_name = 'replies_lead_id_fkey'
  ) then
    alter table replies drop constraint replies_lead_id_fkey;
    alter table replies add constraint replies_lead_id_fkey
      foreign key (lead_id) references leads(id) on delete cascade;
  end if;
end $$;

-- ============================================================================
-- Trigger de updated_at en leads
-- ============================================================================
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_leads_updated on leads;
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();

-- ============================================================================
-- Migración suave para BDs creadas con versiones anteriores del esquema
-- ============================================================================
alter table campaigns add column if not exists followups_enabled boolean not null default true;
alter table campaigns add column if not exists followup_delay_days int not null default 3;
alter table campaigns add column if not exists followup_max_touches int not null default 2;
alter table leads add column if not exists follow_ups_sent int not null default 0;
alter table leads add column if not exists last_contacted_at timestamptz;

-- ============================================================================
-- ACCOUNT: fila única con el plan de la cuenta.
-- Al crearse arranca un trial de 14 días del plan Pro; el backend consulta
-- esta tabla para aplicar los límites de cada plan.
-- ============================================================================
create table if not exists account (
  id int primary key default 1 check (id = 1),
  plan text not null default 'trial' check (plan in ('trial','free','pro','agency')),
  billing_cycle text check (billing_cycle in ('monthly','annual')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

insert into account (id) values (1) on conflict (id) do nothing;

alter table account enable row level security;

-- ============================================================================
-- RLS
-- El backend (service role) bypasea RLS. Estas políticas gobiernan el acceso
-- con la ANON key: por defecto NADA es visible sin usuario autenticado, y un
-- usuario autenticado solo ve sus propias campañas y datos asociados.
-- Nota: las campañas creadas desde el panel actual (sin auth) tienen
-- user_id NULL → invisibles vía anon key. Seguro por defecto.
-- ============================================================================
alter table campaigns enable row level security;
alter table leads enable row level security;
alter table emails_sent enable row level security;
alter table replies enable row level security;

drop policy if exists "own campaigns" on campaigns;
create policy "own campaigns" on campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "leads of own campaigns" on leads;
create policy "leads of own campaigns" on leads
  for all using (
    campaign_id in (select id from campaigns where user_id = auth.uid())
  ) with check (
    campaign_id in (select id from campaigns where user_id = auth.uid())
  );

drop policy if exists "emails of own leads" on emails_sent;
create policy "emails of own leads" on emails_sent
  for select using (
    lead_id in (
      select l.id from leads l
      join campaigns c on c.id = l.campaign_id
      where c.user_id = auth.uid()
    )
  );

drop policy if exists "replies of own leads" on replies;
create policy "replies of own leads" on replies
  for select using (
    lead_id in (
      select l.id from leads l
      join campaigns c on c.id = l.campaign_id
      where c.user_id = auth.uid()
    )
  );
