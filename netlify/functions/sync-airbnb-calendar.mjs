import { createClient } from '@supabase/supabase-js';
import { syncOneCalendar } from './lib/ical-sync.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json(500, { error: 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis da Netlify.' });
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sessão necessária.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON inválido.' }); }
  if (!body.property_id) return json(400, { error: 'property_id obrigatório.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: 'Sessão inválida ou expirada.' });
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,role').eq('id', authData.user.id).single();
  if (profileError || !profile) return json(403, { error: 'Perfil não autorizado.' });
  const { data: property, error: propertyError } = await admin.from('properties').select('id,owner_id').eq('id', body.property_id).single();
  if (propertyError || !property) return json(404, { error: 'Imóvel não encontrado.' });
  if (profile.role !== 'gestor' && property.owner_id !== profile.id) return json(403, { error: 'Você não pode sincronizar este imóvel.' });
  const { data: source, error: sourceError } = await admin.from('property_calendar_sources').select('*').eq('property_id', body.property_id).single();
  if (sourceError || !source) return json(404, { error: 'Link iCal ainda não cadastrado para este imóvel.' });
  try {
    const result = await syncOneCalendar(admin, source);
    return json(200, { ok: true, ...result });
  } catch (error) {
    return json(502, { error: String(error.message || error) });
  }
};
