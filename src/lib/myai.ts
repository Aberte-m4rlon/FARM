import { supabase } from './supabase';
import { isAnimalActive } from './animalLifecycle';

/**
 * MyAI — AI provider abstraction for AlpasFarm
 *
 * LOCAL DEVELOPMENT (VITE_AI_MODE=local):
 *   Browser → an explicitly configured Ollama URL
 *
 * PRODUCTION  (VITE_AI_MODE=production, or env not set):
 *   Browser → POST /api/ai/chat (ALPASFARM API server) → AI provider
 *   The Groq API key is NEVER exposed to the browser.
 *   Set GROQ_API_KEY in the server-side environment for the ALPASFARM API.
 *
 * Farm context is built from Supabase data already loaded by the
 * authenticated user's session.
 */

// ── Provider detection ────────────────────────────────────────────────────────
export type AIMode = 'local' | 'production';

export const AI_MODE: AIMode =
  import.meta.env.DEV && (import.meta.env.VITE_AI_MODE as AIMode) === 'local' ? 'local' : 'production';

// Local Ollama is only enabled in development and requires an explicit URL.
const OLLAMA_URL   = ((import.meta.env.VITE_OLLAMA_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? 'qwen2.5:1.5b';

// Production endpoint — the ALPASFARM API server holds provider keys.
// NEVER call Groq directly from the browser — CORS + key exposure
const AI_CHAT_ENDPOINT = '/api/ai/chat';

// Supabase Edge Function fallback (if deployed)
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const EDGE_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-chat` : null;

export const MYAI_MODEL = AI_MODE === 'local' ? OLLAMA_MODEL : 'MyAI Cloud';

async function getSupabaseAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) throw new Error('Mag-login sa Supabase para magamit ang AI assistant.');
  return session.access_token;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MyAIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: string; // base64 data URL for attached images
  timestamp: number;
}

/**
 * Utility to downscale and compress images on the client before storing/uploading
 */
export async function compressImageFile(file: File | Blob, maxDim = 800, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) {
        reject(new Error('Failed to read image file'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface MyAIConversation {
  id: string;
  title: string;
  messages: MyAIMessage[];
  createdAt: number;
  updatedAt: number;
}

export type AIStatus =
  | 'checking'
  | 'online'        // local Ollama running + model present
  | 'offline'       // local Ollama not running
  | 'no_model'      // Ollama running but model missing
  | 'production'    // production mode — always available
  | 'unavailable';  // production endpoint returned an error

// ── Status check ──────────────────────────────────────────────────────────────
export async function checkAIStatus(): Promise<AIStatus> {
  // Local mode: test Ollama directly
  if (AI_MODE === 'local') {
    if (!OLLAMA_URL) return 'offline';
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const data = await r.json();
        const models: string[] = (data.models || []).map((m: { name: string }) => m.name);
        const hasModel = models.some((m) => m.includes(OLLAMA_MODEL.split(':')[0]));
        return hasModel ? 'online' : 'no_model';
      }
      return 'offline';
    } catch {
      return 'offline';
    }
  }

  // Probe the authenticated ALPASFARM API endpoint.
  // A 503 means provider configuration is missing; 404 means the route is unavailable.
  try {
    const accessToken = await getSupabaseAccessToken();
    const r = await fetch(AI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messages: [] }),   // empty → 400 (not 503) when key exists
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 400 || r.status === 200) return 'production';
    if (r.status === 503) return 'unavailable';
    if (r.status === 404) return 'unavailable';
    if (r.status === 429) return 'production';    // rate limited but reachable
    return 'production';   // other codes still mean the endpoint is there
  } catch {
    return 'unavailable';
  }
}

export const SYSTEM_PROMPT = `You are MyAI, the friendly and knowledgeable AI Farm Assistant for ALPASFARM — an Intelligent Goat & Sheep Farm Management System designed specifically for Filipino livestock farmers.

TONE & SPEAKING STYLE:
- Talk like a helpful, respectful, and practical agricultural consultant who knows Philippine backyard and commercial farming conditions.
- Speak in simple, natural Filipino/Taglish (everyday conversational Filipino mixed with common English farm terms).
- NEVER use intimidating computer jargon, complex statistical formulas, or overly academic medical words when simple explanations work.
- Use familiar Philippine livestock context:
  * Breeds: Native, Anglo-Nubian, Boer, Saanen, Kalahari Red, Philippine Sheep.
  * Housing & Management: kulungan, breeding, vaccination, treatment, and inventory records.

YOUR CAPABILITIES IN ALPASFARM:
1. Pamamahala ng Kambing at Tupa: goats, sheep, eartags, saved weights, breeding, and lifecycle records.
2. Camera Monitoring: camera tracking, eartag-number OCR verified gate events, legacy QR events, at limited movement observations mula sa aktuwal na tala ng bukid.
3. Treatment Records (Mga Tala ng Paggamot): aktuwal na gamutan, paggamit ng gamot, obserbasyon, at naitalang tala sa kalusugan; hindi ito diagnosis.
4. Pagpapalahi (Breeding): 150-araw na pagbubuntis, inaasahang panganganak, at kahandaan ng inahin sa barako.
5. Mga Bakuna: saved vaccine dates and next-due records.
6. Imbentaryo ng Bukid: gamot, health supplies, equipment, at iba pang aktuwal na stock records.

MAHAHALAGANG TUNTUNIN SA KALUSUGAN AT GABAY:
- Ikaw ay katulong sa pag-oobserba at pamamahala ng bukid, HINDI isang klinikal na beterinaryo.
- Huwag kailanman magbigay ng pinal na medikal na diagnosis. Palaging paalalahanan ang magsasaka na kumonsulta sa lisensyadong beterinaryo kung malala o lumalala ang sintomas ng alaga.
- Gamitin ang tunay na datos ng bukid na ibinibigay sa pag-uusap na ito. Huwag mag-imbento o mag-hallucinate ng mga kambing, tupa, tala, o numero na wala sa talaan.
- Para sa tanong tungkol sa gate, gamitin lamang ang [CAMERA MONITORING] records. Ihiwalay ang na-save na QR events sa pansamantalang live camera tracks; walang persisted visible count kung hindi ito kasama sa datos.
- Ang "hindi pa nakumpirma sa loob" ay hindi permanenteng nawawala. Huwag magbigay ng pangalan kung walang animal ID sa kasalukuyang reconciliation.
- Kung wala sa talaan ang hinahanap, sabihin nang tapat: "Wala po sa kasalukuyang talaan ng AlpasFarm ang impormasyong iyan."
- Panatilihing maikli, diretso sa punto, at madaling basahin ang mga sagot gamit ang mga bullet points.`;

// ── Farm context builder ──────────────────────────────────────────────────────
export function buildFarmContext(
  farmData: {
    animals: any[];
    healthRecords: any[];
    cameraHealthScreenings?: any[];
    cameraHealthScreeningsAvailable?: boolean;
    treatmentRecords: any[];
    inventoryUsage: any[];
    healthCases?: any[];
    healthAlerts?: any[];
    weightRecords: any[];
    breedingRecords: any[];
    breedingBirthCounts?: any[];
    breedingBirthCountsAvailable?: boolean;
    vaccinations: any[];
    inventory: any[];
    settings: any | null;
    sales?: any[]; // animal sales records
    gateMonitoring?: {
      session: any | null;
      summary: any | null;
      events: any[];
      crossings: any[];
      cameraMetrics: any | null;
      dailyMetrics?: any | null;
      liveTracks: any[];
      alerts: any[];
      available: boolean;
      loading: boolean;
    };
  },
  question: string,
): string {
  const q = question.toLowerCase();
  const requestedProfileAnimalId = question.match(/internal (?:animal )?id[:\s]+([0-9a-f-]{36})/i)?.[1]?.toLowerCase() ?? null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const active = farmData.animals.filter(isAnimalActive);
  const nm: Record<string, string> = {};
  farmData.animals.forEach((a) => { nm[a.id] = `${a.eartag_number == null ? a.tag_id : a.eartag_number} — ${a.name} (${a.tag_id}) [internal animal ID: ${a.id}]`; });
  const lines: string[] = [];

  if (/gate|camera monitoring|nakabalik|nakita sa gate|huling na-scan|huling nakita|last seen|unaccounted|hindi pa nakita|hindi nakita|qr.*scan|scan.*qr|gate entry|pumasok|pasok|entered|entries|entry|lumabas|movement observation|\breturn(ed)?\b|reconcil|kumpleto|complete/.test(q)) {
    const monitoring = farmData.gateMonitoring;
    if (!monitoring || monitoring.loading) {
      lines.push('\n[CAMERA MONITORING] Hindi pa kumpleto ang pagkuha ng monitoring records. Huwag magbigay ng bilang o pangalan hangga’t wala ang datos.');
    } else if (!monitoring.available) {
      lines.push('\n[CAMERA MONITORING] Hindi mabasa ang gate records ng account na ito. Sabihin sa user na subukan muli; huwag gumawa ng sagot mula sa lumang datos.');
    } else if (!monitoring.session) {
      lines.push('\n[CAMERA MONITORING] Wala pang naka-save na kasalukuyang monitoring session.');
      if (monitoring.dailyMetrics) {
        const daily = monitoring.dailyMetrics;
        lines.push(`Today's saved gate crossings in Philippine time (${daily.day}): ${daily.goat_entry_count} goats and ${daily.sheep_entry_count} sheep entered (${daily.total_entry_count} total); ${daily.goat_exit_count} goats and ${daily.sheep_exit_count} sheep exited (${daily.total_exit_count} total). These are confirmed database crossing records and include unidentified animals.`);
      } else {
        lines.push('Hindi available ang daily gate count sa database; huwag magbigay ng bilang.');
      }
    } else {
      const session = monitoring.session;
      const summary = monitoring.summary;
      const activeById = new Map(active.map((animal) => [animal.id, animal]));
      const animalName = (id: string) => {
        const animal = activeById.get(id);
        return animal ? `${animal.eartag_number == null ? animal.tag_id : animal.eartag_number} — ${animal.name} (${animal.tag_id})` : 'Hindi na aktibo o wala sa kasalukuyang tala';
      };
      const insideIds: string[] = summary?.inside_animal_ids ?? [];
      const unaccountedIds: string[] = summary?.unaccounted_animal_ids ?? [];
      const confirmedIds: string[] = summary?.confirmed_animal_ids ?? [];
      const verifiedEvents = monitoring.events.filter((event) => event.qr_verified || event.eartag_verified);
      const liveGoats = monitoring.liveTracks.filter((track) => track.species_detected === 'goat').length;
      const liveSheep = monitoring.liveTracks.filter((track) => track.species_detected === 'sheep').length;
      const daily = monitoring.dailyMetrics;
      const observations = monitoring.alerts.filter((alert) => alert.alert_type === 'movement_observation' && alert.status !== 'resolved');
      lines.push(`\n[CAMERA MONITORING] Saved session ${session.id} (${session.status}) started ${session.started_at}. Expected snapshot: ${session.expected_count}.`);
      lines.push(`Current database reconciliation: ${insideIds.length} confirmed inside, ${confirmedIds.length} uniquely identified, ${unaccountedIds.length} not currently confirmed inside.`);
      lines.push(`Current live detections saved to the database: ${monitoring.cameraMetrics?.live_track_count ?? monitoring.liveTracks.length} temporary tracks (${monitoring.cameraMetrics?.live_goat_count ?? liveGoats} goats, ${monitoring.cameraMetrics?.live_sheep_count ?? liveSheep} sheep); total saved camera crossings: ${monitoring.cameraMetrics?.crossing_count ?? monitoring.crossings.length}, crossings without verified animal identity: ${monitoring.cameraMetrics?.unidentified_crossing_count ?? monitoring.crossings.filter((crossing) => !crossing.qr_verified && !crossing.eartag_verified).length}.`);
      if (monitoring.crossings.length) {
        lines.push('Latest confirmed camera crossings in this session:');
        monitoring.crossings.slice(0, 10).forEach((crossing) => {
          const identity = crossing.animal_id ? animalName(crossing.animal_id) : 'Hindi pa nakikilala';
          lines.push(`  ${crossing.species_detected} | ${crossing.direction} | ${crossing.created_at} | ${identity}`);
        });
      }
      if (daily) {
        lines.push(`Today's saved gate crossings in Philippine time (${daily.day}): ${daily.goat_entry_count} goats and ${daily.sheep_entry_count} sheep entered (${daily.total_entry_count} total); ${daily.goat_exit_count} goats and ${daily.sheep_exit_count} sheep exited (${daily.total_exit_count} total). These are confirmed database crossing records and include unidentified animals.`);
      } else {
        lines.push('Hindi available ang hiwalay na bilang ng gate entries ngayong araw; huwag gamitin ang session total bilang daily total.');
      }
      lines.push('Unaccounted in this reconciliation (do not call permanently missing): ' + (unaccountedIds.length ? unaccountedIds.map(animalName).join('; ') : 'none'));
      if (verifiedEvents.length) {
        lines.push('Latest verified gate events (eartag OCR or legacy QR):');
        verifiedEvents.slice(0, 10).forEach((event) => lines.push(`  ${animalName(event.animal_id)} | ${event.eartag_verified ? `eartag number ${event.eartag_number}` : 'legacy QR'} | ${event.direction} | ${event.created_at} | ${event.movement_observation || 'no movement note'}`));
      } else {
        lines.push('Wala pang verified eartag-number or legacy QR gate event sa session na ito.');
      }
      if (observations.length) {
        lines.push('Open movement observations (screening lang, hindi diagnosis):');
        observations.slice(0, 10).forEach((alert) => lines.push(`  ${animalName(alert.animal_id)} | ${alert.created_at} | ${alert.message}`));
      } else {
        lines.push('Walang aktibong movement-observation alert sa session na ito.');
      }
    }
  }

  // Always include animals summary
  lines.push(`[FARM DATA] Date: ${today}`);
  lines.push(`[ANIMALS] ${active.length} active animals:`);
  active.forEach((a) => {
    let line = `  ${a.eartag_number == null ? a.tag_id : `number ${a.eartag_number}`} — ${a.name} (${a.tag_id}) | ${a.species} ${a.breed ?? '?'} | ${a.sex}`;
    if (a.weight_kg) line += ` | ${a.weight_kg}kg`;
    line += ' | vaccination:' + a.vaccination_status + ' | breeding:' + a.breeding_status;
    if (a.expected_kidding_date) line += ` | kidding:${a.expected_kidding_date}`;
    lines.push(line);
  });

  // Health records
  if (!requestedProfileAnimalId && /health|sick|risk|ill|disease|fever|kalusugan|lagnat|check|suriin|anomal|condition|attention|critical/.test(q)) {
    const recent = farmData.healthRecords.slice(0, 15);
    if (recent.length > 0) {
      lines.push(`\n[HEALTH RECORDS] Last ${recent.length}:`);
      recent.forEach((r) => {
        const observation = r.notes?.trim() || '';
        lines.push(`  ${nm[r.animal_id] ?? '?'} | ${r.record_date}${observation ? ` | farmer note:${observation}` : ' | saved legacy record; no note available'}`);
      });
    }
    if (farmData.cameraHealthScreeningsAvailable === false) {
      lines.push('\n[AI VISUAL HEALTH SCREENINGS] Hindi mabasa ang bagong screening history sa database; huwag maghinuha na walang screening.');
    } else {
      const screenings = farmData.cameraHealthScreenings ?? [];
      if (screenings.length) {
        lines.push(`\n[AI VISUAL HEALTH SCREENINGS] Last ${Math.min(screenings.length, 15)} saved results (visual screening only, not veterinary diagnosis):`);
        screenings.slice(0, 15).forEach((record) => {
          lines.push(`  ${nm[record.animal_id] ?? 'Hayop na wala na sa aktibong tala'} | ${record.created_at} | status:${record.visible_status ?? 'not recorded'} | visible concern:${record.observed_concern ?? 'none recorded'}${record.affected_area ? ` | area:${record.affected_area}` : ''}${record.recommendation ? ` | next step:${record.recommendation}` : ''}`);
        });
      } else {
        lines.push('\n[AI VISUAL HEALTH SCREENINGS] Wala pang na-save na AI visual health screening sa talaan.');
      }
    }
  }

  if (!requestedProfileAnimalId && /treatment|medicine|gamot|gamutan/.test(q)) {
    const treatments = farmData.treatmentRecords ?? [];
    const uses = farmData.inventoryUsage ?? [];
    lines.push('\n[TREATMENT RECORDS] ' + treatments.length + ' saved treatment records; ' + uses.length + ' saved inventory-use records:');
    treatments.slice(0, 15).forEach((record: any) => {
      const animal = nm[record.animal_id] ?? 'Hindi naka-link sa aktibong hayop';
      const dosage = [record.dosage, record.unit].filter(Boolean).join(' ');
      lines.push('  ' + animal + ' | ' + record.medicine_name + ' | ' + record.status + ' | ' + (dosage || 'dose not recorded') + ' | ' + record.start_date + (record.end_date ? ' to ' + record.end_date : ''));
    });
    uses.slice(0, 15).forEach((record: any) => {
      const animal = nm[record.animal_id] ?? 'Hindi naka-link sa aktibong hayop';
      const item = farmData.inventory.find((inventoryItem: any) => inventoryItem.id === record.inventory_id);
      const dosage = record.dosage || [record.quantity_used, record.unit].filter(Boolean).join(' ');
      lines.push('  ' + animal + ' | ' + (item?.name ?? 'Inventory item') + ' | ' + (record.treatment_status ?? record.reason ?? 'usage recorded') + ' | ' + dosage + ' | ' + record.usage_date);
    });
  }

  // Vaccinations
  if (/vaccin|bakun|overdue|shot|immuniz|due/.test(q)) {
    const overdue = farmData.vaccinations.filter((v: any) => {
      const ndd = v.next_due_date;
      return ndd && ndd < today;
    });
    const dueSoon = farmData.vaccinations.filter((v: any) => {
      const ndd = v.next_due_date;
      if (!ndd || ndd < today) return false;
      return (new Date(ndd).getTime() - Date.now()) / 86400000 <= 30;
    });
    lines.push(`\n[VACCINATIONS] ${overdue.length} overdue, ${dueSoon.length} due soon:`);
    [...overdue, ...dueSoon].slice(0, 15).forEach((v: any) => {
      const status = v.next_due_date && v.next_due_date < today ? 'OVERDUE' : 'DUE_SOON';
      lines.push(
        `  ${nm[v.animal_id] ?? '?'} | ${v.vaccine_name} | given:${v.date_given} | next:${v.next_due_date ?? '?'} | ${status}`,
      );
    });
  }

  // Breeding
  if (/breed|pregnant|kidding|mating|buntis|birth|offspring|gestation|nanganak|panganganak|panganak/.test(q)) {
    lines.push(`\n[BREEDING] ${farmData.breedingRecords.length} records:`);
    farmData.breedingRecords.slice(0, 15).forEach((r: any) => {
      lines.push(
        `  ${nm[r.animal_id] ?? '?'} | ${r.status} | mated:${r.mating_date} | expected_kidding:${r.expected_kidding_date ?? 'none'}`,
      );
    });
    if (farmData.breedingBirthCountsAvailable === false) {
      lines.push('Completed birth records are not available from the database right now; do not estimate the number of births from pregnancies or breeding attempts.');
    } else {
      const completedBirthCounts = farmData.breedingBirthCounts ?? [];
      const femaleAnimals = farmData.animals.filter((animal) => /female|inahin|babae/i.test(String(animal.sex ?? '')));
      const namedFemales = femaleAnimals.filter((animal) => {
        const name = String(animal.name ?? '').toLocaleLowerCase();
        const tag = String(animal.eartag_number ?? animal.tag_id ?? '').toLocaleLowerCase();
        return (name.length > 1 && q.includes(name)) || (tag.length > 0 && q.includes(tag));
      });
      const animalsToReport = namedFemales.length ? namedFemales : femaleAnimals.slice(0, 20);
      lines.push('Completed births by actual successful birth event only (pregnancy and breeding attempts are excluded):');
      animalsToReport.forEach((animal) => {
        const count = completedBirthCounts.find((record) => record.mother_id === animal.id);
        lines.push(`  ${nm[animal.id] ?? animal.name} | completed births:${count?.birth_count ?? 0}${count?.last_birth_date ? ` | last birth:${count.last_birth_date}` : ''}`);
      });
      if (!animalsToReport.length) lines.push('Walang babaeng Kambing/Tupa sa kasalukuyang talaan.');
    }
  }

  // Weight
  if (/weight|grow|gain|timbang|market|heavy|light/.test(q)) {
    lines.push(`\n[WEIGHT RECORDS] Last ${Math.min(farmData.weightRecords.length, 20)}:`);
    farmData.weightRecords.slice(0, 20).forEach((r: any) => {
      const gain = r.daily_gain_kg ? ` | gain:${r.daily_gain_kg}kg/day` : '';
      lines.push(`  ${nm[r.animal_id] ?? '?'} | ${r.record_date} | ${r.weight_kg}kg${gain}`);
    });
  }

  // Animal Sales
  const sales = farmData.sales ?? [];
  if (
    /sale|sold|benta|nabenta|kita|tubo|buyer|bumili|presyo|halaga|income|revenue|bayad|utang|balance/.test(q) ||
    sales.length > 0
  ) {
    const totalSold = sales.length;
    const totalRevenue = sales.reduce((s: number, r: any) => s + Number(r.selling_price || 0), 0);
    const totalReceived = sales.reduce((s: number, r: any) => s + Number(r.amount_received || 0), 0);
    const totalBalance = sales.reduce((s: number, r: any) => s + Number(r.remaining_balance || 0), 0);

    lines.push(
      `\n[ANIMAL SALES] ${totalSold} animals sold | Total Sold: ₱${totalRevenue.toFixed(2)} | Received: ₱${totalReceived.toFixed(2)} | Remaining Balance: ₱${totalBalance.toFixed(2)}:`,
    );

    sales.slice(0, 15).forEach((s: any) => {
      const aname = nm[s.animal_id] ?? 'Animal';
      lines.push(
        `  ${aname} | Sold: ${s.sale_date} | Weight: ${s.sold_weight}kg | Price: ₱${s.selling_price} (₱${s.price_per_kg || 0}/kg) | Buyer: ${s.buyer_name || 'N/A'} | Status: ${s.payment_status} | Received: ₱${s.amount_received} | Bal: ₱${s.remaining_balance}`,
      );
    });
  }

  // Inventory
  if (/inventory|stock|supply|medicine|expired|gamot|kulang/.test(q)) {
    const lowStock = farmData.inventory.filter(
      (i: any) => Number(i.quantity) <= Number(i.minimum_stock),
    );
    const expired = farmData.inventory.filter(
      (i: any) => i.expiry_date && i.expiry_date < today,
    );
    lines.push(
      `\n[INVENTORY] ${farmData.inventory.length} items, ${lowStock.length} low stock, ${expired.length} expired:`,
    );
    farmData.inventory.forEach((i: any) => {
      const flags: string[] = [];
      if (Number(i.quantity) <= Number(i.minimum_stock)) flags.push('LOW_STOCK');
      if (i.expiry_date && i.expiry_date < today) flags.push('EXPIRED');
      lines.push(
        `  ${i.name} | ${i.category} | ${i.quantity}${i.unit} min:${i.minimum_stock}${flags.length ? ' | [ALERT] ' + flags.join(',') : ''}`,
      );
    });
  }

  // Farm settings (always append if available)
  if (farmData.settings) {
    lines.push(
      `\n[FARM SETTINGS] Farm:${farmData.settings.farm_name} | target_weight:${farmData.settings.target_weight_kg}kg | gestation:${farmData.settings.gestation_days}days`,
    );
  }

  const profileId = requestedProfileAnimalId;
  if (profileId) {
    // Profile consultations must not receive unrelated animals' records from the general farm context.
    lines.length = 0;
    const profileData = farmData as any;
    const animal = profileData.animals.find((record: any) => String(record.id).toLowerCase() === profileId);
    if (!animal) {
      lines.push('[ANIMAL PROFILE] No authorized registry record for this exact internal animal ID. Do not guess by name or visible tag.');
    } else {
      lines.push('[ANIMAL PROFILE — EXACT INTERNAL ID ' + animal.id + '] eartag number ' + (animal.eartag_number ?? 'not recorded') + ' | ' + animal.tag_id + ' — ' + animal.name);
      lines.push('Species: ' + animal.species + ' | breed: ' + (animal.breed || 'not recorded') + ' | sex: ' + animal.sex + ' | birth: ' + (animal.date_of_birth || 'not recorded') + ' | saved weight: ' + (animal.weight_kg ?? 'not recorded') + ' kg | archived: ' + Boolean(animal.archived));
      lines.push('Last camera seen: ' + (animal.camera_last_seen_at || 'not recorded') + ' | last eartag OCR: ' + (animal.camera_last_eartag_at || 'not recorded') + ' | legacy QR field: ' + (animal.camera_last_qr_at || 'not recorded'));
      const linked = (rows: any[] | undefined, foreignKey = 'animal_id') => (rows ?? []).filter((row) => row[foreignKey] === animal.id);
      const health = linked(profileData.healthRecords).slice(0, 8);
      const cameraScreenings = (profileData.cameraHealthScreenings ?? []).filter((row: any) => row.animal_id === animal.id).slice(0, 8);
      const cases = linked(profileData.healthCases).slice(0, 8);
      const treatments = linked(profileData.treatmentRecords).slice(0, 8);
      const medicineUsage = linked(profileData.inventoryUsage).slice(0, 8);
      const vaccinations = linked(profileData.vaccinations).slice(0, 8);
      const breeding = (profileData.breedingRecords ?? []).filter((row: any) => row.animal_id === animal.id || row.partner_id === animal.id).slice(0, 8);
      const birthCountsAvailable = profileData.breedingBirthCountsAvailable !== false;
      const birthCount = (profileData.breedingBirthCounts ?? []).find((row: any) => row.mother_id === animal.id);
      const weights = linked(profileData.weightRecords).slice(0, 8);
      const sales = (profileData.sales ?? []).filter((row: any) => row.animal_id === animal.id).slice(0, 5);
      const healthAlerts = linked(profileData.healthAlerts).slice(0, 8);
      const inventory = (profileData.inventoryTransactions ?? []).filter((row: any) => row.reference_type === 'animal' && row.reference_id === animal.id).slice(0, 8);
      const gateEvents = (profileData.gateMonitoring?.events ?? []).filter((row: any) => row.animal_id === animal.id).slice(0, 8);
      const crossings = (profileData.gateMonitoring?.crossings ?? []).filter((row: any) => row.animal_id === animal.id).slice(0, 8);
      const alerts = (profileData.gateMonitoring?.alerts ?? []).filter((row: any) => row.animal_id === animal.id).slice(0, 8);
      lines.push('Saved farmer notes: ' + (health.length ? health.map((row: any) => row.record_date + ' | ' + (row.notes?.trim() || 'legacy record; no note available')).join(' || ') : 'none found'));
      lines.push('AI visual health screenings: ' + (profileData.cameraHealthScreeningsAvailable === false
        ? 'not available from the database right now; do not assume there are no records'
        : cameraScreenings.length
          ? cameraScreenings.map((row: any) => row.created_at + ' | ' + (row.visible_status || 'status not recorded') + ' | ' + (row.observed_concern || 'no visible concern recorded') + (row.affected_area ? ' | area:' + row.affected_area : '')).join(' || ')
          : 'none found'));
      lines.push('Completed births: ' + (birthCountsAvailable ? `${birthCount?.birth_count ?? 0} actual successful birth record(s)${birthCount?.last_birth_date ? ' | last birth:' + birthCount.last_birth_date : ''}` : 'not available from the database; do not estimate'));
      lines.push('Health cases: ' + (cases.length ? cases.map((row: any) => row.case_number + ' | ' + row.suspected_condition + ' | ' + row.case_status + ' | ' + row.date_reported).join(' || ') : 'none found'));
      lines.push('Treatments: ' + (treatments.length ? treatments.map((row: any) => row.medicine_name + ' | ' + row.status + ' | ' + row.dosage + ' ' + row.unit + ' | ' + row.frequency + ' | ' + row.start_date + ' through ' + (row.end_date || 'no end date')).join(' || ') : 'none found'));
      lines.push('Medicine usage from inventory: ' + (medicineUsage.length ? medicineUsage.map((row: any) => row.dosage + ' | ' + row.treatment_status + ' | ' + row.usage_date + ' | ' + (row.notes || row.reason || '')).join(' || ') : 'none found'));
      lines.push('Vaccinations: ' + (vaccinations.length ? vaccinations.map((row: any) => row.vaccine_name + ' | given ' + row.date_given + ' | next due ' + (row.next_due_date || 'not recorded')).join(' || ') : 'none found'));
      lines.push('Breeding: ' + (breeding.length ? breeding.map((row: any) => row.status + ' | mating ' + row.mating_date + ' | expected kidding/lambing ' + (row.expected_kidding_date || 'not recorded') + ' | reference ' + row.id).join(' || ') : 'none found'));
      lines.push('Weights: ' + (weights.length ? weights.map((row: any) => row.record_date + ' | ' + row.weight_kg + ' kg').join(' || ') : 'none found'));
      lines.push('Animal-linked inventory use: ' + (inventory.length ? inventory.map((row: any) => row.reason + ' | ' + row.quantity + ' ' + row.unit + ' | ' + row.created_at).join(' || ') : 'none found'));
      lines.push('Sales: ' + (sales.length ? sales.map((row: any) => row.sale_date + ' | ' + row.sold_weight + ' kg | ' + row.selling_price + ' | received ' + row.amount_received + ' | buyer ' + (row.buyer_name || 'not recorded')).join(' || ') : 'none found'));
      lines.push('Health alerts: ' + (healthAlerts.length ? healthAlerts.map((row: any) => row.message + ' | ' + (row.is_resolved ? 'resolved' : 'active') + ' | ' + row.created_at).join(' || ') : 'none found'));
      lines.push('Verified gate events in available monitoring context: ' + (gateEvents.length ? gateEvents.map((row: any) => row.direction + ' | ' + row.created_at + ' | gate ' + row.gate_id + ' | session ' + row.session_id + ' | ' + (row.eartag_verified ? 'eartag number ' + row.eartag_number + ' verified by OCR' : row.qr_verified ? 'legacy QR verified' : 'not verified')).join(' || ') : 'none in available session context'));
      lines.push('Animal-linked movement crossings: ' + (crossings.length ? crossings.map((row: any) => row.direction + ' | ' + row.movement_observation + ' | ' + row.created_at + ' | session ' + row.session_id).join(' || ') : 'none in available session context'));
      lines.push('Movement alerts: ' + (alerts.length ? alerts.map((row: any) => row.message + ' | ' + row.status + ' | ' + row.created_at).join(' || ') : 'none in available session context'));
    }
  }

  return lines.join('\n');
}

