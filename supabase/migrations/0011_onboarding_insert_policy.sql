-- ============================================================================
-- 0011 — El usuario puede crear su propia fila de progreso
--
-- MOTIVO: `onboarding_progress` sólo tenía políticas de SELECT y UPDATE. La
-- fila la creaba el trigger `handle_new_user` al registrarse, así que nadie
-- necesitaba insertar... hasta que el trigger no existía en el proyecto.
--
-- Sin fila, `update ... where user_id = ?` afecta a CERO filas y PostgREST lo
-- devuelve como éxito. El resultado observado:
--
--   · «Continuar» en el perfil de empresa no guardaba la oferta, la
--     investigación volvía a pedirla y la pantalla se repetía en bucle.
--   · «Saltar» no marcaba `dismissed_at`, así que el panel devolvía al
--     usuario al recorrido guiado una y otra vez.
--
-- El código ya no depende de esto (crea la fila con el cliente de servicio si
-- hace falta), pero con la política el camino normal no necesita escalar
-- privilegios. `with check` impone que sólo se pueda crear la fila propia.
-- ============================================================================

drop policy if exists "onboarding_insert_own" on onboarding_progress;
create policy "onboarding_insert_own" on onboarding_progress
  for insert with check (auth.uid() = user_id);

-- Filas que faltan por no haber existido el trigger cuando se registraron
insert into onboarding_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Lo mismo para las cuentas: sin fila, el plan cae a Free sin explicación
insert into accounts (user_id)
select id from auth.users
on conflict (user_id) do nothing;
