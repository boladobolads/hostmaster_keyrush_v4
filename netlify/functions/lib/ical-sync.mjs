const AIRBNB_HOSTS = new Set([
  'airbnb.com', 'www.airbnb.com', 'airbnb.com.br', 'www.airbnb.com.br'
]);

export function validateAirbnbIcalUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !AIRBNB_HOSTS.has(url.hostname.toLowerCase()) || !/\.ics(?:$)/i.test(url.pathname)) {
    throw new Error('O endereço deve ser um link HTTPS iCal (.ics) exportado pelo Airbnb.');
  }
  return url;
}

function unescapeIcs(value = '') {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function addOneDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseAirbnbIcal(icsText) {
  const unfolded = String(icsText || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current) {
        const start = parseDate(current.DTSTART || '');
        const end = parseDate(current.DTEND || '') || (start ? addOneDay(start) : null);
        if (String(current.STATUS || '').toUpperCase() !== 'CANCELLED' && start && end && end > start) {
          events.push({
            external_uid: unescapeIcs(current.UID || `${start}_${end}`),
            start_date: start,
            end_date: end,
            summary: unescapeIcs(current.SUMMARY || 'Reservado no Airbnb')
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const rawKey = line.slice(0, colon);
    const key = rawKey.split(';')[0].toUpperCase();
    if (['UID', 'DTSTART', 'DTEND', 'SUMMARY', 'STATUS'].includes(key)) current[key] = line.slice(colon + 1);
  }
  return events;
}

async function fetchIcal(urlString) {
  const url = validateAirbnbIcalUrl(urlString);
  let response = await fetch(url, { redirect: 'manual', headers: { 'accept': 'text/calendar,text/plain;q=0.9,*/*;q=0.5' } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirecionamento inválido no calendário Airbnb.');
    const redirected = new URL(location, url);
    validateAirbnbIcalUrl(redirected.toString());
    response = await fetch(redirected, { redirect: 'error', headers: { 'accept': 'text/calendar,text/plain;q=0.9,*/*;q=0.5' } });
  }
  if (!response.ok) throw new Error(`Airbnb iCal respondeu HTTP ${response.status}.`);
  const body = await response.text();
  if (!body.includes('BEGIN:VCALENDAR')) throw new Error('O conteúdo recebido não parece ser um calendário iCal válido.');
  if (body.length > 3_000_000) throw new Error('O calendário excede o tamanho permitido.');
  return body;
}

export async function syncOneCalendar(admin, source) {
  try {
    const ics = await fetchIcal(source.ical_url);
    const parsed = parseAirbnbIcal(ics);
    const batch = crypto.randomUUID();
    if (parsed.length) {
      const rows = parsed.map(event => ({
        property_id: source.property_id,
        source: 'airbnb',
        external_uid: event.external_uid,
        start_date: event.start_date,
        end_date: event.end_date,
        summary: event.summary,
        sync_batch_id: batch
      }));
      const { error: upsertError } = await admin.from('calendar_events').upsert(rows, { onConflict: 'property_id,source,external_uid' });
      if (upsertError) throw upsertError;
    }
    let cleanup = admin.from('calendar_events').delete().eq('property_id', source.property_id).eq('source', 'airbnb');
    if (parsed.length) cleanup = cleanup.neq('sync_batch_id', batch);
    const { error: cleanupError } = await cleanup;
    if (cleanupError) throw cleanupError;
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from('property_calendar_sources').update({ last_synced_at: now, last_attempt_at: now, last_error: null, updated_at: now }).eq('id', source.id);
    if (updateError) throw updateError;
    return { property_id: source.property_id, imported: parsed.length, synced_at: now };
  } catch (error) {
    const now = new Date().toISOString();
    await admin.from('property_calendar_sources').update({ last_attempt_at: now, last_error: String(error.message || error).slice(0, 500), updated_at: now }).eq('id', source.id);
    throw error;
  }
}
