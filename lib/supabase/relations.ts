// lib/supabase/relations.ts
// ============================================================================
// Normalización de relaciones anidadas de PostgREST.
//
// EL PROBLEMA: en `select("*, campaigns(...)")` PostgREST devuelve la relación
// "a uno" como OBJETO, pero el inferidor de tipos de supabase-js a veces la
// declara como ARRAY (depende de si puede resolver la clave foránea). El código
// venía resolviéndolo con `as unknown as { … }`, que apaga la comprobación por
// completo: si la columna embebida cambia de nombre, nadie se entera.
//
// `toOne()` acepta ambas formas en runtime y conserva el tipo real, así que
// sigue habiendo verificación de nombres de campo.
// ============================================================================

/**
 * Devuelve el único elemento de una relación embebida, o null.
 * Acepta objeto (forma real de PostgREST) o array (forma que a veces infiere
 * el tipado) sin perder el tipo del elemento.
 */
export function toOne<T>(relation: T | T[] | null | undefined): T | null {
  if (relation == null) return null;
  if (Array.isArray(relation)) return relation.length > 0 ? relation[0] : null;
  return relation;
}

/**
 * Igual que `toOne()` pero exige que la relación exista.
 * Útil cuando la clave foránea es NOT NULL y su ausencia indica corrupción.
 */
export function requireOne<T>(relation: T | T[] | null | undefined, what: string): T {
  const value = toOne(relation);
  if (value == null) {
    throw new Error(`Relación obligatoria ausente: ${what}`);
  }
  return value;
}
