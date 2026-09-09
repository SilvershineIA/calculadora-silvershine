/* ═══════════════════════════════════════════════════════════
   leads.js — Leads de WhatsApp (Fase 2: Meta Conversions API).
   Los leads los escribe el agente de WhatsApp (Voiceflow + Claude) en
   la tabla `leads` de Supabase, con el ctwa_clid del clic del anuncio.
   Aquí el CRM los muestra (Mi Día, Clientes), los vincula a un cliente
   por teléfono normalizado y los pasa a cotización / factura llevando el
   `leadId`. Los eventos a Meta (Lead al calificar, Purchase al pagarse la
   factura) NO los manda este archivo: los disparan triggers en la base
   de datos → Edge Function `meta-capi`. Aquí solo se leen sus sellos.
   La tabla vive SOLO en la nube (no es colección local): se lee bajo
   demanda con Sync.api y se cachea 20 s.
   ═══════════════════════════════════════════════════════════ */
const Leads = (() => {
  const { $, $$, esc, toast, fmtFecha, abrirModal } = UI;

  const ORIGEN = { ad: '📣 Anuncio', organico: '🌱 Orgánico', instagram: '📸 Instagram', web: '🌐 Web' };
  const OCASION = { compromiso: 'Compromiso', trio: 'Trío', duo: 'Dúo', aros: 'Aros', regalo: 'Regalo', confeccion: 'Confección' };
  const MATERIAL = { plata: 'Plata', vermeil: 'Vermeil', oro: 'Oro' };
  const recorta = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const nombreDe = l => l.nombre || UI.telefonoBonito(l.telefono) || 'Sin nombre';
  const fmtHora = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  /* "hace 12 min", "hace 3 h", "ayer", o la fecha */
  const cuando = iso => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
    if (min < 48 * 60) return 'ayer';
    return fmtFecha(iso.slice(0, 10));
  };

  /* ── Acceso a la nube ── */
  const disponible = () => typeof Sync !== 'undefined' && Sync.conectado();
  let cache = null, cacheTs = 0, sinTabla = false;
  const SIN_TABLA = /42P01|does not exist|PGRST205|Could not find the table/i;

  /* null = no hay nube o falta la tabla; [] = sin leads */
  async function listar(fresco) {
    if (!disponible()) return null;
    if (!fresco && cache && Date.now() - cacheTs < 20000) return cache;
    try {
      cache = await Sync.api('GET', 'leads?select=*&order=created_at.desc&limit=200');
      cacheTs = Date.now();
      sinTabla = false;
      return cache;
    } catch (e) {
      if (SIN_TABLA.test(e.message)) { sinTabla = true; return null; }
      throw e;
    }
  }
  const invalidar = () => { cache = null; };

  async function get(id, fresco) {
    const lista = await listar(fresco);
    const enCache = lista && lista.find(l => l.id === id);
    if (enCache || !disponible()) return enCache || null;
    const filas = await Sync.api('GET', `leads?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return (filas && filas[0]) || null;
  }
  async function actualizar(id, cambios) {
    const filas = await Sync.api('PATCH', `leads?id=eq.${encodeURIComponent(id)}&select=*`, cambios, 'return=representation');
    invalidar();
    return (filas && filas[0]) || null;
  }
  async function eliminar(id) {
    await Sync.api('DELETE', `leads?id=eq.${encodeURIComponent(id)}`);
    invalidar();
  }
  const eventos = (filtro = '') =>
    Sync.api('GET', `capi_eventos?select=*&order=created_at.desc&limit=30${filtro}`);

  /* ── Lead ↔ cliente: por teléfono normalizado (una sola regla) ── */
  async function clienteDe(lead) {
    if (lead.cliente_id) {
      const c = await DB.clientes.get(lead.cliente_id);
      if (c) return c;
    }
    const tel = UI.normalizarTelefono(lead.telefono);
    if (!tel) return null;
    return (await DB.clientes.list()).find(c => UI.normalizarTelefono(c.telefono) === tel) || null;
  }
  const notaDe = l => [
    `Lead de WhatsApp · ${ORIGEN[l.origen] || l.origen || 'origen desconocido'}${l.ad_headline ? ` · «${l.ad_headline}»` : ''}`,
    [OCASION[l.ocasion] || l.ocasion, MATERIAL[l.material] || l.material].filter(Boolean).join(' · '),
    l.resumen || '',
  ].filter(Boolean).join('\n');

  /* Busca el cliente por teléfono; si no existe lo crea. Guarda cliente_id en el lead. */
  async function vincular(lead, silencioso) {
    let c = await clienteDe(lead);
    if (!c) {
      c = await DB.clientes.upsert({
        nombre: lead.nombre || `WhatsApp ${UI.telefonoBonito(lead.telefono)}`,
        telefono: UI.telefonoBonito(lead.telefono),
        usuarioWA: '', correo: '', direccion: '',
        notas: notaDe(lead),
      });
      if (!silencioso) toast(`👤 Cliente "${c.nombre}" creado desde el lead`);
    } else if (!silencioso) toast(`👤 Vinculado a ${c.nombre}`);
    if (lead.cliente_id !== c.id) await actualizar(lead.id, { cliente_id: c.id });
    lead.cliente_id = c.id;
    return c;
  }

  /* ── Pintado ── */
  function badges(l) {
    const b = [];
    if (l.escalado) b.push(`<span class="badge b-roja" title="El agente pidió pasar con José el ${fmtHora(l.escalado_at)} — el bot está en pausa en ese chat">🔥 Te toca</span>`);
    b.push(l.calificado ? '<span class="badge b-pag">✔ Calificado</span>' : '<span class="badge b-pend">Nuevo</span>');
    if (l.cliente_id) b.push('<span class="badge b-anu">👤 Vinculado</span>');
    if (l.factura_id) b.push('<span class="badge b-anu">🧾 Facturado</span>');
    if (l.evento_lead_enviado_at) b.push(`<span class="badge b-meta" title="Lead reportado a Meta el ${fmtHora(l.evento_lead_enviado_at)}">📣 Lead ✓</span>`);
    if (l.evento_compra_enviado_at) b.push(`<span class="badge b-meta" title="Compra reportada a Meta el ${fmtHora(l.evento_compra_enviado_at)}">📣 Compra ✓</span>`);
    if (l.capi_ultimo_error) b.push(`<span class="badge b-roja" title="${esc(l.capi_ultimo_error)}">⚠ Meta: ${esc(recorta(l.capi_ultimo_error, 26))}</span>`);
    else if (!l.ctwa_clid) b.push('<span class="badge b-anu" title="Llegó sin el clic del anuncio (ctwa_clid): Meta no podría atribuirlo, no se le reportan eventos">sin clic de anuncio</span>');
    return b.join(' ');
  }
  const fila = l => `
    <div class="lead-fila" data-id="${l.id}">
      <div class="avatar">${l.origen === 'ad' ? '📣' : '💬'}</div>
      <div class="item-info">
        <div class="item-name">${esc(nombreDe(l))}${l.nombre ? ` <span class="muted" style="font-weight:400">· ${esc(UI.telefonoBonito(l.telefono))}</span>` : ''}</div>
        <div class="item-sub">${[
          ORIGEN[l.origen] || l.origen,
          l.ad_headline && `«${l.ad_headline}»`,
          OCASION[l.ocasion] || l.ocasion,
          MATERIAL[l.material] || l.material,
          cuando(l.created_at),
        ].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="lead-badges">${badges(l)}</div>
      </div>
      <div class="lead-acc">
        <button type="button" class="btn-gold btn-sm" data-a="wa" title="WhatsApp">💬</button>
        ${l.calificado ? '' : '<button type="button" class="btn-ghost btn-sm" data-a="calificar" title="Marcar calificado → se reporta a Meta como Lead">✔</button>'}
        <button type="button" class="btn-ghost btn-sm" data-a="vincular" title="${l.cliente_id ? 'Ver cliente' : 'Vincular a cliente'}">👤</button>
        <button type="button" class="btn-ghost btn-sm" data-a="cotizar" title="Cotizar">📋</button>
        <button type="button" class="btn-ghost btn-sm" data-a="mas" title="Detalle">⋯</button>
      </div>
    </div>`;

  async function accion(l, a, repintar) {
    if (a === 'wa') {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp({ nombre: nombreDe(l), telefono: l.telefono },
        `Hola${l.nombre ? ' ' + l.nombre : ''} 👋 Le saluda *${UI.quienSaluda(emp)}* ✨\n\n`);
    } else if (a === 'calificar') {
      await actualizar(l.id, { calificado: true });
      toast(l.ctwa_clid ? '✔ Calificado — se reporta a Meta como Lead' : '✔ Calificado (sin clic de anuncio: no se reporta a Meta)');
      repintar();
    } else if (a === 'vincular') {
      const c = await vincular(l);
      repintar();
      Clientes.ficha(c.id);
    } else if (a === 'cotizar') {
      const c = await vincular(l, true);
      repintar();
      Cotizaciones.formulario({ clienteId: c.id, clienteNombre: c.nombre, leadId: l.id });
    } else if (a === 'facturar') {
      const c = await vincular(l, true);
      repintar();
      Facturas.formulario({ clienteId: c.id, clienteNombre: c.nombre, leadId: l.id });
    } else if (a === 'mas') {
      detalle(l.id);
    }
  }

  function wire(cont, lista, repintar) {
    const porId = new Map(lista.map(l => [l.id, l]));
    cont.onclick = async e => {
      if (e.target.closest('.lead-refrescar')) { invalidar(); repintar(); return; }
      const ir = e.target.closest('[data-ir]');
      if (ir) { const b = $$('.nav-btn').find(x => x.dataset.view === ir.dataset.ir); if (b) b.click(); return; }
      const f = e.target.closest('.lead-fila');
      if (!f) return;
      const l = porId.get(f.dataset.id);
      if (!l) return;
      const btn = e.target.closest('[data-a]');
      try { await accion(l, btn ? btn.dataset.a : 'mas', repintar); }
      catch (err) { toast('⚠ ' + err.message); }
    };
  }

  async function pintar(cont, opts) {
    if (!cont) return;
    if (!disponible()) { cont.innerHTML = ''; return; }
    let lista;
    try { lista = await listar(opts.fresco); }
    catch (e) { cont.innerHTML = `<div class="card"><p class="muted">⚠ Leads de WhatsApp: ${esc(e.message)}</p></div>`; return; }
    if (lista === null) { cont.innerHTML = ''; return; }        // sin tabla: Ajustes lo explica
    const sel = opts.filtro(lista);
    if (!sel.length && !opts.siempre) { cont.innerHTML = ''; return; }
    cont.innerHTML = `
      <div class="card lead-card">
        <h2>💬 ${opts.titulo}
          <span class="lead-cnt">${opts.resumen(sel, lista)}</span>
          <button type="button" class="btn-ghost btn-sm lead-refrescar" title="Actualizar">↻</button></h2>
        ${sel.length ? sel.map(fila).join('')
          : '<p class="muted">Sin leads por ahora — cuando alguien escriba desde un anuncio, el agente lo anota aquí.</p>'}
        ${opts.pie ? opts.pie(sel, lista) : ''}
      </div>`;
    wire(cont, sel, () => pintar(cont, { ...opts, fresco: true }));
  }

  /* Mi Día: lo que pide atención — sin vincular, o de los últimos 7 días */
  const pintarDia = cont => pintar(cont, {
    titulo: 'Leads de WhatsApp',
    filtro: lista => {
      const hace7 = Date.now() - 7 * 864e5;
      // Los escalados ("te toca") primero; luego sin vincular o recientes
      return lista.filter(l => l.escalado || !l.cliente_id || new Date(l.created_at).getTime() > hace7)
        .sort((a, b) => (b.escalado ? 1 : 0) - (a.escalado ? 1 : 0)).slice(0, 8);
    },
    resumen: (sel, lista) => `${lista.filter(l => l.escalado).length ? `🔥 ${lista.filter(l => l.escalado).length} te tocan · ` : ''}${
      lista.filter(l => !l.cliente_id).length} sin vincular · ${lista.filter(l => l.calificado).length} calificados`,
    pie: (sel, lista) => lista.length > sel.length
      ? `<p class="muted" style="margin-top:8px"><button type="button" class="btn-ghost btn-sm" data-ir="clientes">Ver los ${lista.length} leads en Clientes →</button></p>` : '',
  });

  /* Clientes: todos los recientes */
  const pintarClientes = cont => pintar(cont, {
    titulo: 'Leads de WhatsApp',
    filtro: lista => lista.slice(0, 40),
    resumen: (sel, lista) => `${lista.length} en total · ${lista.filter(l => !l.cliente_id).length} sin vincular`,
    pie: (sel, lista) => lista.length > sel.length ? `<p class="muted" style="margin-top:8px">Mostrando ${sel.length} de ${lista.length}.</p>` : '',
  });

  /* ── Detalle del lead ── */
  async function detalle(id) {
    let l;
    try { l = await get(id, true); } catch (e) { toast('⚠ ' + e.message); return; }
    if (!l) { toast('Lead no encontrado en la nube'); return; }
    const cliente = l.cliente_id ? await DB.clientes.get(l.cliente_id) : null;
    const facts = (await DB.facturas.list()).filter(f => f.leadId === l.id || f.id === l.factura_id)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const cots = (await DB.cotizaciones.list()).filter(c => c.leadId === l.id)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    let evs = [];
    try { evs = await eventos(`&lead_id=eq.${encodeURIComponent(l.id)}`); } catch { /* bitácora opcional */ }
    const pagada = facts.find(f => f.estado === 'pagada');

    const nav = [
      cliente && { t: '👤 Cliente', on: () => Clientes.ficha(cliente.id) },
      ...cots.slice(0, 2).map(c => ({ t: `📋 COT-${c.numero}`, on: () => Cotizaciones.detalle(c.id) })),
      ...facts.slice(0, 2).map(f => ({ t: `🧾 ${f.orden ? '#' + f.orden : (f.numero || 'Factura')}`, on: () => Facturas.detalle(f.id) })),
    ].filter(Boolean);

    const metaLead = l.evento_lead_enviado_at ? ['verde', `✓ ${fmtHora(l.evento_lead_enviado_at)}`]
      : !l.ctwa_clid ? ['', 'no se envía (sin clic de anuncio)']
      : l.calificado ? ['rojo', l.capi_ultimo_error ? 'falló' : 'en camino…'] : ['', 'se envía al calificar'];
    const metaCompra = l.evento_compra_enviado_at ? ['verde', `✓ ${fmtHora(l.evento_compra_enviado_at)}`]
      : !l.ctwa_clid ? ['', 'no se envía (sin clic de anuncio)']
      : pagada ? ['rojo', l.capi_ultimo_error ? 'falló' : 'en camino…'] : ['', 'se envía al pagarse su factura'];

    abrirModal(`💬 ${nombreDe(l)}`, `
      ${UI.navChips(nav)}
      <div class="lead-badges" style="margin-bottom:10px">${badges(l)}</div>
      <div class="muted" style="line-height:1.8;margin-bottom:8px">
        📞 <a href="tel:${esc(l.telefono)}">${esc(UI.telefonoBonito(l.telefono))}</a> · ${esc(ORIGEN[l.origen] || l.origen || 'origen desconocido')}${
          l.ad_headline ? ` · «${esc(l.ad_headline)}»` : ''}${l.ad_id ? ` · anuncio ${esc(l.ad_id)}` : ''}<br>
        💍 ${esc([OCASION[l.ocasion] || l.ocasion, MATERIAL[l.material] || l.material].filter(Boolean).join(' · ') || 'sin detalle de pieza')} · llegó ${fmtHora(l.created_at)}<br>
        ${l.ctwa_clid ? `🔗 clic de anuncio <span title="${esc(l.ctwa_clid)}">${esc(recorta(l.ctwa_clid, 22))}</span>` : '🔗 sin ctwa_clid — Meta no puede atribuir este lead a un anuncio'}
      </div>
      ${l.resumen ? `<div class="nota-privada">🤖 <b>Resumen del agente:</b> ${esc(l.resumen)}</div>` : ''}

      <h3 class="sub-h">📣 Reporte a Meta</h3>
      <div class="abono-row"><span>Evento Lead (al calificar)</span><b class="${metaLead[0]}">${metaLead[1]}</b></div>
      <div class="abono-row"><span>Evento Purchase (al pagarse la factura)</span><b class="${metaCompra[0]}">${metaCompra[1]}</b></div>
      ${l.capi_ultimo_error ? `<div class="deuda-banner" style="margin-top:8px">⚠ ${esc(l.capi_ultimo_error)}</div>` : ''}
      ${evs.length ? `<h3 class="sub-h">Bitácora</h3>` + evs.map(e => `
        <div class="abono-row"><span>${e.ok ? '✅' : '❌'} ${esc(e.event_name)} · ${fmtHora(e.created_at)}${
          e.valor ? ` · ${UI.fmtMoneda(e.valor, e.moneda)}` : ''}${e.intentos > 1 ? ` · ${e.intentos} intentos` : ''}</span>
        <span class="muted" title="${esc(e.error || (e.respuesta && e.respuesta.fbtrace_id) || '')}">${
          e.ok ? (e.respuesta && e.respuesta.events_received ? `recibido (${e.respuesta.events_received})` : 'recibido') : esc(recorta(e.error, 34))}</span></div>`).join('') : ''}

      <div class="row" style="margin-top:14px">
        <button class="btn-ghost btn-block" id="lWA">💬 WhatsApp</button>
        ${l.calificado ? '' : '<button class="btn-gold btn-block" id="lCalificar">✔ Calificar</button>'}
        <button class="btn-ghost btn-block" id="lVincular">👤 ${cliente ? 'Ver cliente' : 'Vincular a cliente'}</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost btn-block" id="lCotizar">📋 Cotizar</button>
        <button class="btn-ghost btn-block" id="lFacturar">🧾 Facturar</button>
      </div>
      ${l.ctwa_clid && l.calificado && !l.evento_lead_enviado_at
        ? '<button class="btn-ghost btn-block" id="lReLead" style="margin-top:10px">🔁 Reenviar Lead a Meta ahora</button>' : ''}
      ${l.ctwa_clid && pagada && !l.evento_compra_enviado_at
        ? '<button class="btn-ghost btn-block" id="lReCompra" style="margin-top:10px">🔁 Reenviar Purchase a Meta ahora</button>' : ''}
      <button class="btn-danger btn-block" id="lEliminar" style="margin-top:14px">Eliminar lead</button>
    `);
    UI.navWire(nav);
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', async () => { try { await fn(); } catch (e) { toast('⚠ ' + e.message); } }); };
    const refrescar = () => { invalidar(); repintarTodo(); };
    on('#lWA', () => accion(l, 'wa', refrescar));
    on('#lCalificar', async () => { await accion(l, 'calificar', refrescar); detalle(l.id); });
    on('#lVincular', () => accion(l, 'vincular', refrescar));
    on('#lCotizar', () => accion(l, 'cotizar', refrescar));
    on('#lFacturar', () => accion(l, 'facturar', refrescar));
    const manual = async body => {
      toast('📣 Enviando a Meta…');
      const r = await Sync.funcion('meta-capi', { type: 'MANUAL', forzar: true, ...body });
      toast((r.ok ? '✅ ' : '❌ ') + (r.accion || 'sin respuesta'));
      refrescar();
      detalle(l.id);
    };
    on('#lReLead', () => manual({ event: 'Lead', lead_id: l.id }));
    on('#lReCompra', () => manual({ event: 'Purchase', factura_id: pagada.id }));
    on('#lEliminar', async () => {
      if (!confirm(`¿Eliminar el lead de ${nombreDe(l)}? El cliente y sus facturas no se tocan.`)) return;
      await eliminar(l.id);
      UI.cerrarModal();
      toast('Lead eliminado');
      refrescar();
    });
  }

  function repintarTodo() {
    pintarDia($('#leadsDia'));
    pintarClientes($('#leadsClientes'));
  }

  /* ── Sello discreto en la factura: "Reportado a Meta ✓" ── */
  async function selloMeta(f, el) {
    if (!el || !f.leadId || !disponible()) return;
    try {
      const l = await get(f.leadId);
      if (!l) return;
      let ev = null;
      try { ev = (await eventos(`&event_id=eq.${encodeURIComponent(f.id + '-purchase')}`))[0] || null; } catch { /* sin bitácora */ }
      let html;
      if (ev && ev.ok) html = `<span class="badge b-meta" title="Purchase ${UI.fmtMoneda(ev.valor, ev.moneda)} · ${fmtHora(ev.created_at)}">📣 Reportado a Meta ✓</span>`;
      else if (ev && !ev.ok) html = `<span class="badge b-roja" title="${esc(ev.error || '')}">📣 Meta: ${esc(recorta(ev.error, 30))}</span>`;
      else if (f.estado === 'pagada' && l.ctwa_clid) html = '<span class="badge b-pend" title="El webhook lo envía solo; si no cambia, revisa Ajustes → Meta">📣 Meta: en camino…</span>';
      else html = `<span class="badge b-anu">💬 Lead de WhatsApp${l.ctwa_clid ? ' · se reporta al pagarse' : ' · sin clic de anuncio'}</span>`;
      el.innerHTML = ' ' + html;
    } catch { /* adorno: nunca rompe la factura */ }
  }

  /* ── Ajustes: estado y diagnóstico ── */
  async function pintarAjustes() {
    const el = $('#metaEstado');
    if (!el) return;
    if (!disponible()) { el.innerHTML = '⚪ Conecta la nube (tarjeta de arriba) para recibir los leads de WhatsApp.'; return; }
    el.innerHTML = '⏳ Consultando la nube…';
    try {
      const lista = await listar(true);
      if (lista === null) {
        el.innerHTML = '🟠 Falta crear las tablas: corre <b>supabase/meta-capi-schema.sql</b> en el SQL Editor de Supabase (pasos en SETUP-META-CAPI.md).';
        return;
      }
      const n = fn => lista.filter(fn).length;
      el.innerHTML = `🟢 Tabla de leads activa · <b>${lista.length}</b> leads · ${n(l => l.calificado)} calificados · ${n(l => l.ctwa_clid)} con clic de anuncio<br>` +
        `📣 Reportados a Meta: <b>${n(l => l.evento_lead_enviado_at)}</b> Lead · <b>${n(l => l.evento_compra_enviado_at)}</b> Purchase` +
        (n(l => l.capi_ultimo_error) ? ` · <span class="rojo">${n(l => l.capi_ultimo_error)} con error (ábrelos desde Clientes)</span>` : '');
    } catch (e) { el.innerHTML = `🔴 ${esc(e.message)}`; }
  }

  async function ping() {
    const out = $('#metaEventos');
    if (!disponible()) { toast('Conecta la nube primero'); return; }
    out.innerHTML = '<p class="muted">⏳ Preguntándole a la función meta-capi…</p>';
    try {
      const r = await Sync.funcion('meta-capi', { type: 'PING' });
      const c = r.config || {};
      const ok = v => v ? '✅' : '❌';
      out.innerHTML = `
        <div class="abono-row"><span>Función meta-capi</span><b class="verde">✅ desplegada · Graph ${esc(c.version || '?')}</b></div>
        <div class="abono-row"><span>META_DATASET_ID</span><b>${ok(c.dataset)}</b></div>
        <div class="abono-row"><span>META_ACCESS_TOKEN</span><b>${ok(c.token)}</b></div>
        <div class="abono-row"><span>META_WABA_ID</span><b>${ok(c.waba)}</b></div>
        <div class="abono-row"><span>CAPI_WEBHOOK_SECRET</span><b>${ok(c.webhook_secret)}</b></div>
        ${c.modo_prueba ? `<div class="abono-row"><span>Modo prueba (test_event_code)</span><b class="dorado">${esc(c.modo_prueba)} — quítalo cuando termines de probar</b></div>` : ''}
        <div class="abono-row"><span>Meta responde</span><b class="${r.meta ? (r.meta.ok ? 'verde' : 'rojo') : ''}">${
          r.meta ? (r.meta.ok ? `✅ dataset «${esc(r.meta.dataset)}»` : `❌ ${esc(r.meta.error)}`) : 'faltan dataset/token'}</b></div>`;
    } catch (e) {
      out.innerHTML = `<div class="deuda-banner">🔴 ${esc(/404/.test(e.message) ? 'La función meta-capi no está desplegada todavía (paso 3 de SETUP-META-CAPI.md)' : e.message)}</div>`;
    }
  }

  async function verEventos() {
    const out = $('#metaEventos');
    if (!disponible()) { toast('Conecta la nube primero'); return; }
    out.innerHTML = '<p class="muted">⏳ Cargando bitácora…</p>';
    try {
      const evs = await eventos();
      out.innerHTML = evs.length ? evs.map(e => `
        <div class="abono-row"><span>${e.ok ? '✅' : '❌'} <b>${esc(e.event_name)}</b> · ${fmtHora(e.created_at)}${
          e.valor ? ` · ${UI.fmtMoneda(e.valor, e.moneda)}` : ''}${e.intentos > 1 ? ` · ${e.intentos} intentos` : ''}</span>
        <span class="muted" title="${esc(e.error || '')}">${e.ok ? (e.respuesta && e.respuesta.fbtrace_id ? 'fbtrace ' + esc(recorta(e.respuesta.fbtrace_id, 14)) : 'recibido') : esc(recorta(e.error, 40))}</span></div>`).join('')
        : '<p class="muted">Todavía no se ha enviado ningún evento a Meta.</p>';
    } catch (e) {
      out.innerHTML = `<div class="deuda-banner">🔴 ${esc(SIN_TABLA.test(e.message) ? 'Falta correr supabase/meta-capi-schema.sql' : e.message)}</div>`;
    }
  }

  function init() {
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#btnMetaPing', ping);
    on('#btnMetaEventos', verEventos);
  }

  return { init, pintarDia, pintarClientes, pintarAjustes, detalle, selloMeta, vincular, listar, invalidar };
})();
