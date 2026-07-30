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
