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