// ── Stream chat — routes based on mode ───────────────────────────────────────
export async function* streamChat(
  messages: Array<{ role: string; content: string; image?: string }>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): AsyncGenerator<void> {
  // LOCAL mode: use Ollama running on the developer's machine
  if (AI_MODE === 'local') {
    try {
      yield* _streamOllama(messages, onToken, signal);
      return;
    } catch (ollamaErr) {
      // Ollama not running — fall through to production path
      console.warn('[AlpasFarm AI] Ollama unavailable, trying /api/ai/chat:', ollamaErr);
    }
  }

  // PRODUCTION path — always route through the ALPASFARM API server.
  // The Groq API key is kept server-side. Direct browser→Groq is CORS-blocked
  // in production and would also leak the API key.
  try {
    yield* _streamViaApi(messages, onToken, signal);
    return;
  } catch (apiError) {
    // /api/ai/chat failed — check if we have a Supabase Edge Function fallback
    console.warn('[AlpasFarm AI] /api/ai/chat failed:', apiError);
    if (EDGE_ENDPOINT) {
      try {
        yield* _streamEdgeFunction(messages, onToken, signal);
        return;
      } catch (edgeErr) {
        console.warn('[AlpasFarm AI] Supabase Edge Function also failed:', edgeErr);
      }
    }
    throw apiError; // Keep the primary API error if both providers fail.
  }
}

