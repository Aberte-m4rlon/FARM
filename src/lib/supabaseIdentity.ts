const SUPABASE_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supabase-backed tables use auth.users UUIDs as their owner IDs. */
export function isSupabaseAuthUserId(value: unknown): value is string {
  return typeof value === 'string' && SUPABASE_USER_ID_PATTERN.test(value);
}
