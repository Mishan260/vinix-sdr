// tests/setup.ts
// ============================================================================
// Entorno mínimo para los tests unitarios. Se definen valores sintéticos para
// que getEnv() valide sin necesidad de un .env real ni de servicios externos.
// ============================================================================

process.env.SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.OPENAI_API_KEY ??= "sk-test";
process.env.LOG_LEVEL ??= "error"; // silencia los logs informativos en la salida
