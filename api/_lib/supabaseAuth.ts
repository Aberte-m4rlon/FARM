import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export type SupabaseAuthResult =
  | { ok: true; user: User; client: SupabaseClient }
  | { ok: false; status: 401 | 503; error: string };

export async function authenticateSupabaseRequest(
  authorization: string | string[] | undefined,
): Promise<SupabaseAuthResult> {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = typeof header === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(header) : null;
  if (!match) {
    return { ok: false, status: 401, error: 'A valid Supabase bearer token is required.' };
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    return { ok: false, status: 503, error: 'Authentication service is not configured.' };
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await client.auth.getUser(match[1]);
    if (error || !data.user) {
      const status = error?.status;
      if (status && status !== 401 && status !== 403) {
        console.error('[auth] Supabase user verification failed:', error.message);
        return { ok: false, status: 503, error: 'Authentication service is temporarily unavailable.' };
      }
      return { ok: false, status: 401, error: 'The Supabase bearer token is invalid or expired.' };
    }

    return { ok: true, user: data.user, client };
  } catch (error) {
    console.error('[auth] Supabase user verification request failed:', error);
    return { ok: false, status: 503, error: 'Authentication service is temporarily unavailable.' };
  }
}
