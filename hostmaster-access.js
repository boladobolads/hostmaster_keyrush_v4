/* HostMaster Access v1 - módulo integrado ao login V4 */
(function () {
  'use strict';
  const state = { devices: [], events: [], properties: [], busy: false };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = (m, t='info') => typeof window.showToast === 'function' ? window.showToast(m,t) : alert(m);
  const client = () => window.HM4 && window.HM4.ready && window.HM4.client ? window.HM4.client : null;

  function ensurePanel() {
    if ($('panel-access-master')) return;
    const main = document.querySelector('#main-ecosystem main');
    if (!main) return;
    const panel = document.createElement('section');
    panel.id = 'panel-access-master';
    panel.className = 'hidden space-y-6';
    panel.innerHTML = `
      <div class="rounded-2xl border border-cyan-500/30 bg-slate-900 p-5 sm:p-6 space-y-5">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><p class="text-[10px] uppercase tracking-[.2em] font-black text-cyan-300">Módulo integrado • mesmo login HostMaster</p>
            <h2 class="text-2xl font-black text-white mt-1">HostMaster Access</h2>
            <p class="text-sm text-slate-400 mt-1">Cadastre os dispositivos de cada imóvel. Uma casa pode ter vários aparelhos e fabricantes.</p></div>
          <button type="button" id="access-refresh" class="rounded-xl border border-cyan-500/40 px-4 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/10"><i class="fa-solid fa-rotate mr-2"></i>Atualizar</button>
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div class="rounded-xl bg-slate-950 border border-slate-800 p-4"><p class="text-[10px] uppercase text-slate-400">Equipamentos</p><p id="access-total" class="text-2xl font-black text-white">0</p></div>
          <div class="rounded-xl bg-slate-950 border border-slate-800 p-4"><p class="text-[10px] uppercase text-slate-400">AGL Home</p><p id="access-agl" class="text-2xl font-black text-cyan-300">0</p></div>
          <div class="rounded-xl bg-slate-950 border border-slate-800 p-4"><p class="text-[10px] uppercase text-slate-400">Primebras Rio</p><p id="access-primebras" class="text-2xl font-black text-violet-300">0</p></div>
        </div>
        <form id="access-device-form" class="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 space-y-4">
          <div class="flex items-center justify-between"><h3 class="font-black text-white">Cadastrar equipamento</h3><span class="text-[10px] text-cyan-300">Vários por imóvel</span></div>
          <div class="grid md:grid-cols-2 gap-3">
            <label class="text-xs text-slate-300 font-bold">Imóvel<select id="access-property" required class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"><option value="">Selecione um imóvel</option></select></label>
            <label class="text-xs text-slate-300 font-bold">Fabricante<select id="access-manufacturer" required class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"><option value="agl_home">AGL Home</option><option value="primebras_rio">Primebras Rio</option></select></label>
            <label class="text-xs text-slate-300 font-bold">Nome do equipamento<input id="access-name" required maxlength="80" placeholder="Ex.: Portão social" class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"></label>
            <label class="text-xs text-slate-300 font-bold">Tipo<select id="access-type" class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white">
              <option value="portao_social">Portão social</option><option value="portao_garagem">Portão da garagem</option><option value="porta_principal">Porta principal</option><option value="fechadura">Fechadura</option><option value="outro">Outro</option></select></label>
            <label class="text-xs text-slate-300 font-bold">Modelo (se souber)<input id="access-model" maxlength="100" placeholder="Modelo do aparelho" class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"></label>
            <label class="text-xs text-slate-300 font-bold">Identificação no fabricante (opcional)<input id="access-external-id" maxlength="120" placeholder="ID do dispositivo, se existir" class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"></label>
          </div>
          <label class="block text-xs text-slate-300 font-bold">Observações<textarea id="access-notes" rows="2" maxlength="500" placeholder="Local de instalação, informações úteis..." class="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 p-3 text-white"></textarea></label>
          <div class="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] leading-5 text-amber-200"><i class="fa-solid fa-shield-halved mr-1"></i> Cadastro não abre o portão. Não coloque senhas, tokens ou credenciais do fabricante neste formulário.</div>
          <button type="submit" class="rounded-xl bg-cyan-400 hover:bg-cyan-300 px-5 py-3 text-xs font-black text-slate-950"><i class="fa-solid fa-plus mr-2"></i>Salvar equipamento</button>
        </form>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div class="flex items-center justify-between"><h3 class="font-black text-white">Equipamentos cadastrados</h3><span id="access-count-label" class="text-xs text-slate-400">0 registros</span></div>
        <div id="access-device-list" class="space-y-3"><p class="text-sm text-slate-500">Carregando...</p></div>
      </div>
      <div class="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
        <h3 class="font-black text-white">Histórico de acessos</h3>
        <p class="text-xs text-slate-400">Os eventos aparecerão aqui quando a integração segura de abertura for ativada. Não são gerados eventos fictícios nesta versão.</p>
        <div id="access-event-list" class="text-sm text-slate-500">Nenhum evento registrado.</div>
      </div>`;
    main.appendChild(panel);
    $('access-refresh').addEventListener('click', load);
    $('access-device-form').addEventListener('submit', saveDevice);
    $('access-device-list').addEventListener('click', deleteDevice);
  }

  function propertyOptions() {
    const select = $('access-property');
    if (!select) return;
    const current = select.value;
    const props = state.properties;
    select.innerHTML = '<option value="">Selecione um imóvel</option>' + props.map(p => `<option value="${esc(p.id)}">${esc(p.title)} — ${esc(p.address)}</option>`).join('');
    if (props.some(p => p.id === current)) select.value = current;
  }

  function render() {
    $('access-total').textContent = state.devices.length;
    $('access-agl').textContent = state.devices.filter(d => d.manufacturer === 'agl_home').length;
    $('access-primebras').textContent = state.devices.filter(d => d.manufacturer === 'primebras_rio').length;
    $('access-count-label').textContent = state.devices.length + ' registro(s)';
    $('access-device-list').innerHTML = state.devices.length ? state.devices.map(d => {
      const p = state.properties.find(x => x.id === d.property_id);
      const brand = d.manufacturer === 'agl_home' ? 'AGL Home' : 'Primebras Rio';
      const status = ({pending:'Pendente de integração',ready:'Integração preparada',offline:'Desconectado',unsupported:'Modelo não suportado'})[d.integration_status] || d.integration_status;
      return `<article class="rounded-xl border border-slate-700 bg-slate-950/70 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><b class="text-white">${esc(d.device_name)}</b><span class="text-[10px] rounded-full px-2 py-1 bg-cyan-500/10 text-cyan-200">${brand}</span><span class="text-[10px] rounded-full px-2 py-1 bg-amber-500/10 text-amber-200">${esc(status)}</span></div>
        <p class="text-xs text-slate-400 mt-1">${esc(p?.title || 'Imóvel')} • ${esc(d.device_type)} ${d.model ? '• Modelo: '+esc(d.model) : '• Modelo não informado'}</p>
        ${d.external_device_id ? '<p class="text-[10px] text-slate-500 mt-1">ID: '+esc(d.external_device_id)+'</p>' : ''}${d.notes ? '<p class="text-xs text-slate-500 mt-1">'+esc(d.notes)+'</p>' : ''}</div>
        <button type="button" data-delete-device="${esc(d.id)}" class="self-start md:self-center rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10"><i class="fa-regular fa-trash-can mr-1"></i>Excluir</button>
      </article>`;
    }).join('') : '<p class="text-sm text-slate-500">Nenhum equipamento cadastrado. Use o formulário acima para começar.</p>';
  }

  async function load() {
    const db = client();
    if (!db) { toast('O Supabase ainda não está conectado. Entre novamente após configurar o backend.', 'error'); return; }
    try {
      const [p, d, e] = await Promise.all([
        db.from('properties').select('id,title,address').order('title'),
        db.from('access_devices').select('*').order('created_at', {ascending:false}),
        db.from('access_events').select('id,property_id,device_id,actor_label,method,result,created_at').order('created_at',{ascending:false}).limit(50)
      ]);
      if (p.error) throw p.error; if (d.error) throw d.error;
      state.properties = p.data || []; state.devices = d.data || []; state.events = e.error ? [] : (e.data || []);
      propertyOptions(); render();
      $('access-event-list').innerHTML = state.events.length ? '<div class="space-y-2">'+state.events.map(ev => {
        const dev = state.devices.find(x => x.id === ev.device_id);
        return '<div class="border-b border-slate-800 py-2 text-xs"><b class="text-slate-200">'+esc(ev.actor_label || 'Acesso')+'</b> • '+esc(dev?.device_name || 'Equipamento removido')+' • '+esc(ev.method)+' • '+esc(ev.result)+'<span class="block text-slate-500">'+new Date(ev.created_at).toLocaleString('pt-BR')+'</span></div>';
      }).join('')+'</div>' : 'Nenhum evento real registrado.';
    } catch (err) { toast('Falha ao carregar HostMaster Access: '+(err.message || err), 'error'); }
  }

  async function saveDevice(event) {
    event.preventDefault();
    const db = client();
    if (!db) return toast('Supabase não conectado.', 'error');
    const property_id = $('access-property').value;
    const device_name = $('access-name').value.trim();
    if (!property_id || !device_name) return toast('Selecione o imóvel e informe o nome do equipamento.', 'error');
    const payload = {
      property_id, device_name, manufacturer: $('access-manufacturer').value,
      device_type: $('access-type').value, model: $('access-model').value.trim(),
      external_device_id: $('access-external-id').value.trim(), notes: $('access-notes').value.trim(),
      created_by: window.currentUser?.id
    };
    try {
      const { error } = await db.from('access_devices').insert(payload);
      if (error) throw error;
      $('access-device-form').reset(); propertyOptions();
      toast('Equipamento cadastrado com sucesso.', 'success'); await load();
    } catch (err) { toast('Não foi possível salvar: '+(err.message || err), 'error'); }
  }

  async function deleteDevice(event) {
    const button = event.target.closest('[data-delete-device]');
    if (!button) return;
    const id = button.getAttribute('data-delete-device');
    if (!confirm('Deseja excluir este equipamento do imóvel?')) return;
    const db = client();
    try {
      const { error } = await db.from('access_devices').delete().eq('id', id);
      if (error) throw error;
      toast('Equipamento excluído.', 'success'); await load();
    } catch (err) { toast('Falha ao excluir: '+(err.message || err), 'error'); }
  }

  const originalConfigure = window.configurarInterfaceLogada;
  window.configurarInterfaceLogada = function () {
    if (typeof originalConfigure === 'function') originalConfigure();
    ensurePanel();
    if (window.perfilAutenticado === 'gestor') {
      const nav = $('dynamic-nav-tabs');
      if (nav && !$('tab-btn-access')) {
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'tab-btn-access';
        b.className = 'py-3 px-1 flex items-center gap-2 text-slate-400 hover:text-white';
        b.innerHTML = '<i class="fa-solid fa-door-open"></i> HostMaster Access';
        b.addEventListener('click', () => window.switchMasterTab && window.switchMasterTab('access'));
        nav.appendChild(b);
      }
    }
  };

  const originalSwitch = window.switchMasterTab;
  window.switchMasterTab = function (tab) {
    ensurePanel();
    const panel = $('panel-access-master');
    if (panel) panel.classList.add('hidden');
    if (typeof originalSwitch === 'function') originalSwitch(tab);
    if (tab === 'access' && window.perfilAutenticado === 'gestor') {
      document.querySelectorAll('#dynamic-nav-tabs button').forEach(b => b.className = 'py-3 px-1 flex items-center gap-2 text-slate-400 hover:text-white');
      const p = $('panel-access-master'); if (p) p.classList.remove('hidden');
      const b = $('tab-btn-access'); if (b) b.className = 'py-3 px-1 font-bold text-white flex items-center gap-2 border-b-2 border-cyan-400';
      load();
    }
  };

  document.addEventListener('DOMContentLoaded', ensurePanel);
  window.addEventListener('load', ensurePanel);
  window.HostMasterAccess = { load };
})();