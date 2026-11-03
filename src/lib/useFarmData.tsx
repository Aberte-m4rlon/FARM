import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from './supabase';
import { isSupabaseAuthUserId } from './supabaseIdentity';
import { useAuth } from './auth';
import type {
  Animal,
  HealthRecord,
  WeightRecord,
  BreedingRecord,
  Vaccination,
  InventoryItem,
  InventoryTransaction,
  InventoryUsageRecord,
  Notification,
  Recommendation,
  Settings,
  AnimalSale,
  HealthCase,
  TreatmentRecord,
  HealthAlert,
  MortalityRecord,
} from '../types';
import { fetchUserSales } from './sales';
import { isAnimalDeceased } from './animalLifecycle';

export interface FarmData {
  animals: Animal[];
  healthRecords: HealthRecord[];
  cameraHealthScreenings: any[];
  cameraHealthScreeningsAvailable: boolean;
  healthCases: HealthCase[];
  treatmentRecords: TreatmentRecord[];
  healthAlerts: HealthAlert[];
  weightRecords: WeightRecord[];
  breedingRecords: BreedingRecord[];
  breedingBirthCounts: any[];
  breedingBirthCountsAvailable: boolean;
  vaccinations: Vaccination[];
  inventory: InventoryItem[];
  inventoryTransactions: InventoryTransaction[];
  inventoryUsage: InventoryUsageRecord[];
  notifications: Notification[];
  recommendations: Recommendation[];
  sales: AnimalSale[];
  mortalityRecords: MortalityRecord[];
  settings: Settings | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
}

const EMPTY: FarmData = {
  animals: [],
  healthRecords: [],
  cameraHealthScreenings: [],
  cameraHealthScreeningsAvailable: false,
  healthCases: [],
  treatmentRecords: [],
  healthAlerts: [],
  weightRecords: [],
  breedingRecords: [],
  breedingBirthCounts: [],
  breedingBirthCountsAvailable: false,
  vaccinations: [],
  inventory: [],
  inventoryTransactions: [],
  inventoryUsage: [],
  notifications: [],
  recommendations: [],
  sales: [],
  mortalityRecords: [],
  settings: null,
  loading: true,
  loadError: null,
  refresh: async () => {},
};

function farmDataErrorMessage(error: unknown): string {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = typeof value.code === 'string' ? value.code : '';
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';

  if (code === '22P02' || /invalid input syntax for type uuid/.test(message)) {
    return 'Hindi valid na Supabase Auth UUID ang account na ginagamit sa database. Mag-sign in gamit ang naka-link na Supabase account.';
  }
  if (
    code === '42P01' || code === 'PGRST205' ||
    /relation .* does not exist|schema cache|could not find the table/.test(message)
  ) {
    return 'May kulang na Supabase database migration. Ilapat ang mga migration ng proyekto at subukan muli.';
  }
  if (code === '42501' || /permission denied|row-level security|not allowed/.test(message)) {
    return 'Hindi pinapayagan ng Supabase ang account na ito na basahin ang datos ng bukid. Suriin ang farm membership at RLS policy.';
  }
  return 'May ilang datos na hindi makuha. Subukang muli.';
}

function excludeArchived<T extends object>(rows: T[] | null): T[] {
  return (rows ?? []).filter((row) => !(row as { archived_at?: string | null }).archived_at);
}

const FarmDataContext = createContext<FarmData>(EMPTY);

