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
