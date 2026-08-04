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
