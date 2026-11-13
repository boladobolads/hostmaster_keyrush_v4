import { createClient } from '@supabase/supabase-js';
import { syncOneCalendar } from './lib/ical-sync.mjs';

export const config = { schedule: '0 */3 * * *' };

export const handler = async () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { statusCode: 500, body: 'Supabase environment is not configured.' };
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sources, error } = await admin.from('property_calendar_sources').select('*');
  if (error) return { statusCode: 500, body: error.message };
  const results = [];
  for (const source of sources || []) {
    try { results.push({ ok: true, ...(await syncOneCalendar(admin, source)) }); }
    catch (e) { results.push({ ok: false, property_id: source.property_id, error: String(e.message || e) }); }
  }
  return { statusCode: 200, body: JSON.stringify({ checked: results.length, results }) };
};
