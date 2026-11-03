import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyApiCors } from '../_lib/cors';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(503).json({ error: 'Secure activity logging is not configured on the server.' });
  }

  const action = req.body?.action;
  if (action !== 'login' && action !== 'logout') {
    return res.status(400).json({ error: 'Hindi valid ang authentication event.' });
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Hindi valid ang session.' });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: 'Hindi valid ang session.' });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('is_active')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError) return res.status(500).json({ error: 'Hindi ma-verify ang account.' });
  if (!profile || profile.is_active === false) return res.status(403).json({ error: 'Hindi aktibo ang account.' });

  let sessionId: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { session_id?: unknown };
    if (typeof payload.session_id === 'string') sessionId = payload.session_id;
  } catch {
    return res.status(401).json({ error: 'Hindi mabasa ang session.' });
  }
  if (!sessionId) return res.status(401).json({ error: 'Walang session ID sa authentication token.' });

  const { error: insertError } = await adminClient.from('activity_logs').insert({
    actor_id: authData.user.id,
    actor_name: authData.user.user_metadata?.full_name || authData.user.email || 'User',
    farm_user_id: authData.user.id,
    session_id: sessionId,
    module: 'Authentication',
    action,
    entity_id: authData.user.id,
    entity_name: 'Account session',
    status: 'success',
    details: { source: 'web_app' },
  });
  if (insertError && insertError.code !== '23505') {
    return res.status(500).json({ error: 'Hindi na-save ang authentication activity.' });
  }

  return res.status(200).json({ success: true });
}