// ── Primary production path: /api/ai/chat ───────────────────────────────────
// The ALPASFARM API server holds provider keys server-side.
// It accepts the messages array and returns SSE: data: {"token":"..."}
async function* _streamViaApi(
  messages: Array<{ role: string; content: string; image?: string }>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): AsyncGenerator<void> {
  const accessToken = await getSupabaseAccessToken();
  const resp = await fetch(AI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!resp.ok) {
    // Read the error body for a descriptive message
    let errMsg = `AI service error (${resp.status}).`;
    let errCode = '';
    try {
      const errBody = await resp.json();
      if (errBody?.error) errMsg = errBody.error;
      if (errBody?.code)  errCode = errBody.code;
    } catch { /* ignore parse error */ }

    // Map HTTP status to actionable user messages
    if (resp.status === 503 || errCode === 'NO_API_KEY') {
      throw new Error('Hindi naka-configure ang AI service. Ipa-check sa administrator ang server settings.');
    }
    if (resp.status === 502 && errCode === 'INVALID_KEY') {
      throw new Error('Hindi valid ang AI service key. Ipa-check sa administrator ang server settings.');
    }
    if (resp.status === 429 || errCode === 'RATE_LIMIT') {
      throw new Error('AI is temporarily busy (rate limit). Please wait a moment and try again.');
    }
    if (resp.status === 404) {
      throw new Error('Hindi maabot ang AI service. Subukan muli mamaya.');
    }
    if (resp.status === 405) {
      throw new Error('Hindi maabot nang tama ang AI service. Subukan muli mamaya.');
    }
    throw new Error(errMsg);
  }

  // Parse SSE stream: data: {"token":"..."} or data: {"done":true}
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response stream from AI service. Please try again.');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(t.slice(6));
        if (d?.error) throw new Error(d.error);
        if (d?.token) onToken(d.token);
        if (d?.done) return;
      } catch (parseErr) {
        // Re-throw actual errors, skip malformed SSE chunks
        if (parseErr instanceof SyntaxError) continue;
        throw parseErr;
      }
    }
    yield;
  }
}

