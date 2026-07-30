// lib/supabase/types.ts
// ============================================================================
// Alias del cliente de Supabase ya parametrizado con el esquema.
//
// Todo el código que reciba un cliente por parámetro debe tipar
// `TypedSupabaseClient` en lugar de `SupabaseClient` a secas: es lo que hace
// que `.from("campaigns").update({ … })` valide los nombres de columna en
// tiempo de compilación.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

export type { Database };
