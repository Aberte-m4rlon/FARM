import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Cache-Control': 'no-store',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
  }

  const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  if (!UUID_PATTERN.test(token)) {
    return Response.json({ error: 'Hindi valid ang QR code.' }, { status: 400, headers: corsHeaders });
  }

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!projectUrl || !anonKey) {
    return Response.json({ error: 'Hindi pansamantalang mabuksan ang public profile.' }, { status: 503, headers: corsHeaders });
  }

  try {
    const supabase = createClient(projectUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('get_public_animal_profile', { p_token: token });
    if (error) {
      console.error('Public QR lookup failed.');
      return Response.json({ error: 'Hindi pansamantalang mabuksan ang public profile.' }, { status: 503, headers: corsHeaders });
    }
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile || typeof profile !== 'object') {
      return Response.json({ error: 'Hindi mahanap ang Kambing/Tupa.' }, { status: 404, headers: corsHeaders });
    }
    if ((profile as Record<string, unknown>).status === 'disabled') {
      return Response.json({ error: 'Hindi available ang public profile ng hayop.' }, { status: 410, headers: corsHeaders });
    }
    return Response.json(profile, { status: 200, headers: corsHeaders });
  } catch {
    console.error('Public QR request could not be completed.');
    return Response.json({ error: 'Hindi pansamantalang mabuksan ang public profile.' }, { status: 503, headers: corsHeaders });
  }
});
