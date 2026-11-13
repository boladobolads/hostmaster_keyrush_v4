/* HostMaster + KeyRush V4 - integração Supabase/Netlify.
 * O cliente usa somente a chave pública ANON/PUBLISHABLE. Operações sensíveis
 * (fila, aceite, cancelamento, conclusão e sincronização iCal) são RPCs/funções server-side.
 */
(function () {
  'use strict';

  const cfg = window.HOSTMASTER_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(String(cfg.SUPABASE_URL || '')) &&
    String(cfg.SUPABASE_ANON_KEY || '').length > 20 &&
    !String(cfg.SUPABASE_ANON_KEY).includes('COLE_AQUI');

  const HM4 = window.HM4 = {
    client: null,
    ready: false,
    channels: [],
    syncing: false,
    lastLocationWrite: 0,
    refreshTimer: null,
    status: 'not-configured'
  };

  function setupMessage(message, isError = true) {
    const el = document.getElementById('backend-setup-warning');
    if (el) {
      el.textContent = message;
      el.className = `mt-4 rounded-xl border p-3 text-[11px] leading-5 ${isError ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`;
      el.classList.remove('hidden');
    }
  }

  function toast(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else alert(message);
  }

  function requireBackend() {
    if (!HM4.ready || !HM4.client) {
      setupMessage('Para ativar o sistema online, preencha SUPABASE_URL e SUPABASE_ANON_KEY no arquivo config.js. Depois execute supabase-schema.sql no Supabase e configure as variáveis privadas na Netlify.');
      return false;
    }
    return true;
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function mapProperty(row) {
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      address: row.address,
      airbnbUrl: row.airbnb_url || '',
      airbnbIcalUrl: row.ical_url || '',
      airbnbEvents: [],
      manualBlocks: [],
      dailyRate: Number(row.daily_rate || 0),
      status: row.status || 'Disponível',
      image: row.image_url || 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=500&q=80'
    };
  }

  function mapMission(row) {
    const status = ({ searching: 'Pendente', accepted: 'Em execução', in_progress: 'Em execução', completed: 'Concluído', cancelled: 'Cancelado' })[row.status] || row.status;
    return {
      id: row.id,
      propertyId: row.property_id,
      property: row.property_title,
      address: row.property_address,
      guest: 'Solicitado pelo proprietário',
      time: row.created_at,
      fee: Number(row.fee || 0),
      status,
      type: row.service_name,
      origin: 'owner_catalog',
      ownerName: row.owner_name,
      ownerEmail: row.owner_id === currentUser?.id ? (currentUser?.email || '') : '',
      providerName: row.provider_name || '',
      providerEmail: row.provider_id === currentUser?.id ? (currentUser?.email || '') : '',
      offeredToEmail: row.offered_to_provider_id === currentUser?.id ? (currentUser?.email || '') : '',
      providerLat: row.provider_lat,
      providerLng: row.provider_lng,
      providerDistanceKm: row.provider_distance_km == null ? null : Number(row.provider_distance_km),
      providerEtaMinutes: row.provider_eta_minutes,
      providerEtaLabel: row.provider_eta_label || '',
      providerLocationUpdatedAt: row.provider_location_updated_at,
      providerCancellationHistory: Array.from({ length: Number(row.provider_cancellation_count || 0) }, (_, i) => ({ name: 'Prestador anterior', at: null, sequence: i + 1 })),
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      completedAt: row.completed_at,
      paid: row.status === 'completed'
    };
  }

  async function loadProperties() {
    const { data, error } = await HM4.client.from('properties').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const ids = (data || []).map(row => row.id);
    let sources = [], events = [];
    if (ids.length) {
      const [sourceResult, eventResult] = await Promise.all([
        HM4.client.from('property_calendar_sources').select('property_id,ical_url,last_synced_at,last_attempt_at,last_error').in('property_id', ids),
        HM4.client.from('calendar_events').select('*').in('property_id', ids).order('start_date')
      ]);
      if (sourceResult.error) throw sourceResult.error;
      if (eventResult.error) throw eventResult.error;
      sources = sourceResult.data || [];
      events = eventResult.data || [];
    }
    const mapped = (data || []).map(row => {
      const p = mapProperty(row);
      const source = sources.find(item => item.property_id === row.id);
      p.airbnbIcalUrl = source?.ical_url || '';
      p.icalLastSyncedAt = source?.last_synced_at || null;
      p.icalLastError = source?.last_error || null;
      p.airbnbEvents = events.filter(e => e.property_id === row.id && e.source === 'airbnb').map(e => ({ id: e.id, startDate: e.start_date, endDate: e.end_date, summary: e.summary }));
      p.manualBlocks = events.filter(e => e.property_id === row.id && e.source === 'manual').map(e => ({ id: e.id, startDate: e.start_date, endDate: previousDay(e.end_date), reason: e.reason, createdAt: e.created_at }));
      return p;
    });
    propertiesState = mapped;
    renderProperties();
    renderOwnerServiceCatalog();
    const countBadge = document.getElementById('master-property-count');
    if (countBadge) countBadge.textContent = `${mapped.length} imóvel(is)`;
    const masterRows = document.getElementById('master-properties-table');
    if (masterRows) masterRows.innerHTML = mapped.length ? mapped.map(p => `<tr><td class="py-3 px-2 font-bold text-white">${escapeServiceHTML(p.title)}</td><td class="py-3 px-2 text-slate-400">${escapeServiceHTML(p.address)}</td><td class="py-3 px-2 text-emerald-300">${money(p.dailyRate)}</td><td class="py-3 px-2">${escapeServiceHTML(p.status)}</td><td class="py-3 px-2 text-right"><button onclick="openPropertyCalendar('${p.id}')" class="text-sky-300 hover:text-sky-200 text-xs font-bold">Abrir calendário</button></td></tr>`).join('') : '<tr><td colspan="5" class="py-6 text-center text-slate-500">Nenhum imóvel cadastrado.</td></tr>';
    if (activeCalendarPropertyId) renderPropertyCalendar();
  }

  async function loadServices() {
    const { data, error } = await HM4.client.from('service_catalog').select('*').order('name');
    if (error) throw error;
    servicesCatalog = (data || []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description, price: Number(row.price), active: !!row.active }));
    renderServicesAdmin();
    renderOwnerServiceCatalog();
  }

  async function loadMissions() {
    const { data, error } = await HM4.client.from('service_requests').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) throw error;
    missionsState = (data || []).map(mapMission);
    activeMissionId = missionsState.find(m => m.status === 'Em execução')?.id || missionsState[0]?.id || null;
    const latest = missionsState.find(m => m.ownerEmail === currentUser?.email && !['Cancelado'].includes(m.status));
    chamadaPendente = latest ? { missionId: latest.id, tipo: latest.type, imovel: latest.property, valor: latest.fee, status: latest.status } : null;
    renderKeyRushMissions();
    renderPrestadorArea();
    renderPrestadorReport();
    atualizarTelaEsperaProprietario();
    if (activeMissionId) setKeyRushActiveMission(activeMissionId, false);
  }

  async function loadFinancialEntries() {
    const { data, error } = await HM4.client.from('financial_entries').select('*').order('entry_date', { ascending: false }).limit(1000);
    if (error) throw error;
    const entries = data || [];
    const income = entries.filter(x => x.entry_type === 'income').reduce((s, x) => s + Number(x.amount || 0), 0);
    const expense = entries.filter(x => x.entry_type === 'expense').reduce((s, x) => s + Number(x.amount || 0), 0);
    dreData = [
      { category: '(+) RECEITA OPERACIONAL BRUTA', value: income, percent: 100 },
      { category: '(-) DESPESAS OPERACIONAIS LANÇADAS', value: -expense, percent: income ? -(expense / income * 100) : 0 },
      { category: '(=) LUCRO LÍQUIDO REGISTRADO', value: income - expense, percent: income ? ((income - expense) / income * 100) : 0 }
    ];
    despesasLista = entries.filter(x => x.entry_type === 'expense').map(x => ({ data: new Date(x.entry_date + 'T12:00:00').toLocaleDateString('pt-BR'), descricao: x.description, categoria: x.category, valor: Number(x.amount) }));
    renderDRETable();
    const incomeEl = document.getElementById('master-stat-income');
    const profitEl = document.getElementById('master-stat-profit');
    if (incomeEl) incomeEl.textContent = money(income);
    if (profitEl) profitEl.textContent = money(income - expense);
    if (typeof atualizarTabelaDespesas === 'function') atualizarTabelaDespesas();
  }

  async function refreshAll() {
    if (!requireBackend() || HM4.syncing) return;
    HM4.syncing = true;
    try {
      await Promise.all([loadProperties(), loadServices(), loadMissions(), loadFinancialEntries()]);
      HM4.status = 'connected';
      setupMessage('Conectado ao Supabase. Cadastros, imóveis, serviços, chamados, relatórios e calendários são carregados do banco.', false);
    } catch (error) {
      console.error('HostMaster V4 load:', error);
      toast(`Falha ao carregar dados online: ${error.message || error}`, 'error');
    } finally { HM4.syncing = false; }
  }

  function stopRealtime() {
    for (const channel of HM4.channels) HM4.client?.removeChannel(channel);
    HM4.channels = [];
  }

  function startRealtime() {
    stopRealtime();
    const reloadMissions = () => loadMissions().catch(e => console.error(e));
    const reloadProperties = () => loadProperties().catch(e => console.error(e));
    const reloadServices = () => loadServices().catch(e => console.error(e));
    HM4.channels.push(HM4.client.channel('hm4-service-requests').on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, reloadMissions).subscribe());
    HM4.channels.push(HM4.client.channel('hm4-properties').on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, reloadProperties).subscribe());
    HM4.channels.push(HM4.client.channel('hm4-calendar').on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, reloadProperties).subscribe());
    HM4.channels.push(HM4.client.channel('hm4-catalog').on('postgres_changes', { event: '*', schema: 'public', table: 'service_catalog' }, reloadServices).subscribe());
    HM4.channels.push(HM4.client.channel('hm4-financial').on('postgres_changes', { event: '*', schema: 'public', table: 'financial_entries' }, () => loadFinancialEntries().catch(e => console.error(e))).subscribe());
    if (HM4.refreshTimer) clearInterval(HM4.refreshTimer);
    HM4.refreshTimer = setInterval(() => { reloadMissions(); }, 30000);
  }

  async function getProfile(user) {
    const { data, error } = await HM4.client.from('profiles').select('id,full_name,email,phone,role,is_active').eq('id', user.id).single();
    if (error) throw error;
    if (!data.is_active) throw new Error('Esta conta está desativada. Fale com o Gestor Master.');
    return data;
  }

  async function setAuthenticatedUser(user, profile) {
    perfilAutenticado = profile.role;
    currentUser = { id: user.id, email: user.email, name: profile.full_name, phone: profile.phone, role: profile.role };
    currentUserName = profile.full_name || user.email;
    await refreshAll();
    entrarNoSistema();
    startRealtime();
  }

  function addOneDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function previousDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  async function saveIcalSource(property, icalUrl) {
    if (icalUrl) {
      const parsed = new URL(icalUrl);
      const hosts = ['airbnb.com','www.airbnb.com','airbnb.com.br','www.airbnb.com.br'];
      if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname.toLowerCase()) || !/\.ics$/i.test(parsed.pathname)) {
        throw new Error('Use o link HTTPS iCal (.ics) exportado pelo Airbnb.');
      }
      const { error } = await HM4.client.from('property_calendar_sources').upsert({ property_id: property.id, owner_id: property.ownerId || currentUser.id, ical_url: icalUrl, updated_at: new Date().toISOString() }, { onConflict: 'property_id' });
      if (error) throw error;
      property.airbnbIcalUrl = icalUrl;
      return true;
    }
    const { error } = await HM4.client.from('property_calendar_sources').delete().eq('property_id', property.id);
    if (error) throw error;
    property.airbnbIcalUrl = '';
    return false;
  }

  async function syncIcalNow(property) {
    const { data: sessionData } = await HM4.client.auth.getSession();
    const token = sessionData?.session?.access_token;
    const response = await fetch('/.netlify/functions/sync-airbnb-calendar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
      body: JSON.stringify({ property_id: property.id })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Falha na sincronização (${response.status}).`);
    await loadProperties();
    return result;
  }

  // --- Autenticação real Supabase ---
  window.registrarConta = async function (event) {
    event.preventDefault();
    if (!requireBackend()) return;
    const role = document.getElementById('register-role').value;
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const phone = document.getElementById('register-phone').value.trim();
    const password = document.getElementById('register-password').value;
    if (!['proprietario','prestador'].includes(role)) return toast('O cadastro público permite somente Proprietário ou Prestador.', 'error');
    try {
      const { data, error } = await HM4.client.auth.signUp({ email, password, options: { data: { full_name: name, phone, role } } });
      if (error) throw error;
      fecharCadastro();
      if (!data.session) {
        alert('Cadastro enviado! Confirme seu e-mail pelo link recebido. Depois volte ao sistema e faça login.');
        return;
      }
      const profile = await getProfile(data.user);
      await setAuthenticatedUser(data.user, profile);
      alert('Cadastro criado com sucesso! Bem-vindo ao HostMaster & KeyRush.');
    } catch (error) { toast(`Não foi possível criar a conta: ${error.message || error}`, 'error'); }
  };

  window.realizarLoginEfetivo = async function (event) {
    event.preventDefault();
    if (!requireBackend()) return;
    const email = document.getElementById('login-email-input').value.trim().toLowerCase();
    const password = document.getElementById('login-pass-input').value;
    const selectedRole = perfilAutenticado;
    try {
      const { data, error } = await HM4.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = await getProfile(data.user);
      if (selectedRole && selectedRole !== profile.role) {
        await HM4.client.auth.signOut();
        throw new Error(`Esta conta está cadastrada como ${profile.role}. Selecione o perfil correto na tela inicial.`);
      }
      await setAuthenticatedUser(data.user, profile);
    } catch (error) { toast(`Falha no login: ${error.message || error}`, 'error'); }
  };

  window.fazerLogout = async function () {
    stopProviderLiveTracking(); stopRealtime();
    if (HM4.client) await HM4.client.auth.signOut();
    document.getElementById('main-ecosystem').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    perfilAutenticado = null; currentUser = null; currentUserName = '';
    selecionarPerfilLogin('proprietario');
  };

  const originalConfigure = window.configurarInterfaceLogada;
  window.configurarInterfaceLogada = function () {
    if (typeof originalConfigure === 'function') originalConfigure();
    const requestButton = document.getElementById('topbar-request-service-btn');
    if (requestButton) requestButton.classList.toggle('hidden', perfilAutenticado !== 'gestor');
    const adminCharts = document.getElementById('container-btn-graficos-master');
    if (adminCharts) adminCharts.classList.toggle('hidden', perfilAutenticado !== 'gestor');
  };

  // --- Imóveis e calendário persistidos no banco ---
  window.savePropertiesState = function () { /* Persistência ocorre nas operações Supabase abaixo. */ };

  window.saveProperty = async function (event) {
    event.preventDefault();
    if (!requireBackend() || !['gestor','proprietario'].includes(perfilAutenticado)) return;
    const title = document.getElementById('propTitle').value.trim();
    const address = document.getElementById('propAddress').value.trim();
    const airbnbUrl = document.getElementById('propAirbnbUrl').value.trim();
    const icalUrl = document.getElementById('propAirbnbIcalUrl').value.trim();
    const dailyRate = Number(document.getElementById('propDaily').value || 0);
    const status = document.getElementById('propStatus').value;
    if (icalUrl) { try { const u = new URL(icalUrl); if (u.protocol !== 'https:' || !['airbnb.com','www.airbnb.com','airbnb.com.br','www.airbnb.com.br'].includes(u.hostname.toLowerCase()) || !/\.ics$/i.test(u.pathname)) throw new Error('Use o link iCal HTTPS (.ics) exportado pelo Airbnb.'); } catch (e) { return toast(e.message || 'Link iCal inválido.', 'error'); } }
    try {
      const { data, error } = await HM4.client.from('properties').insert({ owner_id: currentUser.id, title, address, airbnb_url: airbnbUrl, daily_rate: dailyRate, status, image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=500&q=80' }).select('*').single();
      if (error) throw error;
      const property = mapProperty(data);
      propertiesState.unshift(property);
      if (icalUrl) {
        await saveIcalSource(property, icalUrl);
        try { await syncIcalNow(property); } catch (syncError) { toast(`Imóvel salvo. A sincronização iCal ficará pendente: ${syncError.message}`, 'info'); }
      }
      renderProperties(); renderOwnerServiceCatalog();
      closeModal('addPropertyModal'); document.getElementById('formProperty').reset();
      toast('Imóvel salvo no Supabase.', 'success');
    } catch (error) { toast(`Não foi possível salvar o imóvel: ${error.message || error}`, 'error'); }
  };

  window.openPropertyCalendar = function (propertyId) {
    const property = propertiesState.find(item => String(item.id) === String(propertyId));
    if (!property) return;
    activeCalendarPropertyId = property.id;
    document.getElementById('propertyCalendarTitle').textContent = `Calendário • ${property.title}`;
    document.getElementById('calendarMonth').value = new Date().toISOString().slice(0, 7);
    document.getElementById('manualBlockStart').value = '';
    document.getElementById('manualBlockEnd').value = '';
    document.getElementById('manualBlockReason').value = '';
    document.getElementById('calendarIcalUrl').value = property.airbnbIcalUrl || '';
    const status = document.getElementById('airbnbCalendarSyncStatus');
    status.textContent = property.icalLastError ? `Erro na última sincronização: ${property.icalLastError}` : property.icalLastSyncedAt ? `Última sincronização: ${new Date(property.icalLastSyncedAt).toLocaleString('pt-BR')}` : property.airbnbIcalUrl ? 'Link iCal cadastrado. Clique em sincronizar para importar as datas.' : 'Cole o link iCal exportado pelo Airbnb.';
    const modal = document.getElementById('propertyCalendarModal'); modal.classList.remove('hidden'); modal.classList.add('flex');
    renderPropertyCalendar();
  };

  window.addManualCalendarBlock = async function () {
    const property = propertiesState.find(item => String(item.id) === String(activeCalendarPropertyId));
    if (!property) return;
    const startDate = document.getElementById('manualBlockStart').value;
    const endDate = document.getElementById('manualBlockEnd').value;
    const reason = document.getElementById('manualBlockReason').value.trim();
    if (!startDate || !endDate || endDate < startDate) return toast('Informe um período válido.', 'error');
    const overlapsAirbnb = (property.airbnbEvents || []).some(event => startDate < event.endDate && endDate >= event.startDate);
    if (overlapsAirbnb && !confirm('Este período coincide com datas ocupadas no Airbnb. Deseja registrar também o bloqueio manual?')) return;
    try {
      const { error } = await HM4.client.from('calendar_events').insert({ property_id: property.id, source: 'manual', start_date: startDate, end_date: addOneDay(endDate), reason: reason || 'Bloqueio manual', summary: reason || 'Bloqueio manual', created_by: currentUser.id });
      if (error) throw error;
      await loadProperties(); renderPropertyCalendar();
      toast('Período bloqueado e salvo no servidor.', 'success');
    } catch (error) { toast(`Não foi possível bloquear as datas: ${error.message || error}`, 'error'); }
  };

  window.removeManualCalendarBlock = async function (blockId) {
    try {
      const { error } = await HM4.client.from('calendar_events').delete().eq('id', blockId).eq('source', 'manual');
      if (error) throw error;
      await loadProperties(); renderPropertyCalendar();
      toast('Bloqueio manual removido.', 'success');
    } catch (error) { toast(`Não foi possível remover o bloqueio: ${error.message || error}`, 'error'); }
  };

  window.savePropertyIcalUrl = async function () {
    const property = propertiesState.find(item => String(item.id) === String(activeCalendarPropertyId));
    if (!property) return;
    const value = document.getElementById('calendarIcalUrl').value.trim();
    const status = document.getElementById('airbnbCalendarSyncStatus');
    try {
      await saveIcalSource(property, value);
      if (!value) { await loadProperties(); status.textContent = 'Link iCal removido do servidor.'; toast('Link iCal removido.', 'success'); return; }
      status.textContent = 'Link salvo. Importando calendário do Airbnb...';
      const result = await syncIcalNow(property);
      status.textContent = `${result.imported} período(s) importado(s). Sincronização automática a cada 3 horas.`;
      toast('Calendário Airbnb sincronizado.', 'success');
    } catch (error) { status.textContent = `Falha: ${error.message || error}`; toast(`Não foi possível sincronizar o iCal: ${error.message || error}`, 'error'); }
  };

  // --- Catálogo de serviços persistido ---
  window.renderServicesAdmin = function () {
    const list = document.getElementById('serviceAdminList'); if (!list) return;
    const active = servicesCatalog.filter(s => s.active).length;
    document.getElementById('serviceAdminTotal').textContent = servicesCatalog.length;
    document.getElementById('serviceAdminActive').textContent = active;
    document.getElementById('serviceAdminInactive').textContent = servicesCatalog.length - active;
    list.innerHTML = servicesCatalog.length ? servicesCatalog.map(s => `
      <div class="bg-gray-950 border border-gray-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h4 class="font-bold text-white">${escapeServiceHTML(s.name)}</h4><span class="text-[10px] px-2 py-1 rounded-full ${s.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-800 text-gray-400'}">${s.active ? 'Disponível' : 'Inativo'}</span><span class="text-[10px] bg-indigo-500/15 text-indigo-300 px-2 py-1 rounded-full">${escapeServiceHTML(s.category)}</span></div><p class="text-xs text-gray-400 mt-1">${escapeServiceHTML(s.description)}</p></div>
        <div class="flex flex-wrap items-center gap-2"><strong class="text-lg font-black text-emerald-400 font-mono">${money(s.price)}</strong><button onclick="openServiceForm('${s.id}')" class="px-3 py-2 bg-indigo-500/15 text-indigo-300 rounded-lg text-xs font-bold">Editar</button><button onclick="toggleServiceActive('${s.id}')" class="px-3 py-2 bg-gray-800 text-gray-200 rounded-lg text-xs font-bold">${s.active ? 'Desativar' : 'Ativar'}</button><button onclick="deleteService('${s.id}')" class="px-3 py-2 bg-rose-500/10 text-rose-300 rounded-lg text-xs font-bold">Excluir</button></div>
      </div>`).join('') : '<div class="text-center p-8 bg-gray-950 rounded-xl border border-dashed border-gray-700 text-sm text-gray-400">Nenhum serviço cadastrado.</div>';
  };

  window.openServiceForm = function (serviceId = null) {
    const service = serviceId ? servicesCatalog.find(s => String(s.id) === String(serviceId)) : null;
    document.getElementById('serviceEditorTitle').textContent = service ? 'Editar serviço' : 'Adicionar novo serviço';
    document.getElementById('serviceEditId').value = service?.id || '';
    document.getElementById('serviceNameInput').value = service?.name || '';
    document.getElementById('serviceCategoryInput').value = service?.category || 'KeyRush';
    document.getElementById('servicePriceInput').value = service ? Number(service.price).toFixed(2) : '';
    document.getElementById('serviceDescriptionInput').value = service?.description || '';
    document.getElementById('serviceActiveInput').checked = service ? !!service.active : true;
    document.getElementById('serviceEditorForm').classList.remove('hidden');
    document.getElementById('serviceEditorForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  window.saveServiceFromForm = async function (event) {
    event.preventDefault();
    if (perfilAutenticado !== 'gestor') return toast('Somente o Gestor Master pode editar o catálogo.', 'error');
    const id = document.getElementById('serviceEditId').value;
    const row = { name: document.getElementById('serviceNameInput').value.trim(), category: document.getElementById('serviceCategoryInput').value, price: Number(document.getElementById('servicePriceInput').value), description: document.getElementById('serviceDescriptionInput').value.trim(), active: document.getElementById('serviceActiveInput').checked, created_by: currentUser.id, updated_at: new Date().toISOString() };
    if (!row.name || !Number.isFinite(row.price) || row.price < 0) return toast('Informe nome e valor válido.', 'error');
    try {
      const query = id ? HM4.client.from('service_catalog').update(row).eq('id', id) : HM4.client.from('service_catalog').insert(row);
      const { error } = await query; if (error) throw error;
      await loadServices(); cancelServiceEdit(); toast('Catálogo salvo no Supabase.', 'success');
    } catch (error) { toast(`Falha ao salvar serviço: ${error.message || error}`, 'error'); }
  };

  window.toggleServiceActive = async function (id) {
    if (perfilAutenticado !== 'gestor') return toast('Apenas o Gestor Master pode alterar o catálogo.', 'error');
    const service = servicesCatalog.find(s => String(s.id) === String(id)); if (!service) return;
    const { error } = await HM4.client.from('service_catalog').update({ active: !service.active, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast(error.message, 'error');
    await loadServices(); toast(service.active ? 'Serviço desativado.' : 'Serviço liberado aos proprietários.', 'success');
  };

  window.deleteService = async function (id) {
    if (perfilAutenticado !== 'gestor') return toast('Apenas o Gestor Master pode excluir serviços.', 'error');
    const service = servicesCatalog.find(s => String(s.id) === String(id)); if (!service || !confirm(`Excluir o serviço “${service.name}”?`)) return;
    const { error } = await HM4.client.from('service_catalog').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    await loadServices(); toast('Serviço removido do catálogo.', 'success');
  };

  window.renderOwnerServiceCatalog = function () {
    const container = document.getElementById('ownerServiceCatalog'); const propertySelect = document.getElementById('ownerServiceProperty');
    if (!container) return;
    if (propertySelect) {
      const selected = propertySelect.value;
      propertySelect.innerHTML = propertiesState.map(p => `<option value="${p.id}">${escapeServiceHTML(p.title)}</option>`).join('');
      if (propertiesState.some(p => String(p.id) === selected)) propertySelect.value = selected;
    }
    const active = servicesCatalog.filter(s => s.active);
    container.innerHTML = active.length ? active.map(s => `<article class="bg-gray-950 border border-gray-800 hover:border-emerald-500/50 rounded-xl p-4 flex flex-col justify-between gap-4"><div><div class="flex items-center justify-between gap-2"><span class="text-[10px] uppercase tracking-wider font-bold text-emerald-400">${escapeServiceHTML(s.category)}</span><i class="fa-solid fa-circle-check text-emerald-500"></i></div><h3 class="text-sm font-black text-white mt-2">${escapeServiceHTML(s.name)}</h3><p class="text-xs text-gray-400 mt-1 min-h-8">${escapeServiceHTML(s.description || 'Serviço disponível para solicitação.')}</p></div><div class="flex items-center justify-between gap-2 border-t border-gray-800 pt-3"><strong class="text-lg font-black text-emerald-400">${money(s.price)}</strong><button onclick="solicitarServicoCatalogo('${s.id}')" class="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-xs font-black rounded-lg">Solicitar</button></div></article>`).join('') : '<div class="md:col-span-2 xl:col-span-3 text-center p-8 bg-gray-950 rounded-xl border border-dashed border-gray-700 text-sm text-gray-400">Nenhum serviço disponível no momento.</div>';
  };

  async function createRequest(propertyId, serviceId = null, serviceName = null, fee = null) {
    const { data, error } = await HM4.client.rpc('create_service_request', { p_property_id: propertyId, p_service_id: serviceId, p_service_name: serviceName, p_fee: fee });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    await loadMissions();
    if (row?.id) chamadaPendente = { missionId: row.id, tipo: row.service_name, imovel: row.property_title, valor: row.fee, status: 'Aguardando Prestador Aceitar' };
    atualizarTelaEsperaProprietario();
    if (typeof playKeyRushAlertSound === 'function') playKeyRushAlertSound();
    toast('Solicitação enviada. Procurando prestador...', 'success');
    return row;
  }

  window.solicitarServicoCatalogo = async function (serviceId) {
    if (!['gestor','proprietario'].includes(perfilAutenticado)) return toast('Somente Proprietário ou Gestor Master pode solicitar serviços.', 'error');
    const service = servicesCatalog.find(s => String(s.id) === String(serviceId) && s.active);
    if (!service) return toast('Este serviço não está disponível.', 'error');
    const selectedId = document.getElementById('ownerServiceProperty')?.value;
    const property = propertiesState.find(p => String(p.id) === String(selectedId)) || (perfilAutenticado === 'gestor' ? propertiesState[0] : null);
    if (!property) return toast('Cadastre ou selecione um imóvel antes de solicitar.', 'error');
    try { await createRequest(property.id, service.id, null, null); }
    catch (error) { toast(`Não foi possível solicitar o serviço: ${error.message || error}`, 'error'); }
  };

  window.solicitarServicoMaster = async function (tipo, valor) {
    if (perfilAutenticado !== 'gestor') return toast('Somente o Gestor Master pode fazer solicitações administrativas.', 'error');
    const property = propertiesState[0];
    if (!property) return toast('Cadastre um imóvel antes de solicitar um serviço.', 'error');
    try { await createRequest(property.id, null, tipo, Number(valor) || 0); }
    catch (error) { toast(`Não foi possível criar o chamado: ${error.message || error}`, 'error'); }
  };

  window.requestKeyRushForProp = async function (title) {
    if (!['gestor','proprietario'].includes(perfilAutenticado)) return toast('Somente Proprietário ou Gestor Master pode solicitar serviços.', 'error');
    const property = propertiesState.find(p => p.title === title);
    const service = servicesCatalog.find(s => s.active);
    if (!property || !service) return toast('Imóvel ou serviço disponível não encontrado.', 'error');
    try { await createRequest(property.id, service.id, null, null); }
    catch (error) { toast(error.message || String(error), 'error'); }
  };

  // --- Fila KeyRush: aceite/cancelamento/finalização atômicos no banco ---
  window.saveOwnerMissions = function () {
    const now = Date.now();
    if (now - HM4.lastLocationWrite < 12000 || !HM4.client || perfilAutenticado !== 'prestador') return;
    const mission = missionsState.find(m => m.status === 'Em execução' && m.providerEmail === currentUser?.email && Number.isFinite(Number(m.providerLat)) && Number.isFinite(Number(m.providerLng)));
    if (!mission) return;
    HM4.lastLocationWrite = now;
    HM4.client.rpc('update_service_location', {
      p_request_id: mission.id,
      p_lat: Number(mission.providerLat),
      p_lng: Number(mission.providerLng),
      p_distance_km: mission.providerDistanceKm == null ? null : Number(mission.providerDistanceKm),
      p_eta_minutes: mission.providerEtaMinutes == null ? null : Number(mission.providerEtaMinutes),
      p_eta_label: mission.providerEtaLabel || ''
    }).then(({ error }) => { if (error) console.warn('GPS não foi salvo:', error.message); });
  };

  window.aceitarOwnerMission = async function (missionId) {
    if (perfilAutenticado !== 'prestador') return toast('Somente prestador pode aceitar.', 'error');
    try {
      const { error } = await HM4.client.rpc('accept_service_request', { p_request_id: missionId });
      if (error) throw error;
      await loadMissions();
      startProviderLiveTracking(missionId);
      toast('Serviço aceito. O GPS atualizará a previsão de chegada.', 'success');
    } catch (error) { toast(`Não foi possível aceitar: ${error.message || error}`, 'error'); }
  };

  window.cancelarOwnerMission = async function (missionId) {
    if (perfilAutenticado !== 'prestador') return toast('Somente o prestador responsável pode cancelar.', 'error');
    if (!confirm('Deseja cancelar este atendimento? O chamado será encaminhado ao próximo prestador da fila.')) return;
    try {
      const { data, error } = await HM4.client.rpc('cancel_service_request', { p_request_id: missionId });
      if (error) throw error;
      stopProviderLiveTracking();
      await loadMissions();
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.offered_to_provider_id ? 'Atendimento cancelado. Chamado encaminhado ao próximo prestador.' : 'Atendimento cancelado. O chamado aguarda um próximo prestador disponível.', 'info');
    } catch (error) { toast(`Não foi possível cancelar: ${error.message || error}`, 'error'); }
  };

  window.concluirOwnerMission = async function (missionId) {
    if (perfilAutenticado !== 'prestador') return toast('Somente prestador pode finalizar.', 'error');
    if (!confirm('Confirmar que o serviço foi concluído?')) return;
    try {
      const { error } = await HM4.client.rpc('complete_service_request', { p_request_id: missionId });
      if (error) throw error;
      stopProviderLiveTracking(); await loadMissions();
      toast('Serviço finalizado e registrado no relatório financeiro.', 'success');
    } catch (error) { toast(`Não foi possível finalizar: ${error.message || error}`, 'error'); }
  };

  // --- Lançamentos do DRE salvos no banco ---
  window.openAddExpenseModal = async function () {
    const raw = prompt('Valor da despesa (R$):'); if (!raw) return;
    const amount = Number(raw.replace(',', '.')); if (!Number.isFinite(amount) || amount <= 0) return toast('Informe um valor válido.', 'error');
    const description = prompt('Descrição da despesa:'); if (!description) return;
    try {
      const { error } = await HM4.client.from('financial_entries').insert({ owner_id: currentUser.id, created_by: currentUser.id, entry_type: 'expense', description, category: 'Despesa operacional', amount, entry_date: new Date().toISOString().slice(0,10) });
      if (error) throw error; await loadFinancialEntries(); toast('Despesa salva no Supabase.', 'success');
    } catch (error) { toast(`Falha ao salvar despesa: ${error.message || error}`, 'error'); }
  };

  window.openAddIncomeModal = async function () {
    const raw = prompt('Valor da receita (R$):'); if (!raw) return;
    const amount = Number(raw.replace(',', '.')); if (!Number.isFinite(amount) || amount <= 0) return toast('Informe um valor válido.', 'error');
    const description = prompt('Descrição da receita:'); if (!description) return;
    try {
      const { error } = await HM4.client.from('financial_entries').insert({ owner_id: currentUser.id, created_by: currentUser.id, entry_type: 'income', description, category: 'Receita operacional', amount, entry_date: new Date().toISOString().slice(0,10) });
      if (error) throw error; await loadFinancialEntries(); toast('Receita salva no Supabase.', 'success');
    } catch (error) { toast(`Falha ao salvar receita: ${error.message || error}`, 'error'); }
  };

  window.showAirbnbSyncSetupHelp = function () {
    alert('No Airbnb, abra o anúncio → Calendário → Disponibilidade → Conectar calendários → Exportar calendário. Copie o endereço iCal .ics, cole no campo do imóvel e clique em “Salvar e sincronizar agora”. O servidor fará novas consultas automaticamente a cada três horas após a publicação das Netlify Functions.');
  };

  // Configuração e restauração da sessão.
  if (!configured || !window.supabase?.createClient) {
    HM4.status = 'not-configured';
    setupMessage('Versão 4 pronta para conectar. Abra config.js e informe a URL e a chave pública ANON/PUBLISHABLE do seu Supabase. Execute também supabase-schema.sql e configure as chaves privadas na Netlify. Nenhuma senha é salva no navegador.', true);
    document.getElementById('login-email-input').value = '';
    document.getElementById('login-pass-input').value = '';
    selecionarPerfilLogin('proprietario');
    return;
  }

  HM4.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 10 } }
  });
  HM4.ready = true;
  HM4.status = 'configured';
  setupMessage('Supabase configurado. Entre com sua conta para carregar seus dados salvos no servidor.', false);
  document.getElementById('login-email-input').value = '';
  document.getElementById('login-pass-input').value = '';
  selecionarPerfilLogin('proprietario');

  HM4.client.auth.getSession().then(async ({ data, error }) => {
    if (error) return console.warn('Sessão Supabase:', error.message);
    if (!data.session) return;
    try {
      const profile = await getProfile(data.session.user);
      await setAuthenticatedUser(data.session.user, profile);
    } catch (e) { console.error(e); toast(`Não foi possível restaurar a sessão: ${e.message || e}`, 'error'); }
  });

  HM4.client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') stopRealtime();
  });

  HM4.createRequest = createRequest;
  HM4.loadMissions = loadMissions;
  HM4.toast = toast;
})();

// Render de imóveis com IDs UUID do Supabase (sem conversão numérica).
window.renderProperties = function () {
  const grid = document.getElementById('propertiesGrid');
  if (!grid) return;
  if (!propertiesState.length) {
    grid.innerHTML = '<div class="col-span-full rounded-2xl border border-dashed border-gray-700 bg-gray-950 p-8 text-center text-sm text-gray-400">Nenhum imóvel cadastrado ainda. Use “Cadastrar Imóvel” para adicionar o primeiro.</div>';
    return;
  }
  grid.innerHTML = propertiesState.map(p => `
    <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition flex flex-col justify-between">
      <div>
        <div class="h-44 w-full relative overflow-hidden bg-gray-950"><img src="${escapeServiceHTML(p.image || '')}" alt="${escapeServiceHTML(p.title)}" class="w-full h-full object-cover" loading="lazy">
          <span class="absolute top-3 right-3 text-xs px-2.5 py-1 rounded-full font-bold shadow-md ${p.status === 'Disponível' ? 'bg-emerald-500 text-gray-950' : p.status === 'Ocupado' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-gray-950'}">${escapeServiceHTML(p.status)}</span>
        </div>
        <div class="p-5 space-y-2"><h4 class="font-bold text-white text-base">${escapeServiceHTML(p.title)}</h4><p class="text-xs text-gray-400 flex items-center gap-1"><i class="fa-solid fa-location-dot text-indigo-400"></i>${escapeServiceHTML(p.address)}</p><p class="text-xs font-semibold text-emerald-400">${formatMoney(p.dailyRate)} <span class="text-gray-400 font-normal">/ diária</span></p></div>
      </div>
      <div class="p-5 pt-0 space-y-2">
        <a href="${escapeServiceHTML(p.airbnbUrl || '#')}" target="_blank" rel="noopener noreferrer" class="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-xl flex items-center justify-center gap-2 border border-gray-700 transition"><i class="fa-brands fa-airbnb text-rose-500 text-sm"></i>Acessar anúncio no Airbnb</a>
        <button type="button" onclick="openPropertyCalendar('${p.id}')" class="w-full py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-xs font-bold rounded-xl flex items-center justify-center gap-2 border border-sky-500/30 transition"><i class="fa-solid fa-calendar-days"></i>Calendário & Bloquear datas</button>
        <button type="button" onclick="requestKeyRushForProp('${p.id}')" class="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-bold rounded-xl flex items-center justify-center gap-2 border border-amber-500/30 transition"><i class="fa-solid fa-motorcycle"></i>Solicitar KeyRush Concierge</button>
      </div>
    </div>`).join('');
};

// Ajusta a solicitação rápida para receber o UUID do imóvel.
window.requestKeyRushForProp = async function (propertyId) {
  if (!['gestor','proprietario'].includes(perfilAutenticado)) return window.showToast?.('Somente Proprietário ou Gestor Master pode solicitar serviços.', 'error');
  const property = propertiesState.find(p => String(p.id) === String(propertyId) || p.title === propertyId);
  const service = servicesCatalog.find(s => s.active);
  if (!property || !service) return window.showToast?.('Imóvel ou serviço disponível não encontrado.', 'error');
  try { await window.HM4.createRequest(property.id, service.id, null, null); }
  catch (error) { window.showToast?.(error.message || String(error), 'error'); }
};
