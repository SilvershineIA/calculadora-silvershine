/* ═══════════════════════════════════════════════════════════
   app.js — Taller SilverShine ✕ Tonglin.
   Una sola app, dos caras: José (ES, oro rosa) arma órdenes y
   lotes, aprueba, paga y revisa CADs; Karen (EN, jade) sube su
   PDF de cotización, el CAD y el tracking. El ciclo completo:
   orden → lote → PI pdf → aprobar → link pago → comprobante
   (⏱ 15 días hábiles) → CAD ida/vuelta → PI final → pago final
   → tracking → recibido.
   ═══════════════════════════════════════════════════════════ */
const App = (() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fmtUSD = v => 'US$ ' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const MESen = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtFecha = iso => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return I18N.esKaren() ? `${MESen[m - 1]} ${d}` : `${d} ${MES[m - 1]}`;
  };
  /* 15 días hábiles (lun-vie) desde una fecha */
  function diasHabiles(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    let falta = n;
    while (falta > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) falta--; }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function toast(msj) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msj;
    el.classList.add('ver');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('ver'), 3200);
  }

  /* ── modal ── */
  function abrirModal(titulo, html) {
    cerrarModal();
    const f = document.createElement('div');
    f.className = 'modal-fondo';
    f.id = 'modalFondo';
    f.innerHTML = `<div class="modal"><div class="modal-cab"><h2>${titulo}</h2>
      <button class="modal-x" id="modalX">✕</button></div><div id="modalCuerpo">${html}</div></div>`;
    document.body.appendChild(f);
    $('#modalX').addEventListener('click', cerrarModal);
    f.addEventListener('click', e => { if (e.target === f) cerrarModal(); });
  }
  const cerrarModal = () => { const f = $('#modalFondo'); if (f) f.remove(); };

  /* ── archivos: comprimir imagen y pasar a blob ── */
  function comprimir(file, maxPx = 1400, calidad = 0.85) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const f = Math.min(1, maxPx / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * f);
        cv.height = Math.round(img.height * f);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => b ? res(b) : rej(new Error('imagen')), 'image/jpeg', calidad);
      };
      img.onerror = () => rej(new Error('No se pudo abrir la imagen'));
      img.src = URL.createObjectURL(file);
    });
  }
  const elegirArchivo = (accept, capture) => new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    if (capture) i.capture = 'environment';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
  const elegirArchivos = accept => new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = true;
    i.onchange = () => res([...i.files]);
    i.click();
  });
  /* Zona de arrastre: soltar imágenes encima también funciona */
  function zonaArrastre(el, alSoltar) {
    if (!el) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('arrastrando'); });
    el.addEventListener('dragleave', () => el.classList.remove('arrastrando'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();   // que la zona de adentro no se lo pase a la de afuera (foto doble)
      el.classList.remove('arrastrando');
      const archivos = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(f => f.type.startsWith('image/'));
      if (archivos.length) alSoltar(archivos);
    });
  }
  async function blobAB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function verArchivo(path) {
    try { window.open(await Nube.bajarArchivo(path), '_blank'); }
    catch (e) { toast('⚠ ' + e.message); }
  }
  /* pinta <img data-path> bajando cada archivo con auth */
  function pintarImagenes(raiz) {
    (raiz || document).querySelectorAll('img[data-path]').forEach(async img => {
      try { img.src = await Nube.bajarArchivo(img.dataset.path); } catch { img.alt = '⚠'; }
    });
  }

  /* ═══ datos ═══ */
  let docs = [];        // todos los documentos de la tabla `taller`
  const ordenes = () => docs.filter(d => d.tipo === 'orden');
  const lotes = () => docs.filter(d => d.tipo === 'lote');
  const eventos = () => docs.filter(d => d.tipo === 'ev');
  const doc = id => docs.find(d => d.id === id) || null;
  const piezasDe = loteId => ordenes().filter(o => o.loteId === loteId)
    .sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  const sueltas = () => ordenes().filter(o => !o.loteId)
    .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));

  async function guardarDoc(d) {
    const i = docs.findIndex(x => x.id === d.id);
    if (i >= 0) docs[i] = d; else docs.unshift(d);
    await Nube.upsertDoc(d);
  }

  /* evento para el otro lado (clave del diccionario + contexto neutro) */
  async function avisar(clave, ctx, loteId, ordenId) {
    const para = I18N.esKaren() ? 'jose' : 'karen';
    await guardarDoc({ id: uid('ev'), tipo: 'ev', para, clave, ctx: ctx || '', loteId: loteId || null, ordenId: ordenId || null, fecha: new Date().toISOString(), visto: false });
  }

  let cargandoRed = false;
  let faltaSQL = false;   // la tabla `taller` no existe aún en Supabase
  async function cargar(silencioso) {
    if (cargandoRed) return;
    cargandoRed = true;
    const b = $('#btnRefrescar');
    if (b) b.classList.add('girando');
    try {
      docs = await Nube.listarDocs();
      faltaSQL = false;
      /* No repintar debajo de los dedos del usuario: si está llenando la
         Nueva orden, escribiendo en un campo o con un modal abierto, los
         datos frescos esperan al próximo movimiento */
      const a = document.activeElement;
      const escribiendo = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
      if (silencioso && (vista === 'nueva' || escribiendo || $('#modalFondo'))) { /* nada */ }
      else render();
    } catch (e) {
      const msj = String(e.message || e);
      if (msj === 'SESION_EXPIRADA') { vista = 'login'; render(); }
      else if (/404|does not exist|relation|42P01/i.test(msj)) {
        /* la sesión está bien — lo que falta es correr taller-schema.sql */
        faltaSQL = true;
        render();
      } else {
        render();   // pintar el shell (con #toast) antes de avisar
        if (!silencioso) toast('⚠ ' + msj);
      }
    } finally {
      cargandoRed = false;
      const b2 = $('#btnRefrescar');
      if (b2) b2.classList.remove('girando');
    }
  }

  /* ═══ estado del lote (derivado de lo que existe — auto-reparable) ═══ */
  function estadoLote(l) {
    if (!l.enviado) return 'armando';
    if (!l.cot) return 'enviado';
    if (!l.aprobada) return 'cotizado';
    if (!l.comprobante) return l.linkPago ? 'porPagar' : 'aprobado';
    if (!l.cotFinal) return 'produccion';
    if (!l.comprobanteFinal) return 'final';
    if (!l.tracking) return 'pagoFinal';
    if (!l.recibido) return 'despachado';
    return 'recibido';
  }
  const ORDEN_ESTADOS = ['armando','enviado','cotizado','aprobado','porPagar','produccion','final','pagoFinal','despachado','recibido'];
  const BADGE_ESTADO = {
    armando:'b-gris', enviado:'b-rojo', cotizado:'b-rojo', aprobado:'b-rosa', porPagar:'b-rosa',
    produccion:'b-jade', final:'b-rojo', pagoFinal:'b-rosa', despachado:'b-gris', recibido:'b-verde',
  };
  /* a quién le toca el próximo paso */
  const LE_TOCA = { armando:'jose', enviado:'karen', cotizado:'jose', aprobado:'karen', porPagar:'jose',
    produccion:'karen', final:'jose', pagoFinal:'karen', despachado:'jose', recibido:null };

  const totalCot = l => (l.cot && l.cot.leida && l.cot.leida.total) || 0;
  const totalFinal = l => (l.cotFinal && l.cotFinal.leida && l.cotFinal.leida.total_final) || 0;

  /* ═══ navegación ═══ */
  let vista = 'novedades';           // novedades · lotes · nueva · ajustes · login
  let loteAbierto = null;
  let ordenAbierta = null;

  function nav(v) {
    vista = v;
    if (v !== 'lote') loteAbierto = null;
    if (v !== 'orden') ordenAbierta = null;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const karen = I18N.esKaren();
    document.body.className = karen ? 'rol-taller' : 'rol-jose';
    const app = $('#app');

    if (vista === 'login') { app.innerHTML = vLogin(); wireLogin(); return; }

    const sinVer = eventos().filter(e => e.para === (karen ? 'karen' : 'jose') && !e.visto).length;
    const tabs = karen
      ? [['novedades','🔔',T('novedades')],['lotes','🗂',T('lotes')],['ajustes','⚙️',T('ajustes')]]
      : [['novedades','🔔',T('novedades')],['lotes','🗂',T('lotes')],['nueva','＋',T('nueva')],['ajustes','⚙️',T('ajustes')]];
    const tabOn = (vista === 'lote' || vista === 'orden') ? 'lotes' : vista;

    app.innerHTML = `
      <div class="topbar">
        <h1>${T('app')}</h1>
        <button id="btnRefrescar" title="${T('actualizar')}">🔄</button>
        <span class="quien ${karen ? 'taller' : 'jose'}">${karen ? 'Karen' : 'José'}</span>
      </div>
      <main id="cuerpo"></main>
      <nav class="nav">${tabs.map(([k, ico, tx]) => `
        <button data-nav="${k}" class="${tabOn === k ? 'on' : ''} ${k === 'novedades' && sinVer ? 'punto' : ''}">
          <span class="ico">${ico}</span>${tx}</button>`).join('')}
      </nav>
      <div id="toast"></div>`;

    $$('.nav [data-nav]').forEach(b => b.addEventListener('click', () => nav(b.dataset.nav)));
    $('#btnRefrescar').addEventListener('click', () => cargar());

    const c = $('#cuerpo');
    if (vista === 'novedades') vNovedades(c);
    else if (vista === 'lotes') vLotes(c);
    else if (vista === 'lote') vLote(c);
    else if (vista === 'orden') vOrden(c);
    else if (vista === 'nueva') vNueva(c);
    else if (vista === 'ajustes') vAjustes(c);
  }

  /* ═══ login (José) ═══ */
  function vLogin() {
    const pista = Nube.pistaCRM() || {};
    return `<div class="login">
      <h1>SilverShine <span style="color:var(--rose)">✕</span> Tonglin</h1>
      <p class="sub">Taller de confecciones — entra con tu usuario del CRM.</p>
      <div class="card">
        <label>${T('a_url')}</label><input id="lgUrl" value="${esc(pista.url || '')}" placeholder="https://xxxx.supabase.co" autocomplete="off">
        <label>${T('a_anon')}</label><input id="lgAnon" value="${esc(pista.anonKey || '')}" autocomplete="off">
        <label>${T('a_email')}</label><input id="lgEmail" type="email" value="${esc(pista.email || '')}" autocomplete="username">
        <label>${T('a_clave')}</label><input id="lgPass" type="password" autocomplete="current-password">
        <button class="btn rosa" id="lgEntrar">${T('a_conectar')}</button>
        <p class="sub" id="lgError" style="color:var(--red);margin-top:8px"></p>
      </div>
      <p class="sub">💡 Si el CRM ya está conectado en este dispositivo, la URL y la clave anon salen prellenadas — solo pon tu clave.</p>
    </div>`;
  }
  function wireLogin() {
    $('#lgEntrar').addEventListener('click', async () => {
      const [url, anon, email, pass] = ['#lgUrl', '#lgAnon', '#lgEmail', '#lgPass'].map(s => $(s).value.trim());
      if (!url || !anon || !email || !pass) { $('#lgError').textContent = T('a_errLogin'); return; }
      $('#lgEntrar').disabled = true;
      try {
        await Nube.conectarJose(url.replace(/\/+$/, ''), anon, email, pass);
        I18N.setRol('jose');
        vista = 'novedades';
        await cargar();
      } catch (e) {
        $('#lgError').textContent = T('a_errLogin') + ' — ' + e.message;
        $('#lgEntrar').disabled = false;
      }
    });
  }

  /* ═══ novedades ═══ */
  function vNovedades(c) {
    const karen = I18N.esKaren();
    const mios = eventos().filter(e => e.para === (karen ? 'karen' : 'jose'))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const nuevos = mios.filter(e => !e.visto);
    const viejos = mios.filter(e => e.visto).slice(0, 8);

    const fila = (e, punto) => `
      <div class="card click" data-ev="${e.id}">
        <div class="fila">${punto ? '<span class="punto-rojo"></span>' : ''}
          <div class="crece">
            <div class="nombre">${T('ev_' + e.clave)}</div>
            <div class="sub">${esc(e.ctx)} · ${fmtFecha(e.fecha)}</div>
          </div><span class="sub">›</span>
        </div>
      </div>`;

    c.innerHTML = `
      ${faltaSQL ? `<div class="card" style="border-color:var(--red)">
        <div class="nombre rojo">⚠ ${I18N.esKaren() ? 'Setup pending — ask José.' : 'Falta el paso 2 del setup'}</div>
        <div class="sub" style="margin-top:4px">${I18N.esKaren() ? '' : `Tu conexión funcionó ✓, pero la tabla del taller no existe todavía en Supabase.
          Ve a <b>Supabase → SQL Editor → New query</b>, pega TODO el contenido de <b>taller-schema.sql</b> y presiona <b>Run</b>.
          Después toca 🔄 aquí arriba.`}</div>
      </div>` : ''}
      <div class="h-sec">${T('novedades')}</div>
      ${nuevos.length ? nuevos.map(e => fila(e, true)).join('')
        : `<div class="vacio"><span>✓</span>${T('sinNovedades')}</div>`}
      ${viejos.length ? `<div class="h-sec" style="opacity:.7">···</div>` + viejos.map(e => fila(e, false)).join('') : ''}`;

    $$('#cuerpo [data-ev]').forEach(el => el.addEventListener('click', async () => {
      const e = doc(el.dataset.ev);
      if (e && !e.visto) { e.visto = true; guardarDoc(e); }
      if (e && e.loteId && doc(e.loteId)) { loteAbierto = e.loteId; ordenAbierta = e.ordenId || null; nav(e.ordenId && doc(e.ordenId) ? 'orden' : 'lote'); }
      else render();
    }));
  }

  /* ═══ lista de lotes ═══ */
  function filaLote(l) {
    const est = estadoLote(l);
    const n = piezasDe(l.id).length;
    const tot = totalCot(l);
    const meToca = LE_TOCA[est] === (I18N.esKaren() ? 'karen' : 'jose');
    return `
      <div class="card click" data-lote="${l.id}">
        <div class="fila">${meToca ? '<span class="punto-rojo"></span>' : ''}
          <div class="crece">
            <div class="nombre">🗂 ${esc(l.nombre)}</div>
            <div class="sub">${n} ${n === 1 ? T('pieza') : T('piezas')}${tot ? ` · <span class="money">${fmtUSD(tot)}</span>` : ''}${l.comprobante && !l.tracking ? ` · ${T('l_entregaEst')} <b>${fmtFecha(l.entregaEst)}</b>` : ''}</div>
          </div>
          <span class="badge ${BADGE_ESTADO[est]}">${T('e_' + est)}</span>
        </div>
      </div>`;
  }

  function vLotes(c) {
    const karen = I18N.esKaren();
    let visibles = lotes().filter(l => karen ? l.enviado : true);
    const activos = visibles.filter(l => estadoLote(l) !== 'recibido')
      .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
    const listos = visibles.filter(l => estadoLote(l) === 'recibido')
      .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));

    let html = `<div class="h-sec">${T('lotes')}</div>`;
    html += activos.length ? activos.map(filaLote).join('')
      : `<div class="vacio"><span>🗂</span>${karen ? 'No batches yet.' : 'Sin lotes activos — crea órdenes en ＋ y ármalos aquí.'}</div>`;

    if (!karen) {
      const s = sueltas();
      if (s.length) {
        html += `<div class="h-sec">${T('o_suelta')} (${s.length})</div>` + s.map(o => `
          <div class="card click" data-orden="${o.id}">
            <div class="fila"><div class="crece">
              <div class="nombre">${esc(o.nombre)}</div>
              <div class="sub">${esc(o.material || '')}${o.noDisponible ? ` · <b class="rojo">${T('o_noDisp')}</b>` : ''}</div>
            </div><span class="sub">›</span></div>
          </div>`).join('');
      }
      html += `<button class="btn ghost" id="btnNuevoLote">＋ 🗂 ${I18N.esKaren() ? '' : 'Crear un lote nuevo'}</button>`;
    }
    if (listos.length) {
      html += `<div class="h-sec">${T('l_archivo')} (${listos.length})</div>` + listos.map(filaLote).join('');
    }
    c.innerHTML = html;

    $$('#cuerpo [data-lote]').forEach(el => el.addEventListener('click', () => { loteAbierto = el.dataset.lote; nav('lote'); }));
    $$('#cuerpo [data-orden]').forEach(el => el.addEventListener('click', () => { ordenAbierta = el.dataset.orden; nav('orden'); }));
    const bn = $('#btnNuevoLote');
    if (bn) bn.addEventListener('click', crearLote);
  }

  function crearLote() {
    abrirModal('🗂', `
      <label>${T('l_nuevoNombre')}</label><input id="nlNombre" autocomplete="off">
      <button class="btn rosa" id="nlOk">${T('guardar')}</button>`);
    $('#nlOk').addEventListener('click', async () => {
      const nombre = $('#nlNombre').value.trim();
      if (!nombre) return;
      const l = { id: uid('lote'), tipo: 'lote', nombre, creado: new Date().toISOString() };
      await guardarDoc(l);
      cerrarModal();
      loteAbierto = l.id;
      nav('lote');
    });
  }

  /* ═══ detalle del lote ═══ */
  function vLote(c) {
    const l = doc(loteAbierto);
    if (!l) { nav('lotes'); return; }
    const karen = I18N.esKaren();
    const est = estadoLote(l);
    const piezas = piezasDe(l.id);
    const idx = ORDEN_ESTADOS.indexOf(est);

    let html = `
      <button class="btn-sm" id="btnVolver">${T('volver')}</button>
      <div class="h-sec">🗂 ${esc(l.nombre)} · <span class="badge ${BADGE_ESTADO[est]}">${T('e_' + est)}</span></div>
      <div class="pasos">${ORDEN_ESTADOS.map((_, i) => `<span class="${i <= idx ? 'ok' : ''}"></span>`).join('')}</div>`;

    /* piezas */
    html += piezas.map(o => {
      const cadUlt = (o.cad || [])[Math.max(0, (o.cad || []).length - 1)];
      const cadTxt = !cadUlt ? '' :
        cadUlt.feedback && cadUlt.feedback.tipo === 'aprobado' ? ` · ${T('c_aprobado')}` :
        cadUlt.feedback ? ` · ${T('c_cambios')}` : ` · 🖌 CAD v${cadUlt.v}`;
      return `
      <div class="card click" data-orden="${o.id}">
        <div class="fila"><div class="crece">
          <div class="nombre">${esc(o.nombre)}${o.destino === 'etsy' ? ' 🛍' : ''}</div>
          <div class="sub">${esc(o.material || '')}${cadTxt}${(o.comentarios || []).length ? ' · 💬 ' + o.comentarios.length : ''}</div>
        </div><span class="sub">›</span></div>
      </div>`;
    }).join('') || `<div class="vacio"><span>🧵</span>${karen ? 'Empty batch.' : 'Sin piezas — agrégalas desde ＋ Nueva orden.'}</div>`;

    /* etsy: aviso de despacho directo si alguna pieza lo es */
    if (piezas.some(o => o.destino === 'etsy')) {
      html += `<div class="card"><div class="sub"><b>${T('l_shipDirect')}</b></div></div>`;
    }

    /* ── etapas ── */
    if (!karen) {
      if (est === 'armando') html += `<button class="btn rosa" id="btnEnviar" ${piezas.length ? '' : 'disabled'}>${T('l_enviar')}</button>`;
    } else {
      if (est === 'enviado') html += `<button class="btn jade" id="btnSubirPI">${T('l_subirPI')}</button>`;
    }

    /* cotización (PDF + números leídos) */
    if (l.cot) {
      html += `<div class="h-sec">💵 ${karen ? 'Quotation' : 'Cotización de Tonglin'}</div>
        <div class="tira"><span class="ico">📄</span>
          <div class="crece"><div class="nombre" style="font-size:13.5px">${esc(l.cot.pdfNombre || 'PI.pdf')}</div>
          <div class="sub">${l.cot.leida ? T('l_leido') : fmtFecha(l.cot.fecha)}</div></div>
          <button class="btn-sm" data-ver="${l.cot.pdfPath}">${T('verPdf')}</button>
        </div>`;
      if (l.cot.leida) {
        const le = l.cot.leida;
        html += `<div class="card"><table class="qt">
          ${(le.pieces || []).map(p => `<tr><td>${esc(p.description || ('#' + p.n))}${p.gold_weight_g ? ` <span class="sub mono">${p.gold_weight_g} g</span>` : ''}</td><td class="money">${fmtUSD(p.subtotal || p.exw_unit || 0)}</td></tr>`).join('')}
          <tr class="total"><td>${T('l_total')}</td><td class="money">${fmtUSD(le.total || 0)}</td></tr>
          <tr><td>${T('l_deposito')}</td><td class="money">${fmtUSD(le.deposit || (le.total || 0) / 2)}</td></tr>
        </table></div>`;
      } else if (!karen) {
        html += `<button class="btn rosa" id="btnLeerPI">${T('l_leerIA')}</button>`;
      }
      if (!karen && !l.aprobada && l.cot.leida) html += `<button class="btn rosa" id="btnAprobar">${T('l_aprobar')}</button>`;
      if (l.aprobada) html += `<div class="card"><div class="sub verde"><b>${T('l_aprobada')}</b> · ${fmtFecha(l.aprobada)}</div></div>`;
    }

    /* link de pago + comprobante (depósito) */
    if (l.aprobada) {
      html += `<div class="h-sec">💳 ${karen ? 'Deposit' : 'Pago del depósito'}</div>`;
      if (l.linkPago) {
        html += `<div class="tira"><span class="ico">🔗</span>
          <div class="crece"><div class="nombre" style="font-size:13.5px">${T('l_linkPago')}</div>
          <div class="sub money">${l.linkPago.monto ? fmtUSD(l.linkPago.monto) : ''} · ${fmtFecha(l.linkPago.fecha)}</div></div>
          <button class="btn-sm" data-link="${esc(l.linkPago.url)}">${T('abrirLink')}</button></div>`;
      } else if (karen) {
        html += `<button class="btn jade" id="btnLinkPago">${T('l_pegarLink')}</button>`;
      }
      if (l.comprobante) {
        html += `<div class="tira"><span class="ico">📎</span>
          <div class="crece"><div class="nombre" style="font-size:13.5px">${T('l_comprobanteOk')}</div>
          <div class="sub">${fmtFecha(l.comprobante.fecha)} · ${T('l_reloj')} → <b>${T('l_entregaEst')} ${fmtFecha(l.entregaEst)}</b></div></div>
          <button class="btn-sm" data-ver="${l.comprobante.path}">📷</button></div>`;
      } else if (!karen && l.linkPago) {
        html += `<button class="btn rosa" id="btnComprobante">${T('l_comprobante')}</button>`;
      }
    }

    /* cotización final */
    if (l.comprobante) {
      html += `<div class="h-sec">⚖️ ${karen ? 'Final quote & balance' : 'Cotización final y balance'}</div>`;
      if (l.cotFinal) {
        html += `<div class="tira"><span class="ico">📄</span>
          <div class="crece"><div class="nombre" style="font-size:13.5px">${esc(l.cotFinal.pdfNombre || 'PI-final.pdf')}</div>
          <div class="sub">${l.cotFinal.leida ? T('l_leido') : fmtFecha(l.cotFinal.fecha)}</div></div>
          <button class="btn-sm" data-ver="${l.cotFinal.pdfPath}">${T('verPdf')}</button></div>`;
        if (l.cotFinal.leida) {
          const lf = l.cotFinal.leida, tot = totalCot(l), fin = lf.total_final || 0;
          const dif = fin && tot ? fin - tot : 0;
          const pesoEst = ((l.cot && l.cot.leida && l.cot.leida.pieces) || []).reduce((s, p) => s + (Number(p.gold_weight_g) || 0), 0);
          const pesoReal = (lf.pieces || []).reduce((s, p) => s + (Number(p.gold_weight_g) || 0), 0);
          html += `<div class="card"><table class="qt">
            ${pesoEst && pesoReal ? `<tr><td>${T('l_pesoEstReal')}</td><td class="mono">${pesoEst.toFixed(2)} g → ${pesoReal.toFixed(2)} g</td></tr>` : ''}
            <tr><td>${T('l_precioFinal')}</td><td class="money">${fmtUSD(fin)}</td></tr>
            ${tot ? `<tr><td>${T('l_diferencia')}</td><td class="money ${dif > 0 ? 'rojo' : 'verde'}">${dif >= 0 ? '+' : '−'}${fmtUSD(Math.abs(dif))}${tot ? ` (${dif >= 0 ? '+' : '−'}${Math.abs(dif / tot * 100).toFixed(1)}%)` : ''}</td></tr>` : ''}
            ${lf.shipping ? `<tr><td>Shipping</td><td class="money">${fmtUSD(lf.shipping)}</td></tr>` : ''}
            <tr class="total"><td>${T('l_balance')}</td><td class="money">${fmtUSD(lf.balance_due || 0)}</td></tr>
          </table></div>`;
        } else if (!karen) {
          html += `<button class="btn rosa" id="btnLeerFinal">${T('l_leerIA')}</button>`;
        }
        if (l.linkPagoFinal) {
          html += `<div class="tira"><span class="ico">🔗</span>
            <div class="crece"><div class="nombre" style="font-size:13.5px">${T('l_linkPago')}</div>
            <div class="sub money">${l.linkPagoFinal.monto ? fmtUSD(l.linkPagoFinal.monto) : ''}</div></div>
            <button class="btn-sm" data-link="${esc(l.linkPagoFinal.url)}">${T('abrirLink')}</button></div>`;
        }
        if (l.comprobanteFinal) {
          html += `<div class="tira"><span class="ico">📎</span>
            <div class="crece"><div class="nombre" style="font-size:13.5px">📎 ${karen ? 'Final payment receipt' : 'Comprobante final subido'}</div>
            <div class="sub">${fmtFecha(l.comprobanteFinal.fecha)}</div></div>
            <button class="btn-sm" data-ver="${l.comprobanteFinal.path}">📷</button></div>`;
        } else if (!karen && l.linkPagoFinal) {
          html += `<button class="btn rosa" id="btnComprobanteFinal">${T('l_comprobFinal')}</button>`;
        }
      } else if (karen) {
        html += `<button class="btn jade" id="btnSubirFinal">${T('l_subirFinal')}</button>`;
      } else {
        html += `<div class="card"><div class="sub">🧵 ${T('e_produccion')} · ${T('l_entregaEst')} <b>${fmtFecha(l.entregaEst)}</b></div></div>`;
      }
    }

    /* tracking */
    if (l.comprobanteFinal || l.tracking) {
      html += `<div class="h-sec">${T('l_tracking')}</div>`;
      if (l.tracking) {
        html += `<div class="card"><div class="fila"><div class="crece">
          <div class="nombre mono">${esc(l.tracking.num)}</div>
          <div class="sub">${fmtFecha(l.tracking.fecha)}</div></div>
          <button class="btn-sm" data-copiar="${esc(l.tracking.num)}">${T('copiar')}</button>
        </div></div>`;
        if (!karen && !l.recibido) html += `<button class="btn rosa" id="btnRecibido">${T('l_recibido')}</button>`;
        if (l.recibido) html += `<div class="card"><div class="sub verde"><b>📦 ${fmtFecha(l.recibido)}</b></div></div>`;
      } else if (karen) {
        html += `<button class="btn jade" id="btnTracking">${T('l_ponerTracking')}</button>`;
      }
    }

    c.innerHTML = html;
    wireLote(l, piezas);
  }

  function wireLote(l, piezas) {
    $('#btnVolver').addEventListener('click', () => nav('lotes'));
    $$('#cuerpo [data-orden]').forEach(el => el.addEventListener('click', () => { ordenAbierta = el.dataset.orden; nav('orden'); }));
    $$('#cuerpo [data-ver]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); verArchivo(b.dataset.ver); }));
    $$('#cuerpo [data-link]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); window.open(b.dataset.link, '_blank'); }));
    $$('#cuerpo [data-copiar]').forEach(b => b.addEventListener('click', () => { navigator.clipboard.writeText(b.dataset.copiar); toast(T('copiado')); }));

    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };

    on('#btnEnviar', async () => {
      l.enviado = hoyISO();
      await guardarDoc(l);
      await avisar('loteEnviado', `${l.nombre} · ${piezas.length}`, l.id);
      toast(T('l_enviado'));
      render();
    });

    on('#btnSubirPI', async () => {
      const f = await elegirArchivo('application/pdf');
      if (!f) return;
      toast(T('subiendo'));
      try {
        const path = `lotes/${l.id}/pi-${Date.now()}.pdf`;
        await Nube.subirArchivo(path, f, 'application/pdf');
        l.cot = { pdfPath: path, pdfNombre: f.name, fecha: hoyISO() };
        await guardarDoc(l);
        await avisar('cotizado', l.nombre, l.id);
        toast(T('l_piSubido'));
        render();
      } catch (e) { toast('⚠ ' + e.message); }
    });

    on('#btnLeerPI', () => leerPDF(l, 'inicial'));
    on('#btnLeerFinal', () => leerPDF(l, 'final'));

    on('#btnAprobar', async () => {
      l.aprobada = hoyISO();
      await guardarDoc(l);
      await avisar('aprobado', `${l.nombre} · ${fmtUSD(totalCot(l))}`, l.id);
      toast(T('l_aprobada'));
      render();
    });

    on('#btnLinkPago', () => modalLinkPago(l, 'linkPago', 'linkPago'));

    on('#btnComprobante', async () => {
      const f = await elegirArchivo('image/*', true);
      if (!f) return;
      toast(T('subiendo'));
      try {
        const blob = await comprimir(f);
        const path = `lotes/${l.id}/comprobante-${Date.now()}.jpg`;
        await Nube.subirArchivo(path, blob, 'image/jpeg');
        l.comprobante = { path, fecha: hoyISO() };
        l.prodInicio = hoyISO();
        l.entregaEst = diasHabiles(hoyISO(), 15);
        await guardarDoc(l);
        await avisar('comprobante', `${l.nombre} · ${fmtFecha(l.entregaEst)}`, l.id);
        toast(T('l_comprobanteOk'));
        render();
      } catch (e) { toast('⚠ ' + e.message); }
    });

    on('#btnSubirFinal', async () => {
      const f = await elegirArchivo('application/pdf');
      if (!f) return;
      toast(T('subiendo'));
      try {
        const path = `lotes/${l.id}/pi-final-${Date.now()}.pdf`;
        await Nube.subirArchivo(path, f, 'application/pdf');
        l.cotFinal = { pdfPath: path, pdfNombre: f.name, fecha: hoyISO() };
        await guardarDoc(l);
        await avisar('final', l.nombre, l.id);
        toast(T('l_finalSubido'));
        modalLinkPago(l, 'linkPagoFinal', 'final');
      } catch (e) { toast('⚠ ' + e.message); }
    });

    on('#btnComprobanteFinal', async () => {
      const f = await elegirArchivo('image/*', true);
      if (!f) return;
      toast(T('subiendo'));
      try {
        const blob = await comprimir(f);
        const path = `lotes/${l.id}/comprobante-final-${Date.now()}.jpg`;
        await Nube.subirArchivo(path, blob, 'image/jpeg');
        l.comprobanteFinal = { path, fecha: hoyISO() };
        await guardarDoc(l);
        await avisar('pagoFinal', l.nombre, l.id);
        render();
      } catch (e) { toast('⚠ ' + e.message); }
    });

    on('#btnTracking', () => {
      abrirModal(T('l_ponerTracking'), `
        <label>${T('l_tracking')}</label><input id="trkNum" class="mono" autocomplete="off" placeholder="SF…">
        <button class="btn jade" id="trkOk">${T('guardar')}</button>`);
      $('#trkOk').addEventListener('click', async () => {
        const num = $('#trkNum').value.trim();
        if (!num) return;
        l.tracking = { num, fecha: hoyISO() };
        await guardarDoc(l);
        await avisar('tracking', `${l.nombre} · ${num}`, l.id);
        cerrarModal();
        render();
      });
    });

    on('#btnRecibido', async () => {
      l.recibido = hoyISO();
      await guardarDoc(l);
      toast('📦 ✓');
      render();
    });
  }

  function modalLinkPago(l, campo, clave) {
    abrirModal(T('l_pegarLink'), `
      <label>URL</label><input id="lpUrl" autocomplete="off" placeholder="https://…">
      <label>${T('l_monto')}</label><input id="lpMonto" type="number" min="0" step="0.01">
      <button class="btn jade" id="lpOk">${T('guardar')}</button>`);
    $('#lpOk').addEventListener('click', async () => {
      const url = $('#lpUrl').value.trim();
      if (!url) return;
      l[campo] = { url, monto: Number($('#lpMonto').value) || 0, fecha: hoyISO() };
      await guardarDoc(l);
      if (clave === 'linkPago') await avisar('linkPago', `${l.nombre}${l[campo].monto ? ' · ' + fmtUSD(l[campo].monto) : ''}`, l.id);
      cerrarModal();
      render();
    });
  }

  /* ── IA: leer el PDF de Tonglin (corre SOLO del lado de José) ── */
  async function leerPDF(l, cual) {
    if (!Nube.iaClave()) {
      abrirModal('🤖', `<p class="sub">${T('a_iaExpl')}</p>
        <label>${T('a_ia')}</label><input id="iaK" autocomplete="off" placeholder="sk-ant-…">
        <button class="btn rosa" id="iaOk">${T('guardar')}</button>`);
      $('#iaOk').addEventListener('click', () => {
        if ($('#iaK').value.trim()) { Nube.iaGuardarClave($('#iaK').value); cerrarModal(); leerPDF(l, cual); }
      });
      return;
    }
    const obj = cual === 'inicial' ? l.cot : l.cotFinal;
    abrirModal('🧠', `<p class="sub" style="text-align:center;padding:20px 8px">${T('l_leyendo')}</p>`);
    try {
      const b64 = await blobAB64(await Nube.bajarBlob(obj.pdfPath));
      const prompt = cual === 'inicial'
        ? `Este PDF es una PROFORMA INVOICE (PI) de Tonglin Jewelry Factory (joyería, precios en US$). Extrae los datos y responde SOLO un objeto JSON, sin texto extra:
{"invoice_no": "o null", "date": "YYYY-MM-DD o null", "total": total final (número), "deposit": depósito pedido (número o null), "pieces": [{"n": número de fila, "description": "qué es (ej: Ring 14K Yellow Gold, ruby)", "size": "o null", "gold_weight_g": peso de oro en gramos (número o null), "gold_cost": número o null, "labor": número o null, "stone_cost": número o null, "stone_setting_fee": número o null, "exw_unit": precio unitario EXW (número o null), "qty": cantidad, "cad_mold": costo CAD & mold (número o null), "subtotal": subtotal de la fila (número)}]}
Si el PDF no es una cotización legible responde {"error": "motivo corto"}.`
        : `Este PDF es la factura/cotización FINAL de Tonglin Jewelry Factory (joyería, US$), con el peso REAL de oro tras producción. Extrae y responde SOLO un objeto JSON:
{"total_final": total final del lote (número), "shipping": costo de envío (número o null), "balance_due": lo que falta por pagar (número; si no aparece, calcula total_final + shipping − depósitos que mencione), "pieces": [{"n": fila, "description": "qué es", "gold_weight_g": peso REAL en gramos (número o null), "subtotal": subtotal final (número)}]}
Si no es legible responde {"error": "motivo corto"}.`;
      const datos = await Nube.iaLeerPDF(b64, prompt);
      if (datos.error) throw new Error(datos.error);
      obj.leida = datos;
      await guardarDoc(l);
      cerrarModal();
      toast('🧠 ✓');
      render();
    } catch (e) {
      cerrarModal();
      const msj = e.message === 'CLAVE_IA_INVALIDA' ? 'La clave de IA no es válida — revísala en Ajustes' : e.message;
      abrirModal('🧠 ⚠', `<p class="sub">${esc(msj)}</p><p class="sub" style="margin-top:8px">El PDF quedó guardado — puedes reintentar la lectura o mirar los números directo en el PDF.</p>`);
    }
  }

  /* ═══ detalle de una pieza ═══ */
  function vOrden(c) {
    const o = doc(ordenAbierta);
    if (!o) { nav('lotes'); return; }
    const karen = I18N.esKaren();
    const l = o.loteId ? doc(o.loteId) : null;
    const est = l ? estadoLote(l) : null;

    const filaSpec = (k, v) => v ? `<div class="k">${k}</div><div>${v}</div>` : '';
    let html = `
      <button class="btn-sm" id="btnVolver">${T('volver')}</button>
      <div class="h-sec">${esc(o.nombre)}${l ? ` · 🗂 ${esc(l.nombre)}` : ''}</div>`;

    if (o.noDisponible) html += `<div class="card"><div class="sub rojo"><b>${T('o_noDisp')}</b> · ${fmtFecha(o.noDisponible.fecha)}${o.noDisponible.nota ? ' · ' + esc(o.noDisponible.nota) : ''}</div></div>`;
    if (!karen && o.destino) html += `<div class="card"><span class="badge ${o.destino === 'etsy' ? 'b-rojo' : 'b-gris'}">${T('o_' + o.destino)}</span>${o.destino === 'etsy' ? ` <span class="sub">· ${T('l_shipDirect')}</span>` : ''}</div>`;

    /* la orden — formato Tonglin */
    html += `<div class="card"><div class="spec">
      ${filaSpec(T('o_material'), esc(o.material))}
      ${filaSpec(T('o_size'), esc(o.size))}
      ${filaSpec(T('o_engraving'), esc(o.engraving))}
      ${filaSpec(T('o_stone'), esc(o.stone))}
      ${filaSpec(T('o_qty'), esc(o.qty))}
      ${filaSpec(T('o_cert'), esc(o.cert))}
      ${filaSpec(T('o_target'), o.target ? fmtFecha(o.target) : '')}
      ${filaSpec(T('o_special'), esc(o.special))}
      ${o.destino === 'etsy' ? filaSpec(T('o_etsyNum'), esc(o.etsyNum)) + filaSpec(T('o_shipTo'), esc(o.shipTo)) : ''}
    </div>
    ${o.igLink ? `<div class="sub" style="margin-top:8px">🔗 <a href="${esc(o.igLink)}" target="_blank" rel="noopener">${esc(o.igLink)}</a></div>` : ''}
    <div class="galeria">${(o.fotos || []).map(f => `<img data-path="${f.path}" alt="">`).join('')}</div>
    </div>`;

    /* CAD */
    html += `<div class="h-sec">${T('c_titulo')}</div>`;
    const cads = o.cad || [];
    if (!cads.length) html += `<div class="card"><div class="sub">${T('c_esperando')}</div></div>`;
    cads.forEach((cv, i) => {
      const fb = cv.feedback;
      html += `<div class="card">
        <div class="sub" style="margin-bottom:6px"><b>CAD ${T('c_v')} ${cv.v}</b> · ${fmtFecha(cv.fecha)}</div>
        <img class="cad-img" data-path="${cv.imgPath}" alt="CAD v${cv.v}">
        ${fb ? `<div class="sub" style="margin-top:8px">${fb.tipo === 'aprobado'
          ? `<b class="verde">${T('c_aprobado')}</b> · ${fmtFecha(fb.fecha)}`
          : `<b class="rojo">${T('c_cambios')}</b>: ${esc(fb.nota || '')}`}</div>` : ''}
        ${fb && fb.marcadoPath ? `<div class="sub" style="margin-top:6px">✏️:</div><img class="cad-img" data-path="${fb.marcadoPath}" alt="">` : ''}
        ${fb && (fb.refs || []).length ? `<div class="sub" style="margin-top:6px">${T('c_refs')}:</div><div class="galeria">${fb.refs.map(p => `<img data-path="${p}" alt="">`).join('')}</div>` : ''}
        ${!karen && i === cads.length - 1 && (!fb) ? `
          <button class="btn ghost" data-marcar="${i}">${T('c_marcar')}</button>
          <button class="btn rosa" data-cadok="${i}">${T('c_aprobar')}</button>` : ''}
      </div>`;
    });
    if (karen && l && l.comprobante) html += `<button class="btn jade" id="btnSubirCad">${T('c_subir')}</button>`;

    /* comentarios por pieza */
    const coms = o.comentarios || [];
    if (coms.length || (!karen && l && est === 'cotizado')) {
      html += `<div class="h-sec">💬</div>`;
      coms.forEach(cm => {
        html += `<div class="card"><div class="sub"><b>${cm.de === 'jose' ? 'José' : 'Karen'}</b> · ${fmtFecha(cm.fecha)}</div><div style="font-size:14px;margin-top:2px">${esc(cm.texto)}</div></div>`;
      });
      if (!karen && l && !l.aprobada && l.cot) html += `<button class="btn ghost" id="btnComentar">${T('l_comentar')}</button>`;
    }

    /* Karen: no disponible (solo antes de aprobar) */
    if (karen && l && (est === 'enviado' || est === 'cotizado') && !o.noDisponible) {
      html += `<button class="btn peligro" id="btnNoDisp">${T('o_marcarNoDisp')}</button>`;
    }
    /* José: borrar orden mientras el lote se arma */
    if (!karen && (!l || est === 'armando')) {
      html += `<button class="btn peligro" id="btnBorrarOrden">🗑 ${T('eliminar')}</button>`;
    }

    c.innerHTML = html;
    pintarImagenes(c);
    $('#btnVolver').addEventListener('click', () => { if (l) { loteAbierto = l.id; nav('lote'); } else nav('lotes'); });
    $$('#cuerpo img[data-path]').forEach(img => img.addEventListener('click', () => verArchivo(img.dataset.path)));

    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };

    $$('#cuerpo [data-cadok]').forEach(b => b.addEventListener('click', async () => {
      const cv = o.cad[Number(b.dataset.cadok)];
      cv.feedback = { tipo: 'aprobado', fecha: hoyISO() };
      await guardarDoc(o);
      await avisar('cadOk', o.nombre, o.loteId, o.id);
      toast(T('c_aprobado'));
      render();
    }));
    $$('#cuerpo [data-marcar]').forEach(b => b.addEventListener('click', () => marcarCad(o, Number(b.dataset.marcar))));

    on('#btnSubirCad', async () => {
      const f = await elegirArchivo('image/*');
      if (!f) return;
      toast(T('subiendo'));
      try {
        const blob = await comprimir(f, 1800, 0.88);
        const v = (o.cad || []).length + 1;
        const path = `ordenes/${o.id}/cad-v${v}-${Date.now()}.jpg`;
        await Nube.subirArchivo(path, blob, 'image/jpeg');
        o.cad = o.cad || [];
        o.cad.push({ v, imgPath: path, fecha: hoyISO() });
        await guardarDoc(o);
        await avisar('cad', `${o.nombre} · v${v}`, o.loteId, o.id);
        render();
      } catch (e) { toast('⚠ ' + e.message); }
    });

    on('#btnComentar', () => {
      abrirModal(T('l_comentar'), `
        <textarea id="cmTxt" placeholder=""></textarea>
        <button class="btn rosa" id="cmOk">${T('guardar')}</button>`);
      $('#cmOk').addEventListener('click', async () => {
        const texto = $('#cmTxt').value.trim();
        if (!texto) return;
        o.comentarios = o.comentarios || [];
        o.comentarios.push({ de: 'jose', texto, fecha: hoyISO() });
        await guardarDoc(o);
        await avisar('comentario', `${o.nombre}: ${texto.slice(0, 60)}`, o.loteId, o.id);
        cerrarModal();
        render();
      });
    });

    on('#btnNoDisp', async () => {
      if (!confirm(T('confirmar'))) return;
      o.noDisponible = { fecha: hoyISO() };
      const loteViejo = o.loteId;
      o.loteId = null;
      await guardarDoc(o);
      await avisar('noDisp', o.nombre, loteViejo, o.id);
      toast(T('o_devuelta'));
      loteAbierto = loteViejo;
      nav('lote');
    });

    on('#btnBorrarOrden', async () => {
      if (!confirm(T('confirmar'))) return;
      docs = docs.filter(d => d.id !== o.id);
      await Nube.borrarDoc(o.id);
      nav('lotes');
    });
  }

  /* ── rayar el CAD: dibujo sobre la imagen + nota + fotos de referencia ── */
  async function marcarCad(o, idx) {
    const cv = o.cad[idx];
    let imgUrl;
    try { imgUrl = await Nube.bajarArchivo(cv.imgPath); } catch (e) { toast('⚠ ' + e.message); return; }
    abrirModal(T('c_marcar'), `
      <canvas id="lienzoCad"></canvas>
      <div class="fila" style="margin-top:8px">
        <button class="btn-sm" id="czDeshacer">${T('c_deshacer')}</button>
      </div>
      <label>${T('c_nota')}</label><textarea id="czNota"></textarea>
      <label>${T('c_refs')}</label>
      <div class="galeria" id="czRefs"><button class="mas" id="czMas">＋</button></div>
      <button class="btn rosa" id="czEnviar">${T('c_enviarCambios')}</button>`);

    const lienzo = $('#lienzoCad');
    const img = new Image();
    const trazos = [];
    let trazo = null;
    const refs = [];   // blobs elegidos

    img.onload = () => {
      lienzo.width = img.width;
      lienzo.height = img.height;
      pintar();
    };
    img.src = imgUrl;

    const ctx = lienzo.getContext('2d');
    function pintar() {
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = '#e02418';
      ctx.lineWidth = Math.max(4, lienzo.width / 180);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const t of trazos.concat(trazo ? [trazo] : [])) {
        ctx.beginPath();
        t.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.stroke();
      }
    }
    const punto = e => {
      const r = lienzo.getBoundingClientRect();
      return [(e.clientX - r.left) * lienzo.width / r.width, (e.clientY - r.top) * lienzo.height / r.height];
    };
    lienzo.addEventListener('pointerdown', e => { e.preventDefault(); trazo = [punto(e)]; try { lienzo.setPointerCapture(e.pointerId); } catch {} });
    lienzo.addEventListener('pointermove', e => { if (trazo) { trazo.push(punto(e)); pintar(); } });
    lienzo.addEventListener('pointerup', () => { if (trazo && trazo.length > 1) trazos.push(trazo); trazo = null; pintar(); });
    $('#czDeshacer').addEventListener('click', () => { trazos.pop(); pintar(); });

    const agregarRefs = async archivos => {
      for (const f of archivos) {
        try {
          const blob = await comprimir(f);
          refs.push(blob);
          const im = document.createElement('img');
          im.src = URL.createObjectURL(blob);
          $('#czRefs').insertBefore(im, $('#czMas'));
        } catch { toast('⚠ ' + f.name); }
      }
    };
    $('#czMas').addEventListener('click', async () => agregarRefs(await elegirArchivos('image/*')));
    zonaArrastre($('#czRefs'), agregarRefs);

    $('#czEnviar').addEventListener('click', async () => {
      const nota = $('#czNota').value.trim();
      if (!nota && !trazos.length && !refs.length) return;
      $('#czEnviar').disabled = true;
      toast(T('subiendo'));
      try {
        const fb = { tipo: 'cambios', nota, fecha: hoyISO(), refs: [] };
        if (trazos.length) {
          const blob = await new Promise(res => lienzo.toBlob(res, 'image/jpeg', 0.88));
          fb.marcadoPath = `ordenes/${o.id}/cad-v${cv.v}-marcado-${Date.now()}.jpg`;
          await Nube.subirArchivo(fb.marcadoPath, blob, 'image/jpeg');
        }
        for (let i = 0; i < refs.length; i++) {
          const p = `ordenes/${o.id}/cad-v${cv.v}-ref${i + 1}-${Date.now()}.jpg`;
          await Nube.subirArchivo(p, refs[i], 'image/jpeg');
          fb.refs.push(p);
        }
        cv.feedback = fb;
        await guardarDoc(o);
        await avisar('cadCambios', `${o.nombre} · v${cv.v}${nota ? ': ' + nota.slice(0, 50) : ''}`, o.loteId, o.id);
        cerrarModal();
        toast('✏️ ✓');
        render();
      } catch (e) { toast('⚠ ' + e.message); $('#czEnviar').disabled = false; }
    });
  }

  /* ═══ nueva orden (José) ═══
     El formulario vive en un BORRADOR: moverse de pestaña, refrescar
     datos o mirar un lote a mitad de camino NO borra lo escrito. */
  let fotosNueva = [];   // blobs pendientes de subir (persisten entre renders)
  let borrador = null;   // campos a medio llenar
  function vNueva(c) {
    const lotesAbiertos = lotes().filter(l => estadoLote(l) === 'armando');
    const b = borrador || {};
    c.innerHTML = `
      <div class="h-sec">＋ ${T('nueva')}</div>
      <div class="card" id="noForm">
        <label>${T('o_destino')}</label>
        <div class="chips" id="noDestino">
          <button data-d="cliente" class="${(b.destino || 'cliente') === 'cliente' ? 'on' : ''}">${T('o_cliente')}</button>
          <button data-d="stock" class="${b.destino === 'stock' ? 'on' : ''}">${T('o_stock')}</button>
          <button data-d="etsy" class="${b.destino === 'etsy' ? 'on' : ''}">${T('o_etsy')}</button>
        </div>
        <div id="noEtsy" style="display:${b.destino === 'etsy' ? 'block' : 'none'}">
          <label>${T('o_etsyNum')}</label><input id="noEtsyNum" autocomplete="off" value="${esc(b.etsyNum || '')}">
          <label>${T('o_shipTo')}</label><textarea id="noShipTo">${esc(b.shipTo || '')}</textarea>
        </div>
        <label>${T('o_nombre')}</label><input id="noNombre" autocomplete="off" placeholder="Ej: Anillo rubí 14K — María" value="${esc(b.nombre || '')}">
        <label>${T('o_material')}</label>
        <div class="chips" id="noMatBase" style="margin-bottom:6px">
          <button data-m="925R" class="${b.matBase === '925R' ? 'on' : ''}">925 rodio</button>
          <button data-m="925V" class="${b.matBase === '925V' ? 'on' : ''}">925 vermeil 2.5μm</button>
          <button data-m="10K" class="${b.matBase === '10K' ? 'on' : ''}">10K</button>
          <button data-m="14K" class="${b.matBase === '14K' ? 'on' : ''}">14K</button>
          <button data-m="18K" class="${b.matBase === '18K' ? 'on' : ''}">18K</button>
        </div>
        <div class="chips" id="noMatColor" style="margin-bottom:6px;display:${/K$/.test(b.matBase || '') ? 'flex' : 'none'}">
          <button data-c="Yellow" class="${(b.matColor || 'Yellow') === 'Yellow' ? 'on' : ''}">🟡 Amarillo</button>
          <button data-c="White" class="${b.matColor === 'White' ? 'on' : ''}">⚪ Blanco</button>
          <button data-c="Rose" class="${b.matColor === 'Rose' ? 'on' : ''}">🌹 Rosa</button>
        </div>
        <input id="noMaterial" autocomplete="off" placeholder="14K Yellow Gold" value="${esc(b.material || '')}">
        <label>${T('o_fotos')}</label>
        <div class="galeria" id="noFotos"><button class="mas" id="noMas" title="También puedes ARRASTRAR imágenes aquí">＋</button></div>
        <label>${T('o_igLink')}</label><input id="noIg" autocomplete="off" placeholder="https://instagram.com/p/…" value="${esc(b.igLink || '')}">
        <div class="dos">
          <div><label>${T('o_size')}</label><input id="noSize" autocomplete="off" placeholder="US 7" value="${esc(b.size || '')}"></div>
          <div><label>${T('o_qty')}</label><input id="noQty" type="number" min="1" value="${esc(b.qty || '1')}"></div>
        </div>
        <label>${T('o_engraving')}</label><input id="noEng" autocomplete="off" value="${esc(b.engraving || '')}">
        <label>${T('o_stone')}</label>
        <div class="chips" id="noPiedraTipo" style="margin-bottom:6px">
          <button data-p="Cubic Zirconia">Circonia</button>
          <button data-p="Moissanite" class="on">Moissanita</button>
          <button data-p="Lab grown diamond">Diamante lab</button>
        </div>
        <div class="chips chips-mini" id="noPiedraCorte" style="margin-bottom:6px">
          <button data-c="Round" class="on">● Redondo</button>
          <button data-c="Oval">⬭ Oval</button>
          <button data-c="Princess">◆ Princesa</button>
          <button data-c="Emerald cut">▭ Esmeralda</button>
          <button data-c="Cushion">▢ Cojín</button>
          <button data-c="Pear">💧 Pera</button>
          <button data-c="Marquise">◗ Marquesa</button>
          <button data-c="Radiant">◇ Radiante</button>
          <button data-c="Heart">♥ Corazón</button>
        </div>
        <div class="fila" style="align-items:flex-end;gap:8px;margin-bottom:6px">
          <div style="flex:1"><label style="margin-top:0" id="noPiedraMmLbl">mm</label><input id="noPiedraMm" type="number" step="0.1" min="0" placeholder="6.5"></div>
          <div style="flex:1;display:none" id="noPiedraMm2Wrap"><label style="margin-top:0">× mm</label><input id="noPiedraMm2" type="number" step="0.1" min="0" placeholder="6"></div>
          <div style="flex:1"><label style="margin-top:0">CT</label><input id="noPiedraCt" type="number" step="0.01" min="0" placeholder="1.0"></div>
          <button type="button" class="btn-sm" id="noPiedraAdd" style="flex:0 0 auto;padding:10px 16px">＋ piedra</button>
        </div>
        <textarea id="noStone" placeholder="Centro: lab ruby round 1.2 CT…">${esc(b.stone || '')}</textarea>
        <div class="dos">
          <div><label>${T('o_cert')}</label><input id="noCert" autocomplete="off" placeholder="No cert / IGI / GIA" value="${esc(b.cert || '')}"></div>
          <div><label>${T('o_target')}</label><input id="noTarget" type="date" value="${esc(b.target || '')}"></div>
        </div>
        <label>${T('o_special')}</label><textarea id="noSpecial">${esc(b.special || '')}</textarea>
        <label>${T('o_lote')}</label>
        <select id="noLote">
          ${lotesAbiertos.map(l => `<option value="${l.id}" ${b.loteId === l.id ? 'selected' : ''}>🗂 ${esc(l.nombre)}</option>`).join('')}
          <option value="__nuevo__" ${b.loteId === '__nuevo__' ? 'selected' : ''}>${T('o_loteNuevo')}</option>
          <option value="" ${b.loteId === '' ? 'selected' : ''}>(${T('o_suelta')})</option>
        </select>
        <div id="noLoteNuevo" style="display:none">
          <label>${T('l_nuevoNombre')}</label><input id="noLoteNombre" autocomplete="off" value="${esc(b.loteNombre || '')}">
        </div>
        <button class="btn rosa" id="noGuardar">${T('guardar')}</button>
      </div>`;

    if (!lotesAbiertos.length && !('loteId' in b)) $('#noLote').value = '__nuevo__';
    $('#noLoteNuevo').style.display = $('#noLote').value === '__nuevo__' ? 'block' : 'none';

    /* borrador: cada tecla queda guardada — cambiar de pestaña no borra nada */
    const anotar = () => {
      const chipOn = sel => { const x = $(sel); return x ? x.dataset : {}; };
      borrador = {
        matBase: chipOn('#noMatBase button.on').m || '',
        matColor: chipOn('#noMatColor button.on').c || 'Yellow',
        destino: ($('#noDestino button.on') || {}).dataset ? $('#noDestino button.on').dataset.d : 'cliente',
        etsyNum: $('#noEtsyNum').value, shipTo: $('#noShipTo').value,
        nombre: $('#noNombre').value, material: $('#noMaterial').value,
        igLink: $('#noIg').value, size: $('#noSize').value, qty: $('#noQty').value,
        engraving: $('#noEng').value, stone: $('#noStone').value,
        cert: $('#noCert').value, target: $('#noTarget').value, special: $('#noSpecial').value,
        loteId: $('#noLote').value, loteNombre: $('#noLoteNombre').value,
      };
    };
    $('#noForm').addEventListener('input', anotar);

    /* fotos ya elegidas: se re-pintan al volver */
    for (const blob of fotosNueva) {
      const im = document.createElement('img');
      im.src = URL.createObjectURL(blob);
      $('#noFotos').insertBefore(im, $('#noMas'));
    }
    const agregarFotos = async archivos => {
      for (const f of archivos) {
        try {
          const blob = await comprimir(f);
          fotosNueva.push(blob);
          const im = document.createElement('img');
          im.src = URL.createObjectURL(blob);
          $('#noFotos').insertBefore(im, $('#noMas'));
        } catch { toast('⚠ ' + f.name); }
      }
    };
    zonaArrastre($('#noFotos'), agregarFotos);
    zonaArrastre($('#noForm'), agregarFotos);

    /* material rápido: base + color (el campo queda en el inglés que
       Tonglin entiende, y sigue editable a mano) */
    const armarMaterial = () => {
      const base = ($('#noMatBase button.on') || {}).dataset;
      if (!base) return;
      const esOro = /K$/.test(base.m);
      $('#noMatColor').style.display = esOro ? 'flex' : 'none';
      const color = (($('#noMatColor button.on') || {}).dataset || {}).c || 'Yellow';
      $('#noMaterial').value =
        base.m === '925R' ? '925 Silver — Rhodium plated' :
        base.m === '925V' ? '925 Silver — Vermeil 2.5μm gold plated' :
        `${base.m} ${color} Gold`;
      anotar();
    };
    $$('#noMatBase button').forEach(btn => btn.addEventListener('click', () => {
      $$('#noMatBase button').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
      if (/K$/.test(btn.dataset.m) && !$('#noMatColor button.on')) $('#noMatColor button').classList.add('on');
      armarMaterial();
    }));
    $$('#noMatColor button').forEach(btn => btn.addEventListener('click', () => {
      $$('#noMatColor button').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
      armarMaterial();
    }));

    /* piedras rápidas: tipo + mm/CT → cada ＋ agrega una línea al detalle
       (una pieza puede llevar centro + laterales) */
    $$('#noPiedraTipo button').forEach(btn => btn.addEventListener('click', () => {
      $$('#noPiedraTipo button').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
    }));
    /* los cortes fancy (todo menos redondo) se miden largo × ancho */
    const ajustarMm = () => {
      const corte = (($('#noPiedraCorte button.on') || {}).dataset || {}).c || 'Round';
      const fancy = corte !== 'Round';
      $('#noPiedraMm2Wrap').style.display = fancy ? 'block' : 'none';
      $('#noPiedraMmLbl').textContent = fancy ? 'mm largo' : 'mm';
    };
    $$('#noPiedraCorte button').forEach(btn => btn.addEventListener('click', () => {
      $$('#noPiedraCorte button').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
      ajustarMm();
    }));
    ajustarMm();
    $('#noPiedraAdd').addEventListener('click', () => {
      const tipo = (($('#noPiedraTipo button.on') || {}).dataset || {}).p;
      if (!tipo) return;
      const corte = (($('#noPiedraCorte button.on') || {}).dataset || {}).c || '';
      const mm = Number($('#noPiedraMm').value) || 0;
      const mm2 = corte !== 'Round' ? (Number($('#noPiedraMm2').value) || 0) : 0;
      const medida = mm && mm2 ? `${mm}×${mm2} mm` : mm ? `${mm} mm` : '';
      const ct = Number($('#noPiedraCt').value) || 0;
      const linea = [tipo, corte, medida, ct ? `${ct} CT` : ''].filter(Boolean).join(' — ');
      const t = $('#noStone');
      t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + linea;
      $('#noPiedraMm').value = '';
      $('#noPiedraMm2').value = '';
      $('#noPiedraCt').value = '';
      anotar();
    });

    $$('#noDestino button').forEach(btn => btn.addEventListener('click', () => {
      $$('#noDestino button').forEach(x => x.classList.remove('on'));
      btn.classList.add('on');
      $('#noEtsy').style.display = btn.dataset.d === 'etsy' ? 'block' : 'none';
      anotar();
    }));
    $('#noLote').addEventListener('change', () => {
      $('#noLoteNuevo').style.display = $('#noLote').value === '__nuevo__' ? 'block' : 'none';
      anotar();
    });
    $('#noMas').addEventListener('click', async () => {
      agregarFotos(await elegirArchivos('image/*'));
    });

    $('#noGuardar').addEventListener('click', async () => {
      const nombre = $('#noNombre').value.trim();
      if (!nombre) { toast('⚠ ' + T('o_nombre')); $('#noNombre').focus(); return; }
      $('#noGuardar').disabled = true;
      toast(T('subiendo'));
      try {
        let loteId = $('#noLote').value || null;
        if (loteId === '__nuevo__') {
          const ln = $('#noLoteNombre').value.trim() || hoyISO().slice(5);
          const l = { id: uid('lote'), tipo: 'lote', nombre: ln, creado: new Date().toISOString() };
          await guardarDoc(l);
          loteId = l.id;
        }
        const destino = $('#noDestino button.on').dataset.d;
        const o = {
          id: uid('ord'), tipo: 'orden', creado: new Date().toISOString(),
          nombre, destino,
          material: $('#noMaterial').value.trim(),
          size: $('#noSize').value.trim(),
          engraving: $('#noEng').value.trim(),
          stone: $('#noStone').value.trim(),
          qty: $('#noQty').value || '1',
          cert: $('#noCert').value.trim(),
          target: $('#noTarget').value || '',
          special: $('#noSpecial').value.trim(),
          igLink: $('#noIg').value.trim(),
          etsyNum: destino === 'etsy' ? $('#noEtsyNum').value.trim() : '',
          shipTo: destino === 'etsy' ? $('#noShipTo').value.trim() : '',
          loteId, fotos: [],
        };
        for (let i = 0; i < fotosNueva.length; i++) {
          const p = `ordenes/${o.id}/foto-${i + 1}.jpg`;
          await Nube.subirArchivo(p, fotosNueva[i], 'image/jpeg');
          o.fotos.push({ path: p });
        }
        await guardarDoc(o);
        borrador = null;      // orden guardada: borrador y fotos quedan limpios
        fotosNueva = [];
        toast(T('o_guardada'));
        loteAbierto = loteId;
        nav(loteId ? 'lote' : 'lotes');
      } catch (e) {
        toast('⚠ ' + e.message);
        $('#noGuardar').disabled = false;
      }
    });
  }

  /* ═══ ajustes ═══ */
  function vAjustes(c) {
    const info = Nube.info() || {};
    if (I18N.esKaren()) {
      /* Lado de Karen: solo salir (y la salida de emergencia si José
         abrió el link de ella en su propio dispositivo) */
      c.innerHTML = `
        <div class="h-sec">${T('ajustes')}</div>
        <div class="card"><div class="sub">👤 ${esc(info.email || '')}</div></div>
        <div class="card"><div class="sub">To sign back in, just open your link again — it never expires.</div></div>
        <button class="btn peligro" id="ajSalir">${T('a_salir')}</button>`;
      $('#ajSalir').addEventListener('click', () => {
        if (!confirm(T('confirmar'))) return;
        Nube.desconectar();
        location.reload();
      });
      return;
    }
    c.innerHTML = `
      <div class="h-sec">${T('ajustes')}</div>
      <div class="card">
        <div class="sub">☁️ ${esc(info.url || '')}<br>👤 ${esc(info.email || '')}</div>
      </div>
      <div class="h-sec">${T('a_linkKaren')}</div>
      <div class="card">
        <p class="sub">${T('a_linkExpl')}</p>
        <label>Email</label><input id="ajKEmail" autocomplete="off" placeholder="taller@silvershine.com.do">
        <label>Password</label><input id="ajKPass" autocomplete="off">
        <button class="btn rosa" id="ajGenerar">${T('a_generar')}</button>
        <div id="ajLink" style="display:none">
          <label>Link</label><textarea id="ajLinkTxt" readonly style="min-height:90px;font-size:12px"></textarea>
          <button class="btn ghost" id="ajCopiar">${T('copiar')}</button>
        </div>
      </div>
      <div class="h-sec">${T('a_ia')}</div>
      <div class="card">
        <p class="sub">${T('a_iaExpl')}</p>
        <label>API key</label><input id="ajIa" autocomplete="off" value="${Nube.iaClave() ? '••••••••' : ''}" placeholder="sk-ant-…">
        <button class="btn ghost" id="ajIaOk">${T('guardar')}</button>
      </div>
      <button class="btn peligro" id="ajSalir">${T('a_salir')}</button>`;

    $('#ajGenerar').addEventListener('click', () => {
      const e = $('#ajKEmail').value.trim(), p = $('#ajKPass').value.trim();
      if (!e || !p) return;
      $('#ajLinkTxt').value = Nube.armarLink(e, p);
      $('#ajLink').style.display = 'block';
    });
    $('#ajCopiar').addEventListener('click', () => {
      navigator.clipboard.writeText($('#ajLinkTxt').value);
      toast(T('copiado'));
    });
    $('#ajIaOk').addEventListener('click', () => {
      const v = $('#ajIa').value.trim();
      if (v && !v.startsWith('•')) { Nube.iaGuardarClave(v); toast('🤖 ✓'); }
    });
    $('#ajSalir').addEventListener('click', () => {
      if (!confirm(T('confirmar'))) return;
      Nube.desconectar();
      location.reload();
    });
  }

  /* ═══ arranque ═══ */
  async function init() {
    /* ¿Viene con el link secreto de Karen? */
    const linkKaren = Nube.leerLink(location.hash);
    let avisoLink = '';
    if (linkKaren) {
      history.replaceState(null, '', location.pathname);
      const yo = Nube.info();
      if (yo && yo.rol === 'jose') {
        /* José abrió el link de Karen en SU dispositivo: no dejar que le
           secuestre la sesión — para probar el lado de ella, incógnito */
        avisoLink = '🔗 Ese link es el de Karen — sigues conectado como tú. Para ver su lado, ábrelo en una ventana de incógnito.';
      } else {
        try {
          await Nube.conectarTaller(linkKaren.u, linkKaren.a, linkKaren.e, linkKaren.p);
        } catch (e) {
          document.body.innerHTML = `<div class="login"><h1>Tonglin</h1><p class="sub">This link is not valid anymore — ask José for a new one.<br><span style="opacity:.6">${esc(e.message)}</span></p></div>`;
          return;
        }
      }
    }
    if (Nube.conectado()) {
      I18N.setRol(Nube.rol());
      vista = 'novedades';
      $('#app').innerHTML = `<div class="vacio" style="padding-top:30vh"><span>🧵</span>${T('cargando')}</div>`;
      await cargar();
      if (avisoLink) toast(avisoLink);
    } else {
      I18N.setRol('jose');
      vista = 'login';
      render();
    }

    /* refrescar al volver a la app y cada 90 s si está visible */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Nube.conectado() && vista !== 'login') cargar(true);
    });
    setInterval(() => {
      if (!document.hidden && Nube.conectado() && vista !== 'login') cargar(true);
    }, 90000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
