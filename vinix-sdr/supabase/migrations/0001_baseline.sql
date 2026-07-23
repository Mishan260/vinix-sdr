-- ============================================================================
-- 0001 — BASELINE: tablas núcleo del pipeline
-- Idempotente: se puede re-ejecutar sin romper nada.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Trigger genérico de updated_at ──────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── CAMPAIGNS ───────────────────────────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  base_template text not null default '',
  value_proposition text not null default '',
  sender_name text not null default '',
  sender_email text not null default '',
  daily_send_limit int not null default 20 check (daily_send_limit between 1 and 500),
  followups_enabled boolean not null default true,
  followup_delay_days int not null default 3 check (followup_delay_days between 1 and 30),
  followup_max_touches int not null default 2 check (followup_max_touches between 0 and 5),
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── LEADS ───────────────────────────────────────────────────────────────────
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 300),
  company_url text,
  contact_name text,
  contact_email text,
  contact_role text,

  research_sector text,
  research_size text,
  research_pain_point text,
  research_decision_maker text,
  research_raw jsonb,
  research_error text,

  draft_subject text,
  draft_body text,

  follow_ups_sent int not null default 0 check (follow_ups_sent >= 0),
  last_contacted_at timestamptz,

  status text not null default 'pending' check (status in (
    'pending', 'researching', 'research_failed', 'ready_to_send',
    'sent', 'replied', 'interested', 'not_interested', 'out_of_scope', 'meeting_booked'
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── EMAILS_SENT ─────────────────────────────────────────────────────────────
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

-- ── REPLIES ─────────────────────────────────────────────────────────────────
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
  review_reason text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Migraciones suaves desde versiones anteriores del esquema ────────────────
alter table campaigns add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table campaigns add column if not exists followups_enabled boolean not null default true;
alter table campaigns add column if not exists followup_delay_days int not null default 3;
alter table campaigns add column if not exists followup_max_touches int not null default 2;
alter table campaigns add column if not exists daily_send_limit int not null default 20;
alter table campaigns add column if not exists updated_at timestamptz not null default now();
alter table leads add column if not exists follow_ups_sent int not null default 0;
alter table leads add column if not exists last_contacted_at timestamptz;

-- replies.lead_id debe ser CASCADE (al borrar un lead se borran sus respuestas)
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

-- ── Índices ─────────────────────────────────────────────────────────────────
create index if not exists idx_campaigns_user on campaigns(user_id);
create index if not exists idx_campaigns_user_status on campaigns(user_id, status);
create index if not exists idx_leads_campaign on leads(campaign_id);
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_campaign_status on leads(campaign_id, status);
create index if not exists idx_leads_created on leads(created_at desc);
-- Consulta caliente de follow-ups: campaña + estado + antigüedad de contacto
create index if not exists idx_leads_followup_due on leads(campaign_id, status, last_contacted_at)
  where status = 'sent';
-- Lista de supresión: búsqueda por email en minúsculas
create index if not exists idx_leads_email_lower on leads(lower(contact_email))
  where contact_email is not null;
create index if not exists idx_emails_provider_msg on emails_sent(provider_message_id);
create index if not exists idx_emails_lead on emails_sent(lead_id);
create index if not exists idx_emails_campaign_sent on emails_sent(campaign_id, sent_at desc);
create index if not exists idx_replies_lead on replies(lead_id);
create index if not exists idx_replies_created on replies(created_at desc);
create index if not exists idx_replies_review on replies(flagged_for_review) where flagged_for_review = true;

-- ── Triggers de updated_at ──────────────────────────────────────────────────
drop trigger if exists trg_leads_updated on leads;
create trigger trg_leads_updated before update on leads
  for each row execute function set_updated_at();

drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();
