import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { applyApiCors } from '../_lib/cors';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function jsonError(res: VercelResponse, status: number, error: string) {
  res.status(status).json({ error });
}

async function fetchAllRows<T>(loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'Hindi ma-load ang talaan.');
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error('Masyadong malaki ang talaan para ma-load sa iisang request.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyApiCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return jsonError(res, 405, 'Method not allowed.');
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonError(res, 503, 'Secure user management is not configured on the server.');
  }

  const authorization = req.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonError(res, 401, 'Mag-sign in muli upang magpatuloy.');

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return jsonError(res, 401, 'Hindi valid ang session. Mag-sign in muli.');

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: requester, error: requesterError } = await adminClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (requesterError) return jsonError(res, 500, 'Hindi ma-verify ang administrator profile.');
  if (!requester || requester.is_active === false || !['system_admin', 'super_admin'].includes(requester.role)) {
    return jsonError(res, 403, 'Wala kang pahintulot para sa user management.');
  }

  if (req.method === 'PATCH') {
    if (requester.role !== 'super_admin') return jsonError(res, 403, 'Super Admin lang ang maaaring magbago ng account access.');
    const body = req.body || {};
    const targetId = typeof body.userId === 'string' ? body.userId : '';
    if (!targetId) return jsonError(res, 400, 'Kailangan ang user ID.');
    if (targetId === authData.user.id && (body.action === 'role' || body.isActive === false)) {
      return jsonError(res, 400, 'Hindi maaaring baguhin o i-deactivate ang sariling Super Admin account.');
    }

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', targetId)
      .maybeSingle();
    if (targetError) return jsonError(res, 500, 'Hindi ma-load ang user account.');
    if (!target) return jsonError(res, 404, 'Hindi makita ang user account.');

    if ((body.action === 'role' || body.isActive === false) && target.role === 'super_admin' && target.is_active !== false) {
      const { count, error: countError } = await adminClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true);
      if (countError) return jsonError(res, 500, 'Hindi ma-verify ang natitirang Super Admin accounts.');
      const removesSuperAdmin = body.action === 'role' && body.role !== 'super_admin';
      if ((removesSuperAdmin || body.isActive === false) && (count ?? 0) <= 1) {
        return jsonError(res, 409, 'Hindi maaaring alisin o i-deactivate ang huling aktibong Super Admin.');
      }
    }

    let update: Record<string, unknown>;
    if (body.action === 'role') {
      if (!['farm_manager', 'system_admin', 'super_admin'].includes(body.role)) {
        return jsonError(res, 400, 'Hindi valid ang role.');
      }
      update = { role: body.role, updated_at: new Date().toISOString() };
    } else if (body.action === 'active' && typeof body.isActive === 'boolean') {
      update = { is_active: body.isActive, updated_at: new Date().toISOString() };
    } else {
      return jsonError(res, 400, 'Hindi valid ang account update.');
    }

    const { error: updateError } = await adminClient.from('profiles').update(update).eq('id', targetId);
    if (updateError) return jsonError(res, 500, 'Hindi na-save ang pagbabago sa user account.');
    return res.status(200).json({ success: true });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (userId) {
    const [animals, weightRecords, vaccinations, settings] = await Promise.all([
      adminClient.from('animals').select('id,name,tag_id,species,breed,sex,weight_kg,vaccination_status,breeding_status,archived').eq('user_id', userId).eq('archived', false).order('name'),
      adminClient.from('weight_records').select('id,animal_id,record_date,weight_kg').eq('user_id', userId).is('archived_at', null).order('record_date', { ascending: false }).limit(20),
      adminClient.from('vaccinations').select('id,animal_id,vaccine_name,date_given,next_due_date').eq('user_id', userId).is('archived_at', null).order('date_given', { ascending: false }).limit(20),
      adminClient.from('settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    const detailError = animals.error || weightRecords.error || vaccinations.error || settings.error;
    if (detailError) return jsonError(res, 500, 'Hindi ma-load ang detalye ng bukid.');
    return res.status(200).json({
      animals: animals.data || [],
      weightRecords: weightRecords.data || [],
      vaccinations: vaccinations.data || [],
      settings: settings.data,
    });
  }

  try {
    const [authRows, profileRows, animalRows, settingRows] = await Promise.all([
      (async () => {
        type ListedAuthUser = NonNullable<Awaited<ReturnType<typeof adminClient.auth.admin.listUsers>>['data']>['users'][number];
        const rows: ListedAuthUser[] = [];
        for (let page = 1; page <= 100; page += 1) {
          const result = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
          if (result.error) throw result.error;
          rows.push(...result.data.users);
          if (result.data.users.length < 1000) return rows;
        }
        throw new Error('Masyadong maraming authentication account para ma-load.');
      })(),
      fetchAllRows((from, to) => adminClient.from('profiles').select('id,role,full_name,is_active,created_at,email').range(from, to)),
      fetchAllRows((from, to) => adminClient.from('animals').select('user_id').eq('archived', false).range(from, to)),
      fetchAllRows((from, to) => adminClient.from('settings').select('user_id,farm_name').range(from, to)),
    ]);

    const authById = new Map(authRows.map((user) => [user.id, user]));
    const countByUser = (rows: Array<{ user_id: string }>) => {
      const counts = new Map<string, number>();
      rows.forEach((row) => counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1));
      return counts;
    };
    const animalCounts = countByUser(animalRows);
    const farmNames = new Map(settingRows.map((row) => [row.user_id, row.farm_name]));
    const rows = profileRows.map((profile) => {
      const authUser = authById.get(profile.id);
      return {
        id: profile.id,
        email: authUser?.email || profile.email || `user-${profile.id.slice(0, 8)}`,
        created_at: authUser?.created_at || profile.created_at || '',
        last_sign_in_at: authUser?.last_sign_in_at || null,
        animal_count: animalCounts.get(profile.id) || 0,
        farm_name: farmNames.get(profile.id) || null,
        role: profile.role,
        is_active: profile.is_active ?? true,
        full_name: profile.full_name || null,
      };
    });

    return res.status(200).json({ users: rows });
  } catch (error) {
    console.error('[admin/users] Could not load user summaries:', error);
    return jsonError(res, 500, 'Hindi ma-load ang user accounts at farm summaries.');
  }
}
