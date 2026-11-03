/**
 * Public QR profile endpoint. Accepts only an unpredictable QR token and calls
 * a restricted database function that returns an explicit public-field list.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyApiCors } from './_lib/cors';

const DEFAULT_SUPABASE_URL = 'https://hhhagfydxhetspmudyrl.supabase.co';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const token = req.query.token;
  if (typeof token !== 'string' || !UUID_PATTERN.test(token.trim())) {
    res.status(400).json({ error: 'Hindi valid ang QR code.' });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) {
    res.status(503).json({ error: 'Hindi pansamantalang mabuksan ang public profile.' });
    return;
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('get_public_animal_profile', { p_token: token.trim() });
    if (error) {
      console.error('[public-animal] Profile lookup failed:', error.message);
      res.status(503).json({ error: 'Hindi pansamantalang mabuksan ang public profile.' });
      return;
    }

    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile || typeof profile !== 'object') {
      res.status(404).json({ error: 'Hindi mahanap ang Kambing/Tupa.' });
      return;
    }
    if ((profile as Record<string, unknown>).status === 'disabled') {
      res.status(410).json({ error: 'Hindi available ang public profile ng hayop.' });
      return;
    }
    res.status(200).json(profile);
  } catch (error) {
    console.error('[public-animal] Request failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(503).json({ error: 'Hindi pansamantalang mabuksan ang public profile.' });
  }
}