// ── Direct Groq function removed ──────────────────────────────────────────────
// Browser → Groq direct calls are CORS-blocked in production and would expose
// the API key. Production AI goes through ALPASFARM's authenticated /api/ai/chat route.
// This function is intentionally removed.

// ── Supabase Edge Function streaming ─────────────────────────────────────────
async function* _streamEdgeFunction(
  messages: Array<{ role: string; content: string; image?: string }>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): AsyncGenerator<void> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const accessToken = await getSupabaseAccessToken();
  const edgeFetch = (input: RequestInfo | URL, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };
  const resp = await edgeFetch(EDGE_ENDPOINT!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!resp.ok) {
    let msg = `AI service error (${resp.status}). Please try again.`;
    try { const d = await resp.json(); if (d?.error) msg = d.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data: ')) continue;
      try {
        const d = JSON.parse(t.slice(6));
        if (d?.token) onToken(d.token);
        if (d?.done) return;
      } catch { /* skip */ }
    }
    yield;
  }
}

async function* _streamOllama(
  messages: Array<{ role: string; content: string; image?: string }>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): AsyncGenerator<void> {
  if (!OLLAMA_URL) throw new Error('Configure VITE_OLLAMA_URL to use local AI in development.');
  const formattedMessages = messages.map((m) => {
    const msgObj: any = { role: m.role, content: m.content };
    if (m.image) {
      const base64 = m.image.replace(/^data:image\/[a-z]+;base64,/, '');
      msgObj.images = [base64];
    }
    return msgObj;
  });

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: formattedMessages,
      stream: true,
      options: { temperature: 0.7, num_ctx: 4096, num_predict: 1024 },
    }),
    signal,
  });

  if (!resp.ok) throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body from Ollama');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const token = data?.message?.content ?? '';
        if (token) onToken(token);
        if (data?.done) return;
      } catch { /* skip */ }
    }
    yield;
  }
}

// ── Conversation storage (localStorage) ──────────────────────────────────────
const STORAGE_KEY = 'myai_conversations';

export function loadConversations(): MyAIConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MyAIConversation[];
  } catch {
    return [];
  }
}

export function saveConversations(convs: MyAIConversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs.slice(0, 50)));
  } catch { /* storage full */ }
}

export function newConversation(firstMessage?: string): MyAIConversation {
  return {
    id: crypto.randomUUID(),
    title: firstMessage
      ? firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '…' : '')
      : 'New Conversation',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