export function FarmDataProvider({ children }: { children: ReactNode }) {
  const { user, profile, signOut } = useAuth();
  const [data, setData] = useState<FarmData>(EMPTY);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSuperAdmin = profile?.role === 'super_admin';

  const refresh = useCallback(async () => {
    if (!user) {
      setData({ ...EMPTY, loading: false });
      return;
    }

    if (!isSupabaseAuthUserId(user.id)) {
      setData({
        ...EMPTY,
        loading: false,
        loadError: 'Naka-sign in ang Google/Firebase account, pero wala itong Supabase database session. Mag-sign out at mag-sign in muli para ma-load at ma-save ang farm data.',
        refresh,
      });
      return;
    }

    try {
      let animalsQ = supabase.from('animals').select('*').order('created_at', { ascending: false });
      let healthQ = supabase.from('health_records').select('*').order('record_date', { ascending: false });
      let cameraHealthScreeningsQ = supabase.from('camera_health_screenings')
        .select('animal_id,visible_status,observed_concern,affected_area,recommendation,created_at')
        .order('created_at', { ascending: false }).limit(100);
      let healthCasesQ = supabase.from('health_cases').select('*').order('date_reported', { ascending: false });
      let treatmentRecordsQ = supabase.from('treatment_records').select('*').order('start_date', { ascending: false });
      let healthAlertsQ = supabase.from('health_alerts').select('*').in('alert_type', ['pending_vet_review', 'treatment_follow_up']).order('created_at', { ascending: false });
      let weightQ = supabase.from('weight_records').select('*').order('record_date', { ascending: false });
      let breedingQ = supabase.from('breeding_records').select('*').order('mating_date', { ascending: false });
      const breedingBirthCountsQ = supabase.rpc('get_farm_birth_counts');
      let vaccQ = supabase.from('vaccinations').select('*').order('date_given', { ascending: false });
      let inventoryQ = supabase.from('inventory').select('*').order('name', { ascending: true });
      let invTxQ = supabase.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(500);
      let invUsageQ = supabase.from('inventory_usage').select('*').order('usage_date', { ascending: false }).limit(500);
      let notifQ = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
      let recQ = supabase.from('recommendations').select('*').order('created_at', { ascending: false }).limit(50);
      let settingsQ = supabase.from('settings').select('*');
      let mortalityQ = supabase.from('mortality_records').select('*').order('date_of_death', { ascending: false });

      // Strict user data isolation: non-super_admin users only receive their own farm records
      if (!isSuperAdmin) {
        animalsQ = animalsQ.eq('user_id', user.id);
        healthQ = healthQ.eq('user_id', user.id);
        cameraHealthScreeningsQ = cameraHealthScreeningsQ.eq('user_id', user.id);
        healthCasesQ = healthCasesQ.eq('user_id', user.id);
        treatmentRecordsQ = treatmentRecordsQ.eq('user_id', user.id);
        healthAlertsQ = healthAlertsQ.eq('user_id', user.id);
        weightQ = weightQ.eq('user_id', user.id);
        breedingQ = breedingQ.eq('user_id', user.id);
        vaccQ = vaccQ.eq('user_id', user.id);
        inventoryQ = inventoryQ.eq('user_id', user.id);
        invTxQ = invTxQ.eq('user_id', user.id);
        invUsageQ = invUsageQ.eq('user_id', user.id);
        notifQ = notifQ.eq('user_id', user.id);
        recQ = recQ.eq('user_id', user.id);
        settingsQ = settingsQ.eq('user_id', user.id);
        mortalityQ = mortalityQ.eq('user_id', user.id);
      }

      const safeQuery = async <T,>(promise: PromiseLike<{ data: T | null; error: any }>) => {
        const res = await promise;
        if (res.error) throw res.error;
        return res.data ?? null;
      };

      const [
        animalsRes,
        healthRes,
        healthCasesData,
        treatmentRecordsData,
        healthAlertsData,
        weightRes,
        breedingRes,
        vaccRes,
        inventoryRes,
        invTxRes,
        invUsageRes,
        notifRes,
        recRes,
        settingsRes,
        salesRes,
        cameraHealthScreeningsData,
        breedingBirthCountsData,
        mortalityRes,
      ] = await Promise.all([
        animalsQ,
        healthQ,
        safeQuery<HealthCase[]>(healthCasesQ),
        safeQuery<TreatmentRecord[]>(treatmentRecordsQ),
        safeQuery<HealthAlert[]>(healthAlertsQ),
        weightQ,
        breedingQ,
        vaccQ,
        inventoryQ,
        invTxQ,
        invUsageQ,
        notifQ,
        recQ,
        settingsQ.maybeSingle(),
        fetchUserSales(user.id, isSuperAdmin),
        safeQuery<any[]>(cameraHealthScreeningsQ).catch(() => null),
        safeQuery<any[]>(breedingBirthCountsQ).catch(() => null),
        mortalityQ,
      ]);

      const queryResults = [animalsRes, healthRes, weightRes, breedingRes, vaccRes, inventoryRes, invTxRes, invUsageRes, notifRes, recRes, settingsRes, mortalityRes] as Array<{ error?: unknown }>;
      const failedQuery = queryResults.find((result) => Boolean(result.error));
      if (failedQuery) {
        console.error('Failed to refresh farm data; keeping last successful data.');
        setData((previous) => ({ ...previous, loading: false, loadError: farmDataErrorMessage(failedQuery.error) }));
        return;
      }

      const fallbackSettings: Settings = {
        id: 'default-settings-' + user.id,
        user_id: user.id,
        farm_name: profile?.full_name ? `${profile.full_name}'s Farm` : 'My Farm',
        target_weight_kg: 40,
        gestation_days: 150,
        expiry_warning_days: 15,
        vaccine_due_days: 30,
        breeding_min_age_months: 8,
        breeding_min_weight_kg: 25,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const salesData = (salesRes as AnimalSale[]) ?? [];
      const soldAnimalIds = new Set(salesData.map((s) => s.animal_id));

      const rawAnimals = (animalsRes.data as Animal[]) ?? [];
      const enrichedAnimals: Animal[] = rawAnimals.map((a) => {
        const isSold = Boolean(soldAnimalIds.has(a.id) || a.status === 'Sold' || a.is_sold);
        return {
          ...a,
          archived: Boolean(a.archived),
          status: isSold ? 'Sold' : (isAnimalDeceased(a) ? 'Deceased' : (a.archived ? 'Archived' : (a.status || 'Active'))),
          is_sold: isSold,
        };
      });

      setData({
        animals: enrichedAnimals,
        healthRecords: excludeArchived(healthRes.data as HealthRecord[] | null),
        cameraHealthScreenings: cameraHealthScreeningsData ?? [],
        cameraHealthScreeningsAvailable: cameraHealthScreeningsData !== null,
        healthCases: excludeArchived(healthCasesData as HealthCase[] | null),
        treatmentRecords: excludeArchived(treatmentRecordsData as TreatmentRecord[] | null),
        healthAlerts: excludeArchived(healthAlertsData as HealthAlert[] | null),
        weightRecords: excludeArchived(weightRes.data as WeightRecord[] | null),
        breedingRecords: excludeArchived(breedingRes.data as BreedingRecord[] | null),
        breedingBirthCounts: breedingBirthCountsData ?? [],
        breedingBirthCountsAvailable: breedingBirthCountsData !== null,
        vaccinations: excludeArchived(vaccRes.data as Vaccination[] | null),
        inventory: excludeArchived(inventoryRes.data as InventoryItem[] | null),
        inventoryTransactions: (invTxRes.data as InventoryTransaction[]) ?? [],
        inventoryUsage: excludeArchived(invUsageRes.data as InventoryUsageRecord[] | null),
        notifications: (notifRes.data as Notification[]) ?? [],
        recommendations: (recRes.data as Recommendation[]) ?? [],
        sales: salesData,
        mortalityRecords: (mortalityRes.data as MortalityRecord[]) ?? [],
        settings: (settingsRes.data as Settings) ?? fallbackSettings,
        loading: false,
        loadError: null,
        refresh,
      });
    } catch (err) {
      console.error('Error fetching farm data:', farmDataErrorMessage(err));
      setData((prev) => ({ ...prev, loading: false, loadError: farmDataErrorMessage(err) }));
    }
  }, [user, isSuperAdmin, profile?.full_name]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime multi-table listener to keep state instantly synced across all tabs / devices
  // Scoped to current user's user_id so changes from other farms are ignored
  useEffect(() => {
    if (!user) return;

    const debouncedRefresh = () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        refresh();
      }, 400);
    };

    const filter = isSuperAdmin ? undefined : `user_id=eq.${user.id}`;

    const channel = supabase
      .channel('alpasfarm:live_data:' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'animals', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_records', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_cases', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'treatment_records', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'health_alerts', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weight_records', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'breeding_records', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vaccinations', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_transactions', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_usage', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'animal_sales', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mortality_records', filter }, debouncedRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter }, debouncedRefresh)
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [user, isSuperAdmin, refresh]);

  return (
    <FarmDataContext.Provider value={data}>
      {data.loadError && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '12px 16px', margin: '0 0 12px', border: '1px solid rgba(220, 38, 38, .25)', borderRadius: 12, background: 'rgba(254, 242, 242, .96)', color: '#991b1b', fontSize: 13 }}>
          <span>{data.loadError}</span>
          {user && !isSupabaseAuthUserId(user.id) ? (
            <button type="button" onClick={async () => { await signOut(); window.location.assign('/login'); }} style={{ padding: '7px 11px', border: 0, borderRadius: 8, background: '#991b1b', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Mag-sign out at mag-sign in muli
            </button>
          ) : (
            <button type="button" onClick={() => void refresh()} style={{ padding: '7px 11px', border: '1px solid rgba(153, 27, 27, .3)', borderRadius: 8, background: '#fff', color: '#991b1b', fontWeight: 700, cursor: 'pointer' }}>
              Subukan muli
            </button>
          )}
        </div>
      )}
      {children}
    </FarmDataContext.Provider>
  );
}

/**
 * Access the shared farm data context.
 * Guarantees single source of truth across all pages and modules.
 */
export function useFarmData(): FarmData {
  const context = useContext(FarmDataContext);
  if (context === undefined || context === null) {
    throw new Error('useFarmData must be used within a FarmDataProvider');
  }
  return context;
}
