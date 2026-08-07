-- ============================================================================
-- ESTE FICHERO YA NO SIRVE. USA `PONER-AL-DIA.sql`.
--
-- Se escribió partiendo de un diagnóstico equivocado: que las tablas existían
-- y sólo faltaban las funciones SQL. Al comprobarlo contra la base de datos
-- real resultó que faltan también las tablas — sólo está aplicada la migración
-- 0001. Ejecutar este fichero fallaría en su primera instrucción, porque
-- `alter table onboarding_progress` se refiere a una tabla que no existe.
--
--   Supabase → SQL Editor → New query → pegar supabase/PONER-AL-DIA.sql → Run
--
-- Ese otro fichero contiene las migraciones 0002 a 0011 en orden, es
-- idempotente y termina con una verificación de todo lo que debe existir.
-- ============================================================================

do $$
begin
  raise exception
    'Fichero obsoleto: ejecuta supabase/PONER-AL-DIA.sql en su lugar. Este partía de un diagnóstico incorrecto (creía que las tablas ya existían).';
end $$;
