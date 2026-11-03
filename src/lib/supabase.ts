import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hhhagfydxhetspmudyrl.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaGFnZnlkeGhldHNwbXVkeXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MjQ2NzcsImV4cCI6MjEwMTUwMDY3N30.bD2aDdQ9g_ePgcCNSw008uuGR1_nl9n4IlNiPUZc_3E';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
