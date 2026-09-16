/* ═══════════════════════════════════════════════════════════
   taller-rd.js — 🔨 El taller de Rubén DENTRO del CRM (vive en
   el módulo de Confecciones, botón "🔨 Taller RD").
   Los datos están en la tabla `taller` de la misma nube — la
   MISMA que lee la app de Rubén (/taller-rd/): docs tipo 'trd'
   (trabajo), 'pagoRD' (pago en lote) y 'ev' (novedades de Rubén
   para José). Aquí José crea órdenes con plantillas vivas, ve la
   deuda, paga en lote (el valor se SUMA al costo de la factura —
   salvo 🛡️ Garantía) y marca "me llegó de vuelta".
   ═══════════════════════════════════════════════════════════ */
const TallerRD = (() => {
  const { $, $$, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;
  const RD = v => UI.fmtDinero(v || 0);
  const hoyISO = () => UI.fechaISO();
  const uid = p => p + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ── cache local de los docs del taller (se refresca al abrir) ── */
  let docs = [];
  const trabajos = () => docs.filter(d => d.tipo === 'trd');
  const pagosRD = () => docs.filter(d => d.tipo === 'pagoRD')
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const novedades = () => docs.filter(d => d.tipo === 'ev' && d.para === 'jose' && d.trdId && !d.visto)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  const doc = id => docs.find(d => d.id === id) || null;

  async function bajar() {
    const PAG = 1000, out = [];
    for (let p = 0; p < 5; p++) {
      const filas = await Sync.api('GET', `taller?select=id,data&order=id&limit=${PAG}&offset=${p * PAG}`);
      for (const f of filas) out.push(f.data);
      if (filas.length < PAG) break;
    }
    docs = out;
  }
  /* write-through por la cola del sync: si no hay internet, sube al volver */
  function guardar(d) {
    const i = docs.findIndex(x => x.id === d.id);
    if (i >= 0) docs[i] = d; else docs.unshift(d);
    Sync.notificar('taller', 'upsert', d);
  }
  function borrar(id) {
    docs = docs.filter(d => d.id !== id);
    Sync.notificar('taller', 'remove', id);
  }

  /* ── modelo (idéntico al de la app de Rubén) ── */
  const TIPOS = { confeccion: 'Confeccionar', grabado: 'Grabado', montura: 'Montura', cambiar: 'Cambiar piedras', reparacion: 'Reparación', garantia: '🛡️ Garantía', otro: 'Otro' };
  const numTrd = t => '#' + (t.facturaOrden ? t.facturaOrden + '-' : '') + t.sec;
  const secSiguiente = () => Math.max(383, ...trabajos().map(t => Number(t.sec) || 0)) + 1;
  function estadoTrd(t) {
    if (t.pagado) return 'pagado';
    if (t.enviado) return 'enviadoRD';
    if (t.recibido) return 'enTaller';
    return 'porRecibir';
  }
  const BADGE = {
    porRecibir: ['b-roja', '📥 Rubén no lo ha recibido'],
    enTaller: ['b-pend', '🔨 En el taller'],
    enviadoRD: ['b-pend', '✅ Enviado — por pagar'],
    pagado: ['b-pag', '💵 Pagado'],
  };
  const deuda = () => trabajos().filter(t => t.enviado && !t.pagado);

  /* ── fotos: bucket `taller` con la sesión del CRM ── */
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
  async function subirFoto(path, blob) {
    const cfg = Sync.cfgPublica();
    const t = await Sync.token();
    const resp = await fetch(`${cfg.url}/storage/v1/object/taller/${path}`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: blob,
    });
    if (!resp.ok) throw new Error(`Storage ${resp.status}`);
  }
  const _urls = new Map();
  async function urlFoto(path) {
    if (_urls.has(path)) return _urls.get(path);
    const cfg = Sync.cfgPublica();
    const t = await Sync.token();
    const resp = await fetch(`${cfg.url}/storage/v1/object/taller/${path}`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${t}` },
    });
    if (!resp.ok) throw new Error(`Storage ${resp.status}`);
    const url = URL.createObjectURL(await resp.blob());
    _urls.set(path, url);
    return url;
  }
  function pintarFotos(raiz) {
    $$('img[data-tpath]', raiz).forEach(async img => {
      try { img.src = await urlFoto(img.dataset.tpath); } catch { img.alt = '⚠'; }
    });
  }
  /* Regla de José: TODA subida de archivos nace con arrastre */
  function zonaArrastre(el, alSoltar) {
    if (!el) return;
    el.addEventListener('dragover', e => { e.preventDefault(); el.style.outline = '2px dashed var(--gold, #B07F74)'; });
    el.addEventListener('dragleave', () => { el.style.outline = ''; });
    el.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      el.style.outline = '';
      const archivos = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(f => f.type.startsWith('image/'));
      if (archivos.length) alSoltar(archivos);
    });
  }

  const sinNube = () => {
    if (typeof Sync === 'undefined' || !Sync.conectado()) {
      toast('⚠ Conecta la nube en Ajustes — el Taller RD vive en Supabase');
      return true;
    }
    return false;
  };

  /* ═══ TABLERO ═══ */
  async function abrir() {
    if (sinNube()) return;
    abrirModal('🔨 Taller RD — Rubén', '<p class="muted">Cargando el taller…</p>');
    try { await bajar(); }
    catch (e) { $('#modalBody').innerHTML = `<p class="muted rojo">⚠ ${esc(e.message)}</p>`; return; }
    pintarTablero();
  }

  function pintarTablero() {
    const ts = trabajos();
    const activos = ts.filter(t => !(t.pagado && t.llegoDeVuelta))
      .sort((a, b) => (b.rush ? 1 : 0) - (a.rush ? 1 : 0) ||
        String(a.entrega || '9999').localeCompare(String(b.entrega || '9999')) ||
        (b.creado || '').localeCompare(a.creado || ''));
    const listos = ts.filter(t => t.pagado && t.llegoDeVuelta)
      .sort((a, b) => ((b.pagado || {}).fecha || '').localeCompare((a.pagado || {}).fecha || ''));
    const pend = deuda();
    const totalDeuda = pend.reduce((s, t) => s + (Number(t.valor) || 0), 0);
    const nov = novedades();

    const fila = t => {
      const [bcl, btx] = BADGE[estadoTrd(t)];
      return `
      <div class="item" data-trd="${t.id}">
        <div class="item-info">
          <div class="item-name">${numTrd(t)}${t.rush ? ' <span class="badge b-roja">🔴 RUSH</span>' : ''}
            <span class="badge ${bcl}">${btx}</span></div>
          <div class="item-sub"><b>${TIPOS[t.tipoTrabajo] || ''}</b>${t.facturaCRM ? ` · ${esc(t.facturaCRM.cliente || '')}` : ''} · ${esc(String(t.desc || '').split('\n')[0].slice(0, 60))}</div>
          <div class="item-sub">${[t.entrega ? `🎯 ${fmtFecha(t.entrega)}` : '', t.llegoDeVuelta ? '📦 de vuelta ✓' : ''].filter(Boolean).join(' · ')}</div>
        </div>
        ${t.valor != null ? `<b class="${t.pagado ? 'verde' : 'rojo'}">${RD(t.valor)}</b>` : '<span class="item-arrow">›</span>'}
      </div>`;
    };

    $('#modalBody').innerHTML = `
      ${nov.length ? `<h3 class="sub-h">🔔 Novedades de Rubén (${nov.length})</h3>` + nov.map(e => `
        <div class="item" data-ev="${e.id}">
          <div class="item-info">
            <div class="item-name" style="font-size:.9rem">${e.clave === 'rdEnviado' ? '🔨 Rubén terminó y ENVIÓ un trabajo — ya puso su valor'
              : e.clave === 'rdValor' ? '✏️ Rubén corrigió el valor de un trabajo'
              : '📥 Rubén recibió un trabajo'}</div>
            <div class="item-sub">${esc(e.ctx || '')} · ${fmtFecha(e.fecha)}</div>
          </div><span class="item-arrow">›</span>
        </div>`).join('') : ''}
      <div class="abono-row"><span><b>💵 Le debes a Rubén</b><br><span class="muted" style="font-size:.78rem">${pend.length ? `${pend.length} trabajo${pend.length === 1 ? '' : 's'} enviado${pend.length === 1 ? '' : 's'} sin pagar` : 'Nada pendiente ✓'}</span></span>
        <b class="${totalDeuda ? 'rojo' : 'verde'}">${RD(totalDeuda)}</b></div>
      <div class="row" style="margin:10px 0 4px">
        <button type="button" class="btn-gold btn-block" id="trdNueva">＋ Nueva orden</button>
        <button type="button" class="btn-ghost btn-block" id="trdPagar" ${pend.length ? '' : 'disabled'}>💵 Pagar a Rubén</button>
      </div>
      <h3 class="sub-h">En el taller (${activos.length})</h3>
      ${activos.map(fila).join('') || '<div class="empty"><span>🔨</span>Sin trabajos — crea el primero.</div>'}
      ${listos.length ? `<h3 class="sub-h">Terminados (${listos.length})</h3>` + listos.slice(0, 8).map(fila).join('') : ''}
      <p class="muted" style="margin-top:12px;font-size:.78rem">Rubén ve estos trabajos al instante en SU app (sin nombres de clientes) — el link se genera abajo.</p>
      <button type="button" class="btn-ghost btn-block" id="trdLink" style="margin-top:6px">🔗 Generar el link de Rubén</button>`;

    $$('#modalBody [data-trd]').forEach(el => el.addEventListener('click', () => detalle(el.dataset.trd)));
    $$('#modalBody [data-ev]').forEach(el => el.addEventListener('click', () => {
      const e = doc(el.dataset.ev);
      if (e) { e.visto = true; guardar(e); }
      if (e && doc(e.trdId)) detalle(e.trdId); else pintarTablero();
    }));
    $('#trdNueva').addEventListener('click', () => nueva());
    $('#trdPagar').addEventListener('click', pagar);
    $('#trdLink').addEventListener('click', modalLink);
  }

  /* ═══ NUEVA ORDEN — plantillas vivas que arman la descripción ═══ */
  function nueva(fPre) {
    if (sinNube()) return;
    const b = {
      factura: fPre ? { id: fPre.id, orden: fPre.orden || '', rotulo: fPre.orden ? '#' + fPre.orden : (fPre.numero || 's/n'), cliente: fPre.clienteNombre || '' } : null,
      tipo: 'confeccion',
      oroK: '14K', oroColor: 'amarillo', aros: [{ mm: '2mm', talla: '', grab: '' }],
      grabados: [{ pieza: '', txt: '', estilo: 'normal' }],
      mPiedra: '', mEngaste: '4 uñas', cPiedras: '', rQue: '', wQue: '',
      desc: '', tocada: false, rush: false, entrega: '',
    };
    const fotos = [];   // blobs pendientes

    function componer() {
      if (b.tocada) return;
      if (b.tipo === 'confeccion') {
        const oro = 'oro ' + b.oroK + ' ' + b.oroColor;
        const base = a => (a.mm === 'solitario' ? 'solitario' : 'aro ' + a.mm) + (a.talla.trim() ? ' talla ' + a.talla.trim() : '');
        const grab = a => (a.grab || '').trim() ? ' — grabar «' + a.grab.trim() + '»' : '';
        b.desc = b.aros.length === 1
          ? 'Confeccionar ' + base(b.aros[0]) + ' — ' + oro + grab(b.aros[0])
          : 'Confeccionar en ' + oro + ':\n' + b.aros.map(a => '— ' + base(a) + grab(a)).join('\n');
      } else if (b.tipo === 'grabado') {
        const gs = b.grabados;
        if (gs.length === 1) {
          const g = gs[0];
          b.desc = (g.txt.trim() || g.pieza.trim())
            ? 'Grabar ' + (g.pieza.trim() ? 'en ' + g.pieza.trim() + ' ' : '') + '«' + (g.txt.trim() || '…') + '» — grabado ' + g.estilo
            : '';
        } else {
          b.desc = 'Grabar:\n' + gs.map((g, i) => '— ' + (g.pieza.trim() || 'pieza ' + (i + 1)) + ': «' + (g.txt.trim() || '…') + '» (' + g.estilo + ')').join('\n');
        }
      } else if (b.tipo === 'montura') {
        b.desc = b.mPiedra.trim() ? 'Montar ' + b.mPiedra.trim() + ' — engaste de ' + b.mEngaste : '';
      } else if (b.tipo === 'cambiar') {
        b.desc = b.cPiedras.trim() ? 'Cambiar piedras: ' + b.cPiedras.trim() : '';
      } else if (b.tipo === 'reparacion') {
        b.desc = b.rQue.trim() ? 'Reparar: ' + b.rQue.trim() : '';
      } else if (b.tipo === 'garantia') {
        b.desc = b.wQue.trim() ? '🛡️ GARANTÍA (defecto de fábrica): ' + b.wQue.trim() : '';
      }
    }
    componer();

    const sec = secSiguiente();
    abrirModal('＋ Nueva orden para Rubén', `
      <label>🧾 Factura del CRM (opcional — al pagar, el valor de Rubén se SUMA a su costo)</label>
      <div id="trdFacZona"></div>
      <p class="muted" style="margin:4px 0 10px">Nº asignado: <b id="trdNum">${b.factura && b.factura.orden ? '#' + esc(String(b.factura.orden)) + '-' + sec : '#' + sec}</b> (secuencial del taller: ${sec})</p>
      <label>🔨 Tipo de trabajo</label>
      <div id="trdTipos" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px">
        ${Object.entries(TIPOS).map(([k, lbl]) => `<button type="button" class="chip-tab ${b.tipo === k ? 'on' : ''}" data-t="${k}">${lbl}</button>`).join('')}
      </div>
      <div id="trdPlantilla"></div>
      <label>✍️ Descripción para Rubén (se arma sola — puedes retocarla)</label>
      <textarea id="trdDesc" style="min-height:70px" placeholder="Describe el trabajo…">${esc(b.desc)}</textarea>
      <label>📷 Fotos de referencia (opcional — Rubén solo mira; ARRASTRA imágenes aquí o toca ＋)</label>
      <div id="trdFotos" style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0;border:1.5px dashed var(--border);border-radius:10px;padding:8px">
        <button type="button" id="trdFotoMas" style="width:64px;height:64px;border-radius:10px;border:1.5px dashed var(--border);background:none;font-size:20px;cursor:pointer">＋</button>
      </div>
      <div class="row" style="align-items:flex-end">
        <div style="flex:0 0 auto"><button type="button" class="btn-ghost" id="trdRush" style="border-color:var(--red);color:${b.rush ? '#fff' : 'var(--red)'};background:${b.rush ? 'var(--red)' : 'transparent'};font-weight:700">🔴 RUSH</button></div>
        <div><label>🎯 Entrega prometida</label><input type="date" id="trdEntrega" value="${esc(b.entrega)}"></div>
      </div>
      <button type="button" class="btn-gold btn-block" id="trdGuardar" style="margin-top:12px">Guardar — le aparece a Rubén al instante</button>
      <button type="button" class="btn-ghost btn-block" id="trdVolver" style="margin-top:8px">‹ Volver al tablero</button>`);

    const pintarFactura = () => {
      $('#trdFacZona').innerHTML = b.factura
        ? `<div class="item" style="padding:8px 12px"><div class="item-info"><div class="item-name" style="font-size:.9rem">🧾 ${esc(b.factura.cliente)} <span class="muted">${esc(b.factura.rotulo)}</span></div></div><button type="button" class="btn-x" id="trdFacX">✕</button></div>`
        : `<button type="button" class="btn-ghost btn-block" id="trdFacBuscar">🔍 Buscar la factura…</button>`;
      $('#trdNum').textContent = b.factura && b.factura.orden ? '#' + b.factura.orden + '-' + sec : '#' + sec;
      const bx = $('#trdFacX');
      if (bx) bx.addEventListener('click', () => { b.factura = null; pintarFactura(); });
      const bb = $('#trdFacBuscar');
      if (bb) bb.addEventListener('click', async () => {
        const todas = (await DB.facturas.list()).filter(f => f.estado !== 'anulada')
          .sort((x, y) => (y.fecha || '').localeCompare(x.fecha || ''));
        $('#trdFacZona').innerHTML = `<input type="search" id="trdFacQ" class="search" placeholder="Buscar por cliente o # de orden…" autocomplete="off"><div id="trdFacHits" class="list" style="margin-top:6px"></div>`;
        const pintar = q => {
          const txt = q.trim().toLowerCase();
          const hits = (txt ? todas.filter(f => (f.clienteNombre || '').toLowerCase().includes(txt) || String(f.orden || '').includes(txt) || (f.numero || '').toLowerCase().includes(txt)) : todas).slice(0, 8);
          $('#trdFacHits').innerHTML = hits.map((f, i) => `
            <div class="item" data-i="${i}" style="padding:8px 12px"><div class="item-info">
              <div class="item-name" style="font-size:.9rem">${esc(f.clienteNombre || '(sin cliente)')} <span class="muted">${f.orden ? '#' + f.orden : esc(f.numero || 's/n')}</span></div>
              <div class="item-sub">${fmtFecha(f.fecha)} · ${UI.fmtMoneda(f.total, f.moneda)}</div>
            </div><span class="item-arrow">›</span></div>`).join('') || '<div class="empty"><span>🔍</span>Sin resultados.</div>';
          $$('#trdFacHits [data-i]').forEach(el => el.addEventListener('click', () => {
            const f = hits[Number(el.dataset.i)];
            b.factura = { id: f.id, orden: f.orden || '', rotulo: f.orden ? '#' + f.orden : (f.numero || 's/n'), cliente: f.clienteNombre || '' };
            pintarFactura();
          }));
        };
        $('#trdFacQ').addEventListener('input', e => pintar(e.target.value));
        pintar('');
        $('#trdFacQ').focus();
      });
    };
    pintarFactura();

    const alCambiar = () => { b.tocada = false; componer(); $('#trdDesc').value = b.desc; };
    const pintarPlantilla = () => {
      const p = $('#trdPlantilla');
      const chip = (cls, i, v, on, lbl) => `<button type="button" class="chip-tab ${cls} ${on ? 'on' : ''}" ${i != null ? `data-i="${i}"` : ''} data-v="${v}">${lbl || v}</button>`;
      if (b.tipo === 'confeccion') {
        p.innerHTML = `
          <label>Oro</label><div id="trdCOro" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 6px">${['10K', '14K', '18K'].map(k => chip('', null, k, b.oroK === k)).join('')}</div>
          <label>Color</label><div id="trdCColor" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 6px">${[['amarillo', '🟡 amarillo'], ['blanco', '⚪ blanco'], ['rosa', '🌹 rosa']].map(([v, l]) => chip('', null, v, b.oroColor === v, l)).join('')}</div>
          <label>Piezas (una por línea — cada una con su talla y su grabado si lleva)</label>
          <div id="trdCAros">${b.aros.map((a, i) => `
            <div style="border:1.5px dashed var(--border);border-radius:10px;padding:8px 10px;margin:6px 0">
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                ${['2mm', '4mm', 'solitario'].map(m => chip('trdCMm', i, m, a.mm === m, m === 'solitario' ? '💍 solitario' : m)).join('')}
                <input type="text" class="trdCTalla" data-i="${i}" placeholder="Talla (ej: 7)" value="${esc(a.talla)}" style="flex:1;min-width:90px">
                ${b.aros.length > 1 ? `<button type="button" class="btn-x trdCQuitar" data-i="${i}">✕</button>` : ''}
              </div>
              <input type="text" class="trdCGrab" data-i="${i}" placeholder="✍️ Grabado de esta pieza (opcional)" value="${esc(a.grab || '')}" style="margin-top:6px">
            </div>`).join('')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px">
            <button type="button" class="btn-ghost btn-sm" id="trdCMas">＋ otra pieza</button>
            <button type="button" class="btn-ghost btn-sm" id="trdCTrio">💍 armar el trio (solitario + 2mm + 4mm)</button>
          </div>`;
        $$('#trdCOro .chip-tab').forEach(x => x.addEventListener('click', () => { b.oroK = x.dataset.v; pintarPlantilla(); alCambiar(); }));
        $$('#trdCColor .chip-tab').forEach(x => x.addEventListener('click', () => { b.oroColor = x.dataset.v; pintarPlantilla(); alCambiar(); }));
        const ca = $('#trdCAros');
        ca.addEventListener('input', e => {
          const i = +e.target.dataset.i;
          if (e.target.classList.contains('trdCTalla')) b.aros[i].talla = e.target.value;
          else if (e.target.classList.contains('trdCGrab')) b.aros[i].grab = e.target.value;
          else return;
          alCambiar();
        });
        ca.addEventListener('click', e => {
          const x = e.target.closest('button');
          if (!x) return;
          const i = +x.dataset.i;
          if (x.classList.contains('trdCMm')) b.aros[i].mm = x.dataset.v;
          else if (x.classList.contains('trdCQuitar')) b.aros.splice(i, 1);
          else return;
          pintarPlantilla();
          alCambiar();
        });
        $('#trdCMas').addEventListener('click', () => {
          b.aros.push({ mm: b.aros.some(a => a.mm === '4mm') ? '2mm' : '4mm', talla: '', grab: '' });
          pintarPlantilla(); alCambiar();
        });
        $('#trdCTrio').addEventListener('click', () => {
          b.aros = [{ mm: 'solitario', talla: '', grab: '' }, { mm: '2mm', talla: '', grab: '' }, { mm: '4mm', talla: '', grab: '' }];
          pintarPlantilla(); alCambiar();
        });
      } else if (b.tipo === 'grabado') {
        p.innerHTML = `<div id="trdGLineas">${b.grabados.map((g, i) => `
          <div style="border:1.5px dashed var(--border);border-radius:10px;padding:8px 10px;margin:6px 0">
            <div style="display:flex;gap:8px;align-items:center">
              <input type="text" class="trdGPieza" data-i="${i}" placeholder="¿en cuál pieza? (opcional — ej: 2mm, el suyo)" value="${esc(g.pieza)}" style="flex:1;font-size:.85rem">
              ${b.grabados.length > 1 ? `<button type="button" class="btn-x trdGQuitar" data-i="${i}">✕</button>` : ''}
            </div>
            <input type="text" class="trdGTxt" data-i="${i}" placeholder="Texto a grabar" value="${esc(g.txt)}" style="margin-top:6px">
            <div style="display:flex;gap:6px;margin-top:6px">
              ${['normal', 'láser'].map(v => `<button type="button" class="chip-tab trdGEstilo ${g.estilo === v ? 'on' : ''}" data-i="${i}" data-v="${v}">${v}</button>`).join('')}
            </div>
          </div>`).join('')}</div>
          <button type="button" class="btn-ghost btn-sm" id="trdGMas" style="margin:6px 0 10px">＋ otro grabado (otra pieza del duo/trio)</button>`;
        const gl = $('#trdGLineas');
        gl.addEventListener('input', e => {
          const i = +e.target.dataset.i;
          if (e.target.classList.contains('trdGPieza')) b.grabados[i].pieza = e.target.value;
          else if (e.target.classList.contains('trdGTxt')) b.grabados[i].txt = e.target.value;
          else return;
          alCambiar();
        });
        gl.addEventListener('click', e => {
          const x = e.target.closest('button');
          if (!x) return;
          const i = +x.dataset.i;
          if (x.classList.contains('trdGEstilo')) b.grabados[i].estilo = x.dataset.v;
          else if (x.classList.contains('trdGQuitar')) b.grabados.splice(i, 1);
          else return;
          pintarPlantilla(); alCambiar();
        });
        $('#trdGMas').addEventListener('click', () => {
          b.grabados.push({ pieza: '', txt: '', estilo: 'normal' });
          pintarPlantilla(); alCambiar();
        });
      } else if (b.tipo === 'montura') {
        p.innerHTML = `<label>Piedra (qué es y tamaño)</label>
          <input type="text" id="trdMPiedra" placeholder="Ej: oval 8×6, va con la pieza" value="${esc(b.mPiedra)}">
          <label>Engaste</label>
          <div id="trdMEngaste" style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px">${['4 uñas', '6 uñas', 'bisel'].map(v => `<button type="button" class="chip-tab ${b.mEngaste === v ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>`;
        $('#trdMPiedra').addEventListener('input', e => { b.mPiedra = e.target.value; alCambiar(); });
        $$('#trdMEngaste .chip-tab').forEach(x => x.addEventListener('click', () => { b.mEngaste = x.dataset.v; pintarPlantilla(); alCambiar(); }));
      } else if (b.tipo === 'cambiar') {
        p.innerHTML = `<label>¿Qué piedras se cambian y por cuáles?</label>
          <input type="text" id="trdCPiedras" placeholder="Ej: las 3 circonias laterales por moissanitas 2mm" value="${esc(b.cPiedras)}" style="margin-bottom:10px">`;
        $('#trdCPiedras').addEventListener('input', e => { b.cPiedras = e.target.value; alCambiar(); });
      } else if (b.tipo === 'reparacion') {
        p.innerHTML = `<label>¿Qué hay que reparar?</label>
          <input type="text" id="trdRQue" placeholder="Ej: soldar el aro partido y pulir" value="${esc(b.rQue)}" style="margin-bottom:10px">`;
        $('#trdRQue').addEventListener('input', e => { b.rQue = e.target.value; alCambiar(); });
      } else if (b.tipo === 'garantia') {
        p.innerHTML = `<label>¿Qué defecto de fábrica hay que arreglar?</label>
          <input type="text" id="trdWQue" placeholder="Ej: se soltó la piedra central, re-engastar" value="${esc(b.wQue)}">
          <p class="muted" style="margin:4px 0 10px">🛡️ Va marcada GARANTÍA — lo que cobre Rubén queda solo en su cuenta, NO toca el costo de la factura.</p>`;
        $('#trdWQue').addEventListener('input', e => { b.wQue = e.target.value; alCambiar(); });
      } else {
        p.innerHTML = `<p class="muted" style="margin:4px 0 10px">Sin campitos — escribe el trabajo directo en la descripción de abajo. ✍️</p>`;
      }
    };
    pintarPlantilla();

    $$('#trdTipos [data-t]').forEach(x => x.addEventListener('click', () => {
      b.tipo = x.dataset.t;
      b.tocada = false;
      if (b.tipo === 'otro') b.desc = '';
      $$('#trdTipos [data-t]').forEach(y => y.classList.toggle('on', y === x));
      componer();
      $('#trdDesc').value = b.desc;
      pintarPlantilla();
    }));
    $('#trdDesc').addEventListener('input', () => { b.desc = $('#trdDesc').value; b.tocada = true; });

    const agregarFotos = async archivos => {
      for (const f of archivos) {
        try {
          const blob = await comprimir(f);
          fotos.push(blob);
          const im = document.createElement('img');
          im.src = URL.createObjectURL(blob);
          im.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid var(--border)';
          $('#trdFotos').insertBefore(im, $('#trdFotoMas'));
        } catch { toast('⚠ ' + f.name); }
      }
    };
    $('#trdFotoMas').addEventListener('click', () => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
      i.onchange = () => agregarFotos([...i.files]);
      i.click();
    });
    zonaArrastre($('#trdFotos'), agregarFotos);

    $('#trdRush').addEventListener('click', () => {
      b.rush = !b.rush;
      $('#trdRush').style.background = b.rush ? 'var(--red)' : 'transparent';
      $('#trdRush').style.color = b.rush ? '#fff' : 'var(--red)';
    });
    $('#trdEntrega').addEventListener('input', e => { b.entrega = e.target.value; });
    $('#trdVolver').addEventListener('click', abrir);

    $('#trdGuardar').addEventListener('click', async () => {
      const desc = $('#trdDesc').value.trim();
      if (!desc) { toast('Escribe la descripción del trabajo'); $('#trdDesc').focus(); return; }
      $('#trdGuardar').disabled = true;
      try {
        const t = {
          id: uid('trd'), tipo: 'trd', creado: new Date().toISOString(),
          sec: secSiguiente(),
          facturaOrden: (b.factura && b.factura.orden) || '',
          facturaCRM: b.factura ? { id: b.factura.id, rotulo: b.factura.rotulo, cliente: b.factura.cliente } : null,
          tipoTrabajo: b.tipo, desc,
          plantilla: { oroK: b.oroK, oroColor: b.oroColor, aros: b.aros, grabados: b.grabados, mPiedra: b.mPiedra, mEngaste: b.mEngaste, cPiedras: b.cPiedras, rQue: b.rQue, wQue: b.wQue },
          rush: !!b.rush, entrega: b.entrega || '',
          fotos: [],
        };
        for (let i = 0; i < fotos.length; i++) {
          const p = `trd/${t.id}/foto-${Date.now()}-${i + 1}.jpg`;
          await subirFoto(p, fotos[i]);
          t.fotos.push({ path: p });
        }
        guardar(t);
        toast(`🔨 ${numTrd(t)} guardado — Rubén ya lo ve en su app`);
        abrirModal('🔨 Taller RD — Rubén', '');
        pintarTablero();
      } catch (e) {
        toast('⚠ ' + e.message);
        $('#trdGuardar').disabled = false;
      }
    });
  }

  /* ═══ FICHA de un trabajo ═══ */
  function detalle(id) {
    const t = doc(id);
    if (!t) { pintarTablero(); return; }
    const [bcl, btx] = BADGE[estadoTrd(t)];
    abrirModal(`${numTrd(t)} — Taller RD`, `
      <div class="item-name" style="margin-bottom:6px">${TIPOS[t.tipoTrabajo] || ''}
        <span class="badge ${bcl}">${btx}</span>${t.rush ? ' <span class="badge b-roja">🔴 RUSH</span>' : ''}</div>
      <div style="white-space:pre-wrap;border:1.5px dashed var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px">${esc(t.desc || '')}</div>
      ${(t.fotos || []).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${t.fotos.map(f => `<img data-tpath="${f.path}" alt="" style="width:74px;height:74px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">`).join('')}</div>` : ''}
      ${t.facturaCRM ? `<p class="muted" style="margin-bottom:8px">🧾 Factura: <b>${esc(t.facturaCRM.cliente || '')}</b> ${esc(t.facturaCRM.rotulo || '')} — ${t.tipoTrabajo === 'garantia'
        ? '🛡️ garantía: NO toca el costo de la factura'
        : t.costoAplicado ? `<span class="verde">💵 ${RD(t.costoAplicado.rd)} sumado al costo · ${fmtFecha(t.costoAplicado.fecha)}</span>` : 'al pagarle, su valor se SUMA al costo'}</p>` : ''}
      <div class="abono-row"><span>Creado</span><b>${fmtFecha(t.creado)}</b></div>
      <div class="abono-row"><span>📥 Rubén lo recibió</span><b>${t.recibido ? fmtFecha(t.recibido) : '—'}</b></div>
      <div class="abono-row"><span>✅ Rubén lo envió</span><b>${t.enviado ? fmtFecha(t.enviado) : '—'}</b></div>
      ${t.valor != null ? `<div class="abono-row"><span><b>Valor de Rubén</b></span><b class="${t.pagado ? 'verde' : 'rojo'}">${RD(t.valor)}</b></div>` : ''}
      ${(t.correcciones || []).map(x => `<div class="abono-row"><span class="muted">✏️ corrigió el ${fmtFecha(x.fecha)}</span><span class="muted">${RD(x.antes)} → ${RD(x.ahora)}</span></div>`).join('')}
      <div class="abono-row"><span>💵 Pagado</span><b>${t.pagado ? fmtFecha(t.pagado.fecha) : '—'}</b></div>
      <div class="abono-row"><span>📦 Me llegó de vuelta</span><b>${t.llegoDeVuelta ? fmtFecha(t.llegoDeVuelta) : '—'}</b></div>
      ${t.enviado && !t.llegoDeVuelta ? '<button type="button" class="btn-gold btn-block" id="trdVuelta" style="margin-top:10px">📦 Me llegó de vuelta</button>' : ''}
      ${t.enviado && !t.pagado ? '<button type="button" class="btn-ghost btn-block" id="trdIrPagar" style="margin-top:8px">💵 Pagar a Rubén…</button>' : ''}
      ${!t.enviado ? '<button type="button" class="btn-ghost btn-block" id="trdEditar" style="margin-top:8px">✏️ Editar (descripción, RUSH, entrega)</button>' : ''}
      ${!t.recibido ? '<button type="button" class="btn-ghost btn-block" id="trdBorrar" style="margin-top:8px;color:var(--red)">🗑 Eliminar</button>' : ''}
      <button type="button" class="btn-ghost btn-block" id="trdVolver" style="margin-top:8px">‹ Volver al tablero</button>`);
    pintarFotos($('#modalBody'));
    const on = (sel, fn) => { const x = $(sel); if (x) x.addEventListener('click', fn); };
    on('#trdVolver', () => { abrirModal('🔨 Taller RD — Rubén', ''); pintarTablero(); });
    on('#trdVuelta', () => { t.llegoDeVuelta = hoyISO(); guardar(t); toast('📦 ✓'); detalle(id); });
    on('#trdIrPagar', pagar);
    on('#trdBorrar', () => {
      if (!confirm(`¿Eliminar ${numTrd(t)}? Rubén aún no lo ha recibido.`)) return;
      borrar(t.id);
      toast('🗑 ✓');
      abrirModal('🔨 Taller RD — Rubén', '');
      pintarTablero();
    });
    on('#trdEditar', () => {
      abrirModal(`✏️ ${numTrd(t)}`, `
        <label>✍️ Descripción para Rubén</label><textarea id="teDesc" style="min-height:90px">${esc(t.desc || '')}</textarea>
        <div class="row" style="align-items:flex-end">
          <div style="flex:0 0 auto"><button type="button" class="btn-ghost" id="teRush" style="border-color:var(--red);color:${t.rush ? '#fff' : 'var(--red)'};background:${t.rush ? 'var(--red)' : 'transparent'};font-weight:700">🔴 RUSH</button></div>
          <div><label>🎯 Entrega prometida</label><input type="date" id="teEntrega" value="${esc(t.entrega || '')}"></div>
        </div>
        <button type="button" class="btn-gold btn-block" id="teOk" style="margin-top:12px">Guardar</button>
        <button type="button" class="btn-ghost btn-block" id="teVolver" style="margin-top:8px">‹ Cancelar</button>`);
      let rushOn = !!t.rush;
      $('#teRush').addEventListener('click', () => {
        rushOn = !rushOn;
        $('#teRush').style.background = rushOn ? 'var(--red)' : 'transparent';
        $('#teRush').style.color = rushOn ? '#fff' : 'var(--red)';
      });
      $('#teVolver').addEventListener('click', () => detalle(id));
      $('#teOk').addEventListener('click', () => {
        t.desc = $('#teDesc').value.trim() || t.desc;
        t.rush = rushOn;
        t.entrega = $('#teEntrega').value || '';
        guardar(t);
        toast('✏️ ✓');
        detalle(id);
      });
    });
  }

  /* ═══ PAGO EN LOTE — checkboxes y suma viva ═══ */
  function pagar() {
    const pend = deuda().sort((a, b) => (a.enviado || '').localeCompare(b.enviado || ''));
    const hist = pagosRD();
    abrirModal('💵 Pagar a Rubén — marca las que vas a pagar', `
      ${pend.map(t => `
        <label style="display:flex;align-items:center;gap:12px;border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer">
          <input type="checkbox" class="trdChk" data-id="${t.id}" data-m="${Number(t.valor) || 0}" checked style="width:20px;height:20px;flex:0 0 auto">
          <span style="flex:1"><b>${numTrd(t)}</b> · ${TIPOS[t.tipoTrabajo] || ''}${t.facturaCRM ? ` — ${esc(t.facturaCRM.cliente || '')}` : ''}<br>
            <span class="muted" style="font-size:.78rem">enviado ${fmtFecha(t.enviado)}${t.tipoTrabajo === 'garantia' ? ' · 🛡️ garantía (no toca la factura)' : t.facturaCRM ? ' · se suma al costo de su factura' : ''}</span></span>
          <b>${RD(t.valor)}</b>
        </label>`).join('') || '<div class="empty"><span>✓</span>Nada pendiente de pago.</div>'}
      ${pend.length ? `<p class="muted" style="margin:4px 0 10px">Al registrar el pago, el «me deben» de Rubén baja al instante en su app.</p>
        <button type="button" class="btn-gold btn-block" id="trdPagarOk">💵 Registrar pago: <span id="trdPagoTotal"></span> (<span id="trdPagoN"></span>)</button>` : ''}
      ${hist.length ? `<h3 class="sub-h">Pagos hechos (${hist.length})</h3>` + hist.slice(0, 10).map(p => `
        <div class="abono-row"><span>${fmtFecha(p.fecha)} · ${(p.trabajos || []).length} trabajo${(p.trabajos || []).length === 1 ? '' : 's'}<br>
          <span class="muted" style="font-size:.78rem">${(p.trabajos || []).map(x => esc(x.num)).join(' · ')}</span></span>
          <b>${RD(p.monto)}</b></div>`).join('') : ''}
      <button type="button" class="btn-ghost btn-block" id="trdVolver" style="margin-top:10px">‹ Volver al tablero</button>`);

    $('#trdVolver').addEventListener('click', () => { abrirModal('🔨 Taller RD — Rubén', ''); pintarTablero(); });
    const chks = $$('#modalBody .trdChk');
    const sumar = () => {
      let tot = 0, n = 0;
      chks.forEach(x => { if (x.checked) { tot += Number(x.dataset.m); n++; } });
      const bt = $('#trdPagarOk');
      if (bt) {
        $('#trdPagoTotal').textContent = RD(tot);
        $('#trdPagoN').textContent = n + (n === 1 ? ' trabajo' : ' trabajos');
        bt.disabled = !n;
      }
    };
    chks.forEach(x => x.addEventListener('change', sumar));
    sumar();
    const bt = $('#trdPagarOk');
    if (bt) bt.addEventListener('click', async () => {
      const marcados = chks.filter(x => x.checked).map(x => doc(x.dataset.id)).filter(Boolean);
      if (!marcados.length) return;
      const monto = marcados.reduce((s, t) => s + (Number(t.valor) || 0), 0);
      if (!confirm(`¿Registrar el pago de ${RD(monto)} a Rubén (${marcados.length} trabajo${marcados.length === 1 ? '' : 's'})?`)) return;
      bt.disabled = true;
      const pago = { id: uid('pagoRD'), tipo: 'pagoRD', fecha: hoyISO(), monto,
        trabajos: marcados.map(t => ({ id: t.id, num: numTrd(t), valor: Number(t.valor) || 0 })) };
      guardar(pago);
      /* el valor se SUMA al costo de la factura (material + taller);
         🛡️ Garantía queda solo en la cuenta con Rubén */
      let factos = 0;
      for (const t of marcados) {
        t.pagado = { fecha: hoyISO(), pagoId: pago.id };
        if (t.facturaCRM && t.tipoTrabajo !== 'garantia' && !t.costoAplicado) {
          const f = await DB.facturas.get(t.facturaCRM.id);
          if (f) {
            f.costo = Math.round(((Number(f.costo) || 0) + (Number(t.valor) || 0)) * 100) / 100;
            f.costoTallerRD = [...(f.costoTallerRD || []), { trabajo: t.id, num: numTrd(t), monto: Number(t.valor) || 0, fecha: hoyISO() }];
            await DB.facturas.upsert(f);
            t.costoAplicado = { rd: Number(t.valor) || 0, fecha: hoyISO() };
            factos++;
          }
        }
        guardar(t);
      }
      toast(`💵 ${RD(monto)} pagado ✓${factos ? ` · ${factos} factura${factos === 1 ? '' : 's'} con el costo sumado` : ''}`);
      abrirModal('🔨 Taller RD — Rubén', '');
      pintarTablero();
    });
  }

  /* ═══ Link de Rubén: apunta a la app /taller-rd/ ═══ */
  function modalLink() {
    abrirModal('🔗 Link de Rubén — su propia app', `
      <p class="muted" style="margin-bottom:10px">El link abre la app "Taller SilverShine" de Rubén (azul, en español, sin nombres de clientes). Escribe el email y la clave del usuario del taller — el link se genera aquí mismo y NUNCA se guarda en la nube.</p>
      <div class="row">
        <div><label>Email</label><input id="tlEmail" value="taller@silvershine.com.do" autocomplete="off"></div>
        <div><label>Password</label><input id="tlPass" autocomplete="off"></div>
      </div>
      <label>Nombre</label><input id="tlNombre" value="Rubén" autocomplete="off">
      <button type="button" class="btn-gold btn-block" id="tlGenerar" style="margin-top:12px">Generar link</button>
      <div id="tlZona" style="display:none">
        <label>Link (mándaselo UNA vez — no vence)</label>
        <textarea id="tlTxt" readonly style="min-height:90px;font-size:.75rem"></textarea>
        <button type="button" class="btn-ghost btn-block" id="tlCopiar" style="margin-top:6px">Copiar</button>
      </div>
      <button type="button" class="btn-ghost btn-block" id="trdVolver" style="margin-top:10px">‹ Volver al tablero</button>`);
    $('#trdVolver').addEventListener('click', () => { abrirModal('🔨 Taller RD — Rubén', ''); pintarTablero(); });
    $('#tlGenerar').addEventListener('click', () => {
      const e = $('#tlEmail').value.trim(), p = $('#tlPass').value.trim(), n = $('#tlNombre').value.trim() || 'Rubén';
      if (!e || !p) { toast('Pon el email y la clave del usuario del taller'); return; }
      const cfg = Sync.cfgPublica();
      const payload = { u: cfg.url, a: cfg.anonKey, e, p, n, r: 'rd' };
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      let base = location.pathname.replace(/index\.html?$/, '').replace(/CRM-SilverShine\/?$/, 'taller-rd/');
      $('#tlTxt').value = `${location.origin}${base}#k=${b64}`;
      $('#tlZona').style.display = 'block';
    });
    $('#tlCopiar').addEventListener('click', () => {
      navigator.clipboard.writeText($('#tlTxt').value);
      toast('Copiado ✓');
    });
  }

  function init() {
    const b = document.getElementById('btnTallerRD');
    if (b) b.addEventListener('click', abrir);
  }

  return { init, abrir, nueva, pagar };
})();
