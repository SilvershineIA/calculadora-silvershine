/* ═══════════════════════════════════════════════════════════
   inventario.js — Inventario por FICHAS (rediseño nov 2026,
   prototipo aprobado por José). Cada producto es una ficha:
   código único (Tonglin o SilverShine), metal, costo unitario
   (RD$ o US$ a tasa viva), valor de venta y CANTIDADES POR
   TALLA. Tres pestañas: 📦 Fichas · 🏭 En producción (stock y
   encargos de clientes con tope de 25 días) · 📜 Registro de
   encargos entregados. Se enlaza con Facturación (las líneas
   jalan la ficha y descuentan al guardar) y con los talleres:
   las órdenes nacen aquí pero SE EDITAN Y ENVÍAN en el módulo
   de Tonglin o de Rubén, como siempre — el inventario obedece.
   Las confecciones nacen con código rastreable SS-factura-NNN
   (secuencia global, arranca en 012).
   ═══════════════════════════════════════════════════════════ */
const Inventario = (() => {
  const { $, $$, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;
  const hoyISO = () => UI.fechaISO();
  const RD = v => UI.fmtDinero(v || 0);
  const r2 = v => Math.round(v * 100) / 100;

  const METALES = {
    plata:   { t: 'Plata 925' },
    vermeil: { t: 'Vermeil' },
    oro:     { t: 'Oro sólido' },
    oro10k:  { t: 'Oro 10K' },
    oro14k:  { t: 'Oro 14K' },
    oro18k:  { t: 'Oro 18K' },
    piedras: { t: 'Piedras sueltas' },
    otro:    { t: 'Otros' },
  };
  const TOPE_DIAS = 25;        // tope de entrega de encargos
  const SEC_INICIO = 12;       // la secuencia SS- arranca en 012 (la que José lleva)

  /* servicios facturables: la orden va donde Rubén, factura PRIMERO */
  const SERVICIOS = [
    { tipo: 'garantia',   nombre: '🛡️ Garantía',        precio: 0 },
    { tipo: 'reparacion', nombre: '🧰 Reparación',      precio: 0 },
    { tipo: 'ajuste',     nombre: '📏 Ajuste de talla', precio: 0 },
    { tipo: 'grabado',    nombre: '✍️ Grabado',         precio: 0 },
  ];

  let tab = 'fichas';          // fichas · prod · registro
  let filtroTxt = '', filtroMetal = '';

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cantDe = p => Object.values(p.tallas || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const tasaViva = () => (typeof Calculadora !== 'undefined' && Calculadora.tasaActual()) || Number(localStorage.getItem('sscrm_cuadre_tasa')) || 60;
  const costoRD = p => p.monedaCosto === 'USD' ? r2((Number(p.costo) || 0) * tasaViva()) : (Number(p.costo) || 0);
  const esConfPseudo = p => p.id === 'inv-confeccion';
  const diasDesde = f => Math.floor((new Date(hoyISO() + 'T00:00:00') - new Date(String(f) + 'T00:00:00')) / 864e5);

  async function fichas() {
    return (await DB.inventario.list()).filter(p => p.tallas);   // shape nuevo
  }
  const buscaEn = (p, txt) => !txt || norm(p.nombre + ' ' + (p.cod || '')).includes(norm(txt));

  function anotar(p, texto, delta) {
    p.hist = [{ f: hoyISO(), t: texto, d: delta }, ...(p.hist || [])].slice(0, 40);
  }

  /* ── código de confección SS-(factura)-NNN — secuencia GLOBAL ──
     anti-choque: el máximo se re-lee de los docs al momento de asignar */
  async function siguienteCodigoConf(refFactura) {
    let max = SEC_INICIO - 1;
    const doc = await DB.config.get('conf-sec');
    if (doc && doc.ultimo) max = Math.max(max, Number(doc.ultimo));
    for (const p of await fichas()) {
      for (const a of (p.prod || [])) {
        const m = /-(\d{3,})$/.exec(a.codConf || '');
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    for (const f of await DB.facturas.list()) {
      for (const o of (f.ordenesTaller || [])) {
        const m = /-(\d{3,})$/.exec(o.codConf || '');
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    const sec = max + 1;
    await DB.config.upsert({ id: 'conf-sec', ultimo: sec });
    return `SS-${String(refFactura).replace('#', '')}-${String(sec).padStart(3, '0')}`;
  }

  /* ── anillo del plazo de 25 días (cápsula suave, José lo pidió fino) ── */
  function anillo(frac) {
    const r = 5.5, c = 2 * Math.PI * r;
    const lleno = Math.max(.04, Math.min(1, frac)) * c;
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2.4"/>
      <circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-width="2.4"
        stroke-linecap="round" stroke-dasharray="${lleno.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 8 8)"/>
    </svg>`;
  }
  function pillPlazo(pedido) {
    const usados = diasDesde(pedido);
    const quedan = TOPE_DIAS - usados;
    const [cls, txt] =
      quedan < 0   ? ['tarde', `vencido hace ${-quedan} día${quedan === -1 ? '' : 's'}`] :
      quedan === 0 ? ['tarde', 'vence hoy'] :
      quedan <= 7  ? ['pronto', `${quedan} día${quedan === 1 ? '' : 's'} restantes`] :
                     ['ok', `${quedan} días restantes`];
    return `<span class="plazo ${cls}" title="Tope: ${TOPE_DIAS} días desde la factura — van ${usados}">${anillo(usados / TOPE_DIAS)}${txt}</span>`;
  }

  /* ═══ VISTA ═══ */
  async function render() {
    reconciliarLlegadas().then(() => {});     // fase 2: llegadas de Tonglin al entrar
    $('#invTabs').innerHTML = `
      <button class="chip-tab ${tab === 'fichas' ? 'on' : ''}" data-t="fichas">📦 Fichas</button>
      <button class="chip-tab ${tab === 'prod' ? 'on' : ''}" data-t="prod">🏭 En producción</button>
      <button class="chip-tab ${tab === 'registro' ? 'on' : ''}" data-t="registro">📜 Registro</button>`;
    $$('#invTabs .chip-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
    if (tab === 'prod') return renderProd();
    if (tab === 'registro') return renderRegistro();
    return renderFichas();
  }
  function abrirProduccion() {
    tab = 'prod';
    const btn = document.querySelector('.nav-btn[data-view="inventario"]');
    if (btn) btn.click(); else render();
  }

  async function renderFichas() {
    const lista = (await fichas()).filter(p => !p.oculto);
    const vis = lista.filter(p => (!filtroMetal || p.metal === filtroMetal) && buscaEn(p, filtroTxt));
    const piezas = vis.reduce((s, p) => s + cantDe(p), 0);
    const costoT = vis.reduce((s, p) => s + cantDe(p) * costoRD(p), 0);
    const ventaT = vis.reduce((s, p) => s + cantDe(p) * (Number(p.venta) || 0), 0);
    $('#invResumen').innerHTML =
      UI.statTile(vis.length, 'Productos' + (filtroMetal ? ' · ' + METALES[filtroMetal].t : '')) +
      UI.statTile(piezas, 'Piezas') +
      UI.statTile(RD(costoT), 'Costo total') +
      UI.statTile(RD(ventaT), 'Valor de venta', 'verde');

    $('#invMetales').innerHTML = `<button class="chip-tab mini ${!filtroMetal ? 'on' : ''}" data-m="">Todos</button>` +
      Object.entries(METALES).map(([k, m]) => lista.some(p => p.metal === k)
        ? `<button class="chip-tab mini ${filtroMetal === k ? 'on' : ''}" data-m="${k}">${m.t}</button>` : '').join('');
    $$('#invMetales .chip-tab').forEach(b => b.addEventListener('click', () => { filtroMetal = b.dataset.m; render(); }));

    const cont = $('#invCont');
    if (!lista.length) {
      cont.innerHTML = '<div class="empty"><span>📦</span>Sin fichas todavía — crea la primera con ➕, o espera la carga inicial.</div>';
      return;
    }
    const grupos = Object.keys(METALES).filter(k => !filtroMetal || k === filtroMetal);
    cont.innerHTML = grupos.map(k => {
      const g = vis.filter(p => p.metal === k).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      if (!g.length) return '';
      const gp = g.reduce((s, p) => s + cantDe(p), 0);
      const gv = g.reduce((s, p) => s + cantDe(p) * (Number(p.venta) || 0), 0);
      return `<h3 class="sub-h" style="display:flex;justify-content:space-between"><span>${METALES[k].t}</span>
          <span class="muted" style="font-weight:400;font-size:.78rem">${gp} pzas · ${RD(gv)} en venta</span></h3>` +
        g.map(p => {
          const c = cantDe(p), prodN = (p.prod || []).length, ajN = (p.enAjuste || []).length;
          return `<div class="item inv-f" data-id="${p.id}">
            <div class="inv-cant ${c <= 0 ? 'agotado' : ''}">${c}</div>
            <div class="item-info">
              <div class="item-name">${esc(p.nombre)}</div>
              <div class="item-sub">${p.cod ? esc(p.cod) + ' · ' : ''}venta ${RD(p.venta)} · valor ${RD(c * (Number(p.venta) || 0))}</div>
            </div>
            ${prodN ? `<span class="badge-inv">🏭 ${prodN}</span>` : ''}
            ${ajN ? `<span class="badge-inv">🔨 ${ajN}</span>` : ''}
            <span class="item-arrow">›</span>
          </div>`;
        }).join('');
    }).join('') || '<div class="empty"><span>🔍</span>Nada coincide.</div>';
    $$('#invCont .inv-f').forEach(el => el.addEventListener('click', () => detalle(el.dataset.id)));
  }

  /* ═══ FICHA ═══ */
  async function detalle(id) {
    const p = await DB.inventario.get(id);
    if (!p) return;
    const c = cantDe(p);
    const m = METALES[p.metal] || METALES.otro;
    const prod = p.prod || [], ajustes = p.enAjuste || [];

    abrirModal(esc(p.nombre), `
      <p class="muted" style="margin:-6px 0 10px">${m.t}</p>
      <div class="row">
        <div style="flex:1"><label>Código (Tonglin o SilverShine — uno solo)</label>
          <input id="invCod" value="${esc(p.cod || '')}" placeholder="TGL-… o SS-…" autocomplete="off"></div>
      </div>
      <div class="stat-grid" style="margin:10px 0 4px">
        ${UI.statTile(p.monedaCosto === 'USD' ? 'US$' + (Number(p.costo) || 0) : RD(p.costo), 'Costo unitario' + (p.monedaCosto === 'USD' ? ` · ≈${RD(costoRD(p))}` : ''))}
        ${UI.statTile(RD(p.venta), 'Valor de venta')}
        ${UI.statTile(c, 'Cantidad total', c <= 0 ? 'rojo' : '')}
      </div>
      <div class="stat-grid" style="margin-bottom:12px">
        ${UI.statTile(RD(c * costoRD(p)), 'Costo total')}
        ${UI.statTile(RD(c * (Number(p.venta) || 0)), 'Venta total', 'verde')}
        ${UI.statTile(prod.length + ajustes.length, '🏭 en proceso')}
      </div>

      <h3 class="sub-h">Cantidades por talla <span class="muted" style="font-weight:400">· + / − mueven una pieza</span></h3>
      <div class="inv-tallas">
        ${Object.entries(p.tallas).map(([t, n]) => `
          <div class="inv-talla"><div class="t">${esc(t)}</div><div class="n ${!n ? 'cero' : ''}">${n}</div>
            <div class="pm"><button data-pm="-1" data-t="${esc(t)}">−</button><button data-pm="1" data-t="${esc(t)}">+</button></div></div>`).join('')}
        <div class="inv-talla punteada"><div class="t">＋ talla</div>
          <div class="pm"><button id="invAddTalla" style="width:auto;padding:0 10px">agregar</button></div></div>
      </div>

      ${prod.map((a, i) => `
        <div class="abono-row">
          <span>${a.codConf ? `<b class="inv-cod">${esc(a.codConf)}</b> · ` : ''}🏭 ${a.origen === 'tonglin' ? '🇨🇳 Tonglin' : '🔨 Rubén'} · talla ${esc(a.talla)}${a.det ? ' — ' + esc(a.det) : ''}<br>
            <span class="muted" style="font-size:.76rem">${esc(a.ref || '')}${a.para ? ` · cliente ${esc(a.para)} ` : ' · para stock '}${a.para ? pillPlazo(a.pedido) : ''}</span></span>
          <button class="btn-ghost btn-sm" data-llego="${i}">📦 Llegó</button>
        </div>`).join('')}
      ${ajustes.map((a, i) => `
        <div class="abono-row">
          <span>🔨 En ajuste con Rubén · t.${esc(a.de)} → t.${esc(a.a)}<br>
            <span class="muted" style="font-size:.76rem">salió del stock el ${fmtFecha(a.fecha)}</span></span>
          <button class="btn-ghost btn-sm" data-volvio="${i}">📦 Ya volvió</button>
        </div>`).join('')}

      <div class="row" style="margin-top:12px">
        <button class="btn-gold btn-block" id="invProducir">🏭 Mandar a producir</button>
        <button class="btn-ghost btn-block" id="invAjustar">🔨 Ajustar talla (Rubén)</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn-ghost btn-block" id="invCambio">🔁 Cambio</button>
        <button class="btn-ghost btn-block" id="invDevol">↩ Devolución</button>
        <button class="btn-ghost btn-block" id="invEditar">✏️ Editar</button>
      </div>

      ${(p.hist || []).length ? '<h3 class="sub-h" style="margin-top:14px">Historial</h3>' +
        p.hist.slice(0, 12).map(h => `<div class="abono-row"><span>${fmtFecha(h.f)} · ${esc(h.t)}</span>
          <b class="${h.d > 0 ? 'verde' : h.d < 0 ? 'rojo' : ''}">${h.d > 0 ? '+' + h.d : h.d || ''}</b></div>`).join('') : ''}
      <button class="btn-danger btn-block" id="invBorrar" style="margin-top:12px">🗑 Eliminar ficha</button>
    `);

    const guardar = async () => { await DB.inventario.upsert(p); };
    $('#invCod').addEventListener('change', async e => { p.cod = e.target.value.trim(); await guardar(); toast('Código guardado'); });
    $$('#modalBody [data-pm]').forEach(b => b.addEventListener('click', async () => {
      const t = b.dataset.t, d = Number(b.dataset.pm);
      if ((Number(p.tallas[t]) || 0) + d < 0) { toast('No hay piezas en esa talla'); return; }
      p.tallas[t] = (Number(p.tallas[t]) || 0) + d;
      anotar(p, `${d > 0 ? '⬆ Entrada' : '⬇ Salida'} manual · talla ${t}`, d);
      await guardar(); render(); detalle(id);
    }));
    $('#invAddTalla').addEventListener('click', async () => {
      const t = prompt('¿Qué talla agregar? (ej: 7.5 — o “única”)');
      if (!t || p.tallas[t.trim()] !== undefined) return;
      p.tallas[t.trim()] = 0;
      await guardar(); detalle(id);
    });
    $$('#modalBody [data-llego]').forEach(b => b.addEventListener('click', async () => {
      await marcarLlegada(p, Number(b.dataset.llego));
      render(); detalle(id);
    }));
    $$('#modalBody [data-volvio]').forEach(b => b.addEventListener('click', async () => {
      const a = p.enAjuste.splice(Number(b.dataset.volvio), 1)[0];
      p.tallas[a.a] = (Number(p.tallas[a.a]) || 0) + 1;
      anotar(p, `🔨 Volvió de Rubén · ahora talla ${a.a}`, 1);
      await guardar(); toast(`📦 Volvió — entró a talla ${a.a}`); render(); detalle(id);
    }));
    $('#invProducir').addEventListener('click', () => modalProducir(p));
    $('#invAjustar').addEventListener('click', () => modalAjuste(p));
    $('#invCambio').addEventListener('click', () => modalCambio(p, false));
    $('#invDevol').addEventListener('click', () => modalCambio(p, true));
    $('#invEditar').addEventListener('click', () => formularioFicha(p));
    $('#invBorrar').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la ficha "${p.nombre}"? (no toca facturas ni talleres)`)) return;
      await DB.inventario.remove(p.id);
      cerrarModal(); toast('Ficha eliminada'); render();
    });
  }

  async function marcarLlegada(p, i) {
    const a = (p.prod || []).splice(i, 1)[0];
    if (!a) return;
    if (a.para) {
      const dias = diasDesde(a.pedido);
      await DB.config.upsert({ id: 'enc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        tipo: 'encargo', cliente: a.para, nombre: p.nombre + (a.det ? ' — ' + a.det : ''), talla: a.talla,
        ref: a.ref || '', codConf: a.codConf || '', pedido: a.pedido, entregado: hoyISO(), dias });
      anotar(p, `✅ Encargo entregado a ${a.para}${a.codConf ? ' · ' + a.codConf : ''} · tomó ${dias} d — no pasó por stock`, 0);
      toast(`📦 Llegó en ${dias} días — entregar a ${a.para}`);
    } else {
      p.tallas[a.talla] = (Number(p.tallas[a.talla]) || 0) + 1;
      anotar(p, `⬆ Llegó de ${a.origen === 'tonglin' ? 'Tonglin' : 'Rubén'} · talla ${a.talla}`, 1);
      toast(`📦 Entró al inventario · talla ${a.talla}`);
    }
    await DB.inventario.upsert(p);
  }

  /* ═══ 🏭 EN PRODUCCIÓN ═══ */
  async function renderProd() {
    const lista = await fichas();
    const todos = [];
    for (const p of lista) (p.prod || []).forEach((a, i) => todos.push({ p, a, i }));
    const enc = todos.filter(x => x.a.para), stockT = todos.filter(x => !x.a.para);
    $('#invResumen').innerHTML =
      UI.statTile(todos.length, 'En producción') +
      UI.statTile(enc.length, '🧵 Por encargo') +
      UI.statTile(stockT.filter(x => x.a.origen === 'tonglin').length, '🇨🇳 para stock') +
      UI.statTile(stockT.filter(x => x.a.origen === 'ruben').length, '🔨 para stock');
    $('#invMetales').innerHTML = '';

    const fila = x => `
      <div class="item" style="cursor:default;flex-wrap:wrap">
        <div class="item-info">
          <div class="item-name">${x.a.codConf ? `<span class="inv-cod">${esc(x.a.codConf)}</span> · ` : ''}${esc(x.p.nombre)}${x.a.talla && x.a.talla !== 'única' ? ' · talla ' + esc(x.a.talla) : ''}${x.a.det ? ' — ' + esc(x.a.det) : ''}</div>
          <div class="item-sub">${esc(x.a.ref || (x.a.origen === 'tonglin' ? 'Tonglin' : 'Rubén'))} · ${esc(x.a.estado || 'en proceso')}${x.a.para ? ` · <b>cliente ${esc(x.a.para)}</b> · pedido ${fmtFecha(x.a.pedido)}` : ''}</div>
        </div>
        ${x.a.para ? pillPlazo(x.a.pedido) : ''}
        ${x.p.oculto ? '' : `<button class="btn-ghost btn-sm" data-ver="${x.p.id}">ficha ›</button>`}
        <button class="btn-gold btn-sm" data-llego="${x.p.id}:${x.i}">${x.a.para ? '📦 Llegó → entregar' : '📦 Llegó'}</button>
      </div>`;
    const grupo = (titulo, arr) => !arr.length ? '' :
      `<h3 class="sub-h">${titulo} (${arr.length})</h3>` + arr.map(fila).join('');

    $('#invCont').innerHTML =
      grupo('🧵 Por encargo — clientes · tope 25 días', enc) +
      grupo('🇨🇳 Tonglin — para stock', stockT.filter(x => x.a.origen === 'tonglin')) +
      grupo('🔨 Rubén — para stock', stockT.filter(x => x.a.origen === 'ruben')) +
      (todos.length ? '<p class="muted" style="font-size:.78rem;margin-top:8px">Las órdenes se editan y envían en el módulo del taller como siempre — aquí se les da entrada al llegar. Lo de encargo va directo al cliente y pasa al 📜 Registro.</p>'
        : '<div class="empty"><span>🏭</span>Nada en producción — desde una ficha: 🏭 Mandar a producir, o desde una factura.</div>');
    $$('#invCont [data-ver]').forEach(b => b.addEventListener('click', () => detalle(b.dataset.ver)));
    $$('#invCont [data-llego]').forEach(b => b.addEventListener('click', async () => {
      const [pid, i] = b.dataset.llego.split(':');
      const p = await DB.inventario.get(pid);
      if (!p) return;
      const a = p.prod[Number(i)];
      const esEnc = a && a.para && p.id === 'inv-confeccion';
      await marcarLlegada(p, Number(i));
      render();
      /* confección desde cero que gustó → puede volverse modelo, hereda su código */
      if (esEnc && confirm('🧵 ¿Guardar este diseño como ficha nueva del inventario?\n(Hereda su código y queda lista para producir para stock.)')) {
        formularioFicha({ nombre: a.det || 'Diseño personalizado', cod: a.codConf || '', metal: 'otro', tallas: {} });
      }
    }));
  }

  /* ═══ 📜 REGISTRO DE ENCARGOS ═══ */
  async function renderRegistro() {
    const enc = (await DB.config.list()).filter(x => x.tipo === 'encargo')
      .sort((a, b) => (b.entregado || '').localeCompare(a.entregado || ''));
    const aTiempo = enc.filter(e => e.dias <= TOPE_DIAS).length;
    const prom = enc.length ? Math.round(enc.reduce((s, e) => s + (e.dias || 0), 0) / enc.length) : 0;
    $('#invResumen').innerHTML =
      UI.statTile(enc.length, 'Encargos entregados') +
      UI.statTile(aTiempo, `A tiempo (≤ ${TOPE_DIAS} d)`, 'verde') +
      UI.statTile(enc.length - aTiempo, 'Tarde', enc.length - aTiempo ? 'rojo' : '') +
      UI.statTile(prom + ' d', 'Promedio de entrega');
    $('#invMetales').innerHTML = '';
    const pintar = txt => {
      const vis = enc.filter(e => !txt || norm([e.cliente, e.nombre, e.ref, e.codConf].join(' ')).includes(norm(txt)));
      $('#invCont').innerHTML = `<input type="search" class="search" id="invRegBuscar" placeholder="Buscar cliente, pieza, código o factura…" value="${esc(txt || '')}" style="margin-bottom:10px">` +
        (vis.map(e => `
        <div class="item" style="cursor:default">
          <div class="item-info">
            <div class="item-name">👤 ${esc(e.cliente)}</div>
            <div class="item-sub">${e.codConf ? `<span class="inv-cod">${esc(e.codConf)}</span> · ` : ''}${esc(e.nombre)}${e.talla && e.talla !== 'única' ? ' · t.' + esc(e.talla) : ''} · pedido ${fmtFecha(e.pedido)} → entregado ${fmtFecha(e.entregado)}</div>
          </div>
          <span class="plazo ${e.dias <= TOPE_DIAS ? 'ok' : 'tarde'}">${anillo((e.dias || 0) / TOPE_DIAS)}${e.dias} días · ${e.dias <= TOPE_DIAS ? 'a tiempo' : 'tarde'}</span>
        </div>`).join('') || '<div class="empty"><span>📜</span>Aún sin encargos entregados.</div>');
      const inp = $('#invRegBuscar');
      inp.addEventListener('input', e => pintar(e.target.value.trim()));
      if (txt) { inp.focus(); inp.setSelectionRange(txt.length, txt.length); }
    };
    pintar('');
  }

  /* ═══ MODALES de la ficha ═══ */
  function modalProducir(p) {
    abrirModal('🏭 Mandar a producir para stock', `
      <p class="muted" style="margin-bottom:10px"><b>${esc(p.nombre)}</b> — la orden se registra aquí y se termina de crear y ENVIAR en el módulo del taller, como siempre.</p>
      <div class="row">
        <div><label>¿Quién la hace?</label>
          <select id="prOrigen"><option value="tonglin">🇨🇳 Tonglin</option><option value="ruben">🔨 Rubén — Taller RD</option></select></div>
        <div><label>Talla</label><input id="prTalla" value="${esc(Object.keys(p.tallas)[0] || '7')}" autocomplete="off"></div>
        <div><label>Cantidad</label><input id="prCant" type="number" min="1" value="1"></div>
      </div>
      <button class="btn-gold btn-block" id="prOk" style="margin-top:12px">Registrar y abrir el módulo del taller</button>
      <button class="btn-ghost btn-block" id="prSolo" style="margin-top:8px">Solo registrar (la orden ya existe allá)</button>
    `);
    let creando = false;
    const crear = async abrirTaller => {
      if (creando) return;
      creando = true;
      const origen = $('#prOrigen').value, talla = $('#prTalla').value.trim() || 'única';
      const n = Math.max(1, Math.round(Number($('#prCant').value) || 1));
      p.prod = p.prod || [];
      for (let i = 0; i < n; i++) {
        p.prod.push({ talla, origen, ref: origen === 'tonglin' ? 'confección de stock' : 'orden Taller RD',
          estado: '📝 por crear en el módulo', pedido: hoyISO() });
      }
      anotar(p, `🏭 ${n} pza(s) t.${talla} a producción con ${origen === 'tonglin' ? 'Tonglin' : 'Rubén'}`, 0);
      await DB.inventario.upsert(p);
      cerrarModal(); toast(`🏭 ${n} pieza(s) registradas en producción`);
      render();
      if (abrirTaller) {
        if (origen === 'ruben' && typeof TallerRD !== 'undefined') TallerRD.nueva();
        else if (typeof Confecciones !== 'undefined') Confecciones.nueva();
      }
    };
    $('#prOk').addEventListener('click', () => crear(true));
    $('#prSolo').addEventListener('click', () => crear(false));
  }

  function modalAjuste(p) {
    const con = Object.entries(p.tallas).filter(([, n]) => n > 0);
    if (!con.length) { toast('No hay piezas en stock para ajustar'); return; }
    abrirModal('🔨 Ajustar talla con Rubén', `
      <p class="muted" style="margin-bottom:10px">La pieza sale del stock mientras se ajusta y vuelve a entrar en la talla nueva. La orden se crea en el Taller RD.</p>
      <div class="row">
        <div><label>Sale (talla con stock)</label><select id="ajDe">${con.map(([t]) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div><label>Se ajusta a</label><input id="ajA" placeholder="7.5" autocomplete="off"></div>
      </div>
      <button class="btn-gold btn-block" id="ajOk" style="margin-top:12px">Sacar del stock y abrir el Taller RD</button>
    `);
    $('#ajOk').addEventListener('click', async () => {
      if ($('#ajOk').disabled) return;
      $('#ajOk').disabled = true;
      const de = $('#ajDe').value, a = $('#ajA').value.trim() || '?';
      p.tallas[de] = (Number(p.tallas[de]) || 0) - 1;
      p.enAjuste = [...(p.enAjuste || []), { de, a, fecha: hoyISO() }];
      anotar(p, `🔨 A ajuste con Rubén · t.${de} → t.${a}`, -1);
      await DB.inventario.upsert(p);
      cerrarModal(); toast('🔨 Fuera del stock — crea la orden en el Taller RD');
      render();
      if (typeof TallerRD !== 'undefined') TallerRD.nueva();
    });
  }

  function modalCambio(p, esDevol) {
    const con = Object.entries(p.tallas).filter(([, n]) => n > 0);
    abrirModal(esDevol ? '↩ Devolución' : '🔁 Cambio de pieza', `
      <div class="row">
        <div><label>Entra (lo que trae el cliente)</label>
          <select id="cEntra">${Object.keys(p.tallas).map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        ${esDevol ? '' : `<div><label>Sale (lo que se lleva)</label>
          <select id="cSale">${con.map(([t]) => `<option>${esc(t)}</option>`).join('')}</select></div>`}
        <div><label>Factura (opcional)</label><input id="cFact" placeholder="#1942" autocomplete="off"></div>
      </div>
      <button class="btn-gold btn-block" id="cOk" style="margin-top:12px">${esDevol ? 'Registrar devolución' : 'Registrar cambio'}</button>
    `);
    $('#cOk').addEventListener('click', async () => {
      if ($('#cOk').disabled) return;
      $('#cOk').disabled = true;
      const te = $('#cEntra').value, fr = $('#cFact').value.trim();
      p.tallas[te] = (Number(p.tallas[te]) || 0) + 1;
      anotar(p, `${esDevol ? '↩ Devolución' : '🔁 Cambio: entra'} talla ${te}${fr ? ' · ' + fr : ''}`, 1);
      if (!esDevol) {
        const ts = $('#cSale').value;
        p.tallas[ts] = (Number(p.tallas[ts]) || 0) - 1;
        anotar(p, `🔁 Cambio: sale talla ${ts}${fr ? ' · ' + fr : ''}`, -1);
      }
      await DB.inventario.upsert(p);
      cerrarModal(); toast(esDevol ? '↩ Devolución registrada' : '🔁 Cambio registrado');
      render();
    });
  }

  /* ═══ crear / editar ficha ═══ */
  function formularioFicha(p = {}) {
    const esNueva = !p.id;
    abrirModal(esNueva ? '➕ Nueva ficha de producto' : '✏️ Editar ficha', `
      <form id="formFicha">
        <div class="row"><div><label>Nombre *</label>
          <input name="nombre" required value="${esc(p.nombre || '')}" autocomplete="off" placeholder="Esencia Radiante"></div></div>
        <div class="row">
          <div><label>Metal</label><select name="metal">${Object.entries(METALES).map(([k, m]) =>
            `<option value="${k}" ${p.metal === k ? 'selected' : ''}>${m.t}</option>`).join('')}</select></div>
          <div><label>Código (opcional)</label><input name="cod" value="${esc(p.cod || '')}" placeholder="TGL-… o SS-…" autocomplete="off"></div>
        </div>
        <div class="row">
          <div><label>Costo unitario</label><input name="costo" type="number" min="0" step="0.01" value="${p.costo ?? ''}"></div>
          <div><label>Moneda del costo</label><select name="monedaCosto">
            <option value="DOP" ${p.monedaCosto !== 'USD' ? 'selected' : ''}>RD$</option>
            <option value="USD" ${p.monedaCosto === 'USD' ? 'selected' : ''}>US$ (tasa viva)</option></select></div>
          <div><label>Valor de venta (RD$)</label><input name="venta" type="number" min="0" step="0.01" value="${p.venta ?? ''}"></div>
        </div>
        <p class="muted" style="font-size:.78rem">Una ficha nueva nace <b>en 0</b>: visible, facturable por encargo y lista para producir. Las tallas se agregan en la ficha.</p>
        <button type="submit" class="btn-gold btn-block">Guardar</button>
      </form>
    `);
    $('#formFicha').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const doc = {
        id: p.id, nombre: fd.get('nombre').trim(), metal: fd.get('metal'),
        cod: fd.get('cod').trim(), costo: Number(fd.get('costo')) || 0,
        monedaCosto: fd.get('monedaCosto'), venta: Number(fd.get('venta')) || 0,
        tallas: p.tallas || {}, prod: p.prod || [], enAjuste: p.enAjuste || [], hist: p.hist || [],
      };
      if (esNueva) doc.hist = [{ f: hoyISO(), t: '✨ Ficha creada', d: 0 }];
      const g = await DB.inventario.upsert(doc);
      cerrarModal(); toast(esNueva ? '✨ Ficha creada' : 'Ficha actualizada');
      render(); detalle(g.id);
    });
  }

  /* ═══ INTEGRACIÓN CON FACTURAS ═══
     buscador 📦 en el formulario de factura: fichas + servicios.
     Devuelve líneas con l.inv / l.serv; al GUARDAR, Facturas llama
     alGuardarFactura() — descuenta ventas y deja las órdenes de
     taller PENDIENTES (factura primero, orden después). */
  function buscadorInventario(inp, sug, onLinea) {
    inp.addEventListener('input', async () => {
      const txt = inp.value.trim();
      if (txt.length < 2) { sug.hidden = true; return; }
      const lista = (await fichas()).filter(p => !p.oculto && buscaEn(p, txt)).slice(0, 6);
      const servs = SERVICIOS.filter(s => norm(s.nombre).includes(norm(txt)));
      const esConf = norm('confección personalizada').includes(norm(txt)) || norm(txt).startsWith('conf');
      sug.innerHTML =
        (esConf ? `<div class="sug-item" data-conf="1">🧵 <b>Confección personalizada</b> <span class="muted">· nace con código SS- y va a producción</span></div>` : '') +
        servs.map(s => `<div class="sug-item" data-serv="${s.tipo}">${s.nombre} <span class="muted">· servicio — la orden va donde Rubén</span></div>`).join('') +
        lista.map(p => {
          const c = cantDe(p);
          return `<div class="sug-item" data-inv="${p.id}">${esc(p.nombre)} <span class="muted">· ${(METALES[p.metal] || {}).t || ''}${p.cod ? ' · ' + esc(p.cod) : ''} · ${RD(p.venta)} · ${c > 0 ? 'quedan ' + c : '⚠ sin stock'}</span></div>`;
        }).join('') || '<div class="sug-item muted">Sin coincidencias…</div>';
      sug.hidden = false;
      sug.querySelectorAll('[data-serv]').forEach(d => d.addEventListener('click', () => {
        const s = SERVICIOS.find(x => x.tipo === d.dataset.serv);
        sug.hidden = true; inp.value = '';
        const det = prompt(`${s.nombre} — detalle (ej: ${s.tipo === 'grabado' ? 'grabar «J&K 14.02.26»' : s.tipo === 'ajuste' ? 'de talla 9 a 7' : 'soldar uñeta'})`) || '';
        onLinea({ descripcion: `${s.nombre}${det ? ' — ' + det : ''}`, cantidad: 1, precio: s.precio,
          serv: { tipo: s.tipo, det } });
        if (s.tipo === 'garantia') toast('🛡️ Garantía: RD$0 — el costo del taller no tocará la factura');
      }));
      sug.querySelectorAll('[data-conf]').forEach(d => d.addEventListener('click', () => {
        sug.hidden = true; inp.value = '';
        const det = prompt('Confección — descripción corta (ej: oro 14K, 2 aros 2mm, grabado interno)') || 'Confección personalizada';
        const talla = prompt('Talla (o “única”)') || 'única';
        onLinea({ descripcion: `🧵 Confección personalizada — ${det}${talla !== 'única' ? ' · talla ' + talla : ''}`,
          cantidad: 1, precio: '', inv: { fid: 'inv-confeccion', talla, modo: 'confeccion', det } });
      }));
      sug.querySelectorAll('[data-inv]').forEach(d => d.addEventListener('click', async () => {
        const p = await DB.inventario.get(d.dataset.inv);
        inp.value = '';
        panelTalla(p, sug, linea => { sug.hidden = true; onLinea(linea); });
      }));
    });
    document.addEventListener('click', e => { if (!sug.contains(e.target) && e.target !== inp) sug.hidden = true; });
  }

  /* la TALLA decide el flujo: lista de disponibles + «otra talla →
     confección» + vender+ajuste. Se pinta DENTRO del desplegable del
     formulario — NUNCA en el modal global, porque pisaría el modal del
     formulario de factura y se perdería todo lo escrito (bug reportado
     por José: «la factura no se guarda y hay que rehacer»). */
  function panelTalla(p, sug, cb) {
    const disp = Object.entries(p.tallas).filter(([, n]) => n > 0);
    sug.hidden = false;
    sug.innerHTML = `
      <div class="sug-item" style="cursor:default;background:#FAF7F2"><b>${esc(p.nombre)}</b> <span class="muted">· ${(METALES[p.metal] || {}).t || ''} · venta ${RD(p.venta)}${disp.length ? ' — elige la talla:' : ' · ⚠ sin stock físico'}</span></div>
      ${disp.map(([t, n]) => `<div class="sug-item" data-st="${esc(t)}">Talla ${esc(t)} <span class="muted">· quedan ${n}</span></div>`).join('')}
      <div class="sug-item" data-sotra="1">➕ Otra talla — <b>crear confección</b> <span class="muted">· la orden va al taller</span></div>
      <div id="selZona"></div>`;
    const zona = sug.querySelector('#selZona');
    sug.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.st;
      zona.innerHTML = `
        <div class="sug-item" data-vender="1">🧾 <b>Vender la talla ${esc(t)}</b> <span class="muted">· descuenta al guardar</span></div>
        <div class="sug-item" data-ajini="1">🧾 Vender + 📏 <b>ajuste de talla</b> <span class="muted">· la orden va a Rubén</span></div>`;
      zona.querySelector('[data-vender]').addEventListener('click', () => {
        cb({ descripcion: `${p.nombre}${t !== 'única' ? ' · talla ' + t : ''}`, cantidad: 1, precio: p.venta || '',
          inv: { fid: p.id, talla: t, modo: 'venta' } });
      });
      zona.querySelector('[data-ajini]').addEventListener('click', () => {
        const a = prompt(`La talla ${t} se ajusta… ¿a qué talla?`, '');
        if (a === null) return;
        cb({ descripcion: `${p.nombre} · talla ${t}`, cantidad: 1, precio: p.venta || '',
          inv: { fid: p.id, talla: t, modo: 'venta' } });
        cb({ descripcion: `📏 Ajuste de talla — t.${t} → t.${a.trim() || '?'}`, cantidad: 1, precio: 0,
          serv: { tipo: 'ajuste', det: `t.${t} → t.${a.trim() || '?'}` } });
        toast('2 líneas: la pieza sale del stock al guardar y el ajuste va a Rubén');
      });
    }));
    sug.querySelector('[data-sotra]').addEventListener('click', () => {
      const t = prompt('Talla nueva para la confección (ej: 10)', '');
      if (t === null) return;
      cb({ descripcion: `${p.nombre} · talla ${t.trim() || '?'} (confección)`, cantidad: 1, precio: p.venta || '',
        inv: { fid: p.id, talla: t.trim() || '?', modo: 'confeccion' } });
    });
  }

  /* ── al GUARDAR la factura (fase 2: cuadre por DIFERENCIAS) ──
     f.invAplicado registra lo que la factura tiene descontado del
     stock; en cada guardado se compara lo nuevo contra eso y se
     aplica solo el delta — así las EDICIONES re-cuadran (cambiar
     talla, quitar línea, cambiar cantidad) y la anulación puede
     devolver todo con rastro. Devuelve true si quedaron órdenes
     de taller por mandar. */
  const claveMov = m => m.fid + '|' + m.talla;
  async function aplicarDiff(objetivo, previo, rotulo, motivoMas, motivoMenos) {
    const mapa = new Map();
    for (const m of previo) mapa.set(claveMov(m), (mapa.get(claveMov(m)) || 0) + m.n);
    for (const m of objetivo) mapa.set(claveMov(m), (mapa.get(claveMov(m)) || 0) - m.n);
    for (const [k, delta] of mapa) {
      if (!delta) continue;                       // sin cambio
      const [fid, talla] = k.split('|');
      const p = await DB.inventario.get(fid);
      if (!p || !p.tallas) continue;
      p.tallas[talla] = Math.max(0, (Number(p.tallas[talla]) || 0) + delta);
      anotar(p, `${delta > 0 ? motivoMas : motivoMenos} ${rotulo} · talla ${talla}`, delta);
      await DB.inventario.upsert(p);
    }
  }
  async function alGuardarFactura(f, esNueva) {
    const rotulo = f.orden ? '#' + f.orden : (f.numero || 's/n');
    /* 1) ventas: objetivo según las líneas de ahora */
    const objetivo = [];
    for (const l of (f.lineas || [])) {
      if (l.inv && l.inv.modo === 'venta') {
        objetivo.push({ fid: l.inv.fid, talla: l.inv.talla, n: Math.max(1, Math.round(Number(l.cantidad) || 1)) });
      }
    }
    const previo = f.invAplicado || [];
    let cambia = JSON.stringify(objetivo) !== JSON.stringify(previo);
    if (cambia) {
      await aplicarDiff(objetivo, previo, rotulo, '↩ Devuelta por edición de', '⬇ Venta');
      f.invAplicado = objetivo;
    }
    /* 2) órdenes de taller: agregar SOLO las líneas nuevas (match por
       tipo+det+talla contra las ya registradas) */
    const firma = o => [o.tipo, o.det || '', o.talla || ''].join('|');
    const yaTiene = new Set((f.ordenesTaller || []).map(firma));
    const pendientes = [];
    for (const l of (f.lineas || [])) {
      let o = null;
      if (l.inv && l.inv.modo === 'confeccion') o = { fid: l.inv.fid, talla: l.inv.talla, det: l.inv.det || l.descripcion, tipo: 'confeccion' };
      else if (l.serv) o = { tipo: l.serv.tipo, det: l.serv.det || '', soloRuben: true };
      if (o && !yaTiene.has(firma(o))) {
        if (o.tipo === 'confeccion' && o.fid === 'inv-confeccion') o.codConf = await siguienteCodigoConf(rotulo);
        pendientes.push({ ...o, creada: hoyISO() });
        yaTiene.add(firma(o));
      }
    }
    if (pendientes.length) {
      f.ordenesTaller = [...(f.ordenesTaller || []), ...pendientes];
      cambia = true;
    }
    if (cambia) await DB.facturas.upsert(f);
    return pendientes.length > 0 || (f.ordenesTaller || []).some(o => !o.mandada);
  }

  /* anular ↔ desanular: devolver / re-descontar lo aplicado, con rastro */
  async function revertirAnulacion(f) {
    if (f.invRevertido || !(f.invAplicado || []).length) return;
    const rotulo = f.orden ? '#' + f.orden : (f.numero || 's/n');
    await aplicarDiff([], f.invAplicado, rotulo, '↩ Devuelta por anulación de', '⬇');
    f.invRevertido = true;
  }
  async function aplicarDesanulacion(f) {
    if (!f.invRevertido || !(f.invAplicado || []).length) return;
    const rotulo = f.orden ? '#' + f.orden : (f.numero || 's/n');
    await aplicarDiff(f.invAplicado, [], rotulo, '↩', '⬇ Re-descontada al desanular');
    delete f.invRevertido;
  }

  /* ── FASE 2: llegadas automáticas desde los talleres ──
     Los módulos mandan, el inventario obedece: cuando ALLÁ se marca
     la llegada/entrega, aquí se le da entrada (o se entrega el
     encargo) sin segundo toque. Si el match es ambiguo, no se toca
     nada — queda el botón 📦 Llegó manual de siempre. */
  async function llegadaRuben(t) {
    try {
      const refFact = t.facturaCRM ? ('#' + (t.facturaCRM.orden || '')) : null;
      const lista = await fichas();
      const candidatos = [];
      for (const p of lista) {
        (p.prod || []).forEach((a, i) => {
          if (a.origen !== 'ruben') return;
          if (refFact && a.para && a.para.includes(refFact)) candidatos.push({ p, i, peso: 2 });
          else if (!refFact && !a.para) candidatos.push({ p, i, peso: 1 });
        });
      }
      const fuertes = candidatos.filter(c => c.peso === 2);
      const elegido = fuertes[0] || (candidatos.length === 1 ? candidatos[0] : null);
      if (!elegido) return;
      await marcarLlegada(elegido.p, elegido.i);
    } catch (e) { console.warn('llegadaRuben:', e.message); }
  }

  async function reconciliarLlegadas() {
    try {
      const lista = await fichas();
      const facturas = await DB.facturas.list();
      const cstocks = (await DB.config.list()).filter(x => x.tipo === 'conf-stock');
      for (const p of lista) {
        for (let i = (p.prod || []).length - 1; i >= 0; i--) {
          const a = p.prod[i];
          if (a.origen !== 'tonglin') continue;
          if (a.para) {
            /* encargo de cliente: la confección de SU factura llegó/se entregó */
            const m = /^#(\S+)/.exec(a.para || '');
            const f = m && facturas.find(x => String(x.orden) === m[1] || x.numero === m[1]);
            if (f && f.confeccion && ['lista', 'entregada'].includes(f.confeccion.estado)) {
              await marcarLlegada(p, i);
            }
          } else {
            /* stock: una confección de stock entregada (en vitrina) cuyo
               texto nombra esta ficha — o la única pendiente que haya */
            const libres = cstocks.filter(d => !d.invConsumido && d.confeccion && d.confeccion.estado === 'entregada' && ['stock', 'etsy'].includes(d.destino || 'stock'));
            let doc = libres.find(d => norm(d.descripcion || '').includes(norm(p.nombre)));
            if (!doc && libres.length === 1 && lista.reduce((s, x) => s + (x.prod || []).filter(y => y.origen === 'tonglin' && !y.para).length, 0) === 1) doc = libres[0];
            if (doc) {
              doc.invConsumido = true;
              await DB.config.upsert(doc);
              await marcarLlegada(p, i);
            }
          }
        }
      }
    } catch (e) { console.warn('reconciliarLlegadas:', e.message); }
  }

  /* modal «mandar las órdenes» — después de guardar la factura */
  async function modalOrdenes(facturaId) {
    const f = await DB.facturas.get(facturaId);
    if (!f) return;
    const pend = (f.ordenesTaller || []).filter(o => !o.mandada);
    if (!pend.length) { toast('✓ Sin órdenes pendientes en esta factura'); return; }
    const rotulo = f.orden ? '#' + f.orden : (f.numero || 's/n');
    abrirModal(`🧵 Órdenes de taller — factura ${esc(rotulo)}`, `
      <p class="muted" style="margin-bottom:12px">La factura ya está guardada. Cada orden nace aquí y <b>se termina de editar y enviar en el módulo del taller</b>, como siempre.</p>
      ${pend.map((o, i) => `
        <div class="abono-row" style="flex-wrap:wrap">
          <span>${o.codConf ? `<b class="inv-cod">${esc(o.codConf)}</b> · ` : ''}${o.tipo === 'confeccion' ? '🧵 Confección' : (SERVICIOS.find(s => s.tipo === o.tipo) || {}).nombre || o.tipo}${o.talla && o.talla !== 'única' ? ' · t.' + esc(o.talla) : ''}${o.det ? ' — ' + esc(o.det) : ''}</span>
          <span style="display:flex;gap:6px">
            ${o.soloRuben ? '' : `<button class="btn-gold btn-sm" data-ton="${i}">🇨🇳 Tonglin</button>`}
            <button class="btn-gold btn-sm" data-rub="${i}">🔨 Rubén</button>
          </span>
        </div>`).join('')}
      <button class="btn-ghost btn-block" id="ordLuego" style="margin-top:12px">Luego — Mi Día me lo recuerda</button>
    `);
    let mandando = false;                       // candado: un doble toque creaba la orden DOS veces
    const mandar = async (o, origen) => {
      if (mandando || o.mandada) return;
      mandando = true;
      o.mandada = { origen, fecha: hoyISO() };
      await DB.facturas.upsert(f);
      /* rastro en la ficha (o en la pseudo-ficha de confecciones) */
      const p = await DB.inventario.get(o.fid || 'inv-confeccion');
      if (p) {
        p.prod = [...(p.prod || []), { talla: o.talla || 'única', origen,
          ref: origen === 'tonglin' ? 'confección ' + rotulo : 'orden Taller RD',
          estado: '📝 por completar en el módulo', para: rotulo + ' — ' + (f.clienteNombre || 'cliente'),
          pedido: f.fecha || hoyISO(), det: o.det || '', codConf: o.codConf || '' }];
        await DB.inventario.upsert(p);
      }
      const faltan = (f.ordenesTaller || []).filter(x => !x.mandada).length;
      cerrarModal();
      toast((o.codConf ? `🧵 ${o.codConf} → ` : '🔨 Orden → ') + (origen === 'tonglin' ? 'Tonglin' : 'Rubén') +
        (faltan ? ` · quedan ${faltan} — Mi Día te las recuerda` : ''));
      /* el módulo del taller toma el mando (NO se re-abre este modal
         encima: pisaba el formulario del taller — bug de José) */
      if (origen === 'ruben' && typeof TallerRD !== 'undefined') TallerRD.nueva(f);
      else if (typeof Confecciones !== 'undefined') Confecciones.pactar(f);
    };
    $$('#modalBody [data-ton]').forEach(b => b.addEventListener('click', () => mandar(pend[Number(b.dataset.ton)], 'tonglin')));
    $$('#modalBody [data-rub]').forEach(b => b.addEventListener('click', () => mandar(pend[Number(b.dataset.rub)], 'ruben')));
    $('#ordLuego').addEventListener('click', () => { cerrarModal(); toast('📋 Pendiente — te lo recuerda Mi Día'); });
  }

  /* avisos para Mi Día: órdenes sin mandar + encargos por vencer */
  async function avisosMiDia() {
    const out = [];
    for (const f of await DB.facturas.list()) {
      const n = (f.ordenesTaller || []).filter(o => !o.mandada).length;
      if (n && f.estado !== 'anulada') out.push({ tipo: 'ordenes', id: f.id, n,
        ref: f.orden ? '#' + f.orden : (f.numero || ''), cliente: f.clienteNombre || '' });
    }
    for (const p of await fichas()) {
      for (const a of (p.prod || [])) {
        if (!a.para) continue;
        const quedan = TOPE_DIAS - diasDesde(a.pedido);
        if (quedan <= 3) out.push({ tipo: 'vence', id: p.id, quedan, nombre: p.nombre, para: a.para, codConf: a.codConf || '' });
      }
    }
    return out;
  }

  function init() {
    const b = $('#btnNuevoInv');
    if (b) b.addEventListener('click', () => formularioFicha());
    const s = $('#buscarInv');
    if (s) s.addEventListener('input', e => { filtroTxt = e.target.value.trim(); renderFichas(); });
  }

  return { init, render, detalle, formularioFicha, buscadorInventario, alGuardarFactura,
           revertirAnulacion, aplicarDesanulacion, llegadaRuben, reconciliarLlegadas,
           modalOrdenes, avisosMiDia, abrirProduccion, fichas, METALES, SERVICIOS };
})();
