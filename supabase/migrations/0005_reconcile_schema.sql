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
