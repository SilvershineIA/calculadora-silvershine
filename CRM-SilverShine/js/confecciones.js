/* ═══════════════════════════════════════════════════════════
   confecciones.js — Taller de confecciones: cada pieza encargada
   con su cliente, plazo pactado, fecha de entrega y balance.
   La confección vive EN la factura (f.confeccion) para que la
   deuda y el cliente salgan solos y sincronice sin SQL nuevo:
   { inicio, dias, entrega, estado: taller|lista|entregada,
     entregadaEl?, notas? }
   ═══════════════════════════════════════════════════════════ */
const Confecciones = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  const hoyISO = () => UI.fechaISO();
  const rotulo = f => f.orden ? `#${f.orden}` : (f.numero || 's/n');
  const enDias = (base, n) => { const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + n); return UI.fechaISO(d); };
  const diasHasta = fecha => Math.round((new Date(fecha + 'T00:00:00') - new Date(hoyISO() + 'T00:00:00')) / 864e5);

  /* Pipeline interno de la pieza, del taller al cliente */
  const ESTADOS = {
    pendiente: '📋 Por enviar al taller',
    taller:    '🧵 En el taller',
    camino:    '✈️ Despachada — en camino',
    lista:     '📦 En almacén — lista para entregar',
    entregada: '✅ Entregada',
  };
  const BADGE = { pendiente: 'b-roja', taller: 'b-pend', camino: 'b-pend', lista: 'b-pag', entregada: 'b-anu' };

  let filtro = 'proceso';   // proceso · entregadas · todas

  async function activas() {
    return (await DB.facturas.list()).filter(f => f.estado !== 'anulada' && f.confeccion);
  }

  const atrasada = f => f.confeccion.estado !== 'entregada' && diasHasta(f.confeccion.entrega) < 0;

  /* Transición de estado: cada etapa deja su fecha la primera vez */
  function estampar(c, nuevo) {
    if (nuevo === 'taller' && !c.enviadaEl) c.enviadaEl = hoyISO();
    if (nuevo === 'camino' && !c.despachadaEl) { c.enviadaEl = c.enviadaEl || c.inicio; c.despachadaEl = hoyISO(); }
    if ((nuevo === 'lista' || nuevo === 'entregada') && !c.recibidaEl) c.recibidaEl = hoyISO();
    if (nuevo === 'entregada') c.entregadaEl = hoyISO(); else delete c.entregadaEl;
    c.estado = nuevo;
  }

  /* Cuántos días lleva (o estuvo) la pieza en el taller */
  function diasEnTaller(c) {
    if (!c.enviadaEl) return null;
    const fin = c.despachadaEl || (c.estado === 'taller' ? hoyISO() : c.recibidaEl || hoyISO());
    return Math.max(0, Math.round((new Date(fin + 'T00:00:00') - new Date(c.enviadaEl + 'T00:00:00')) / 864e5));
  }

  /* Etiqueta de plazo: cuánto falta (o cuánto se pasó) para la entrega */
  function plazoTxt(c) {
    if (c.estado === 'entregada') return c.entregadaEl ? `entregada el ${fmtFecha(c.entregadaEl)}` : 'entregada';
    const d = diasHasta(c.entrega);
    if (d < 0)  return `⚠ atrasada ${-d} día${d === -1 ? '' : 's'}`;
    if (d === 0) return '📅 entrega HOY';
    if (d === 1) return 'entrega mañana';
    return `entrega en ${d} días`;
  }

  /* ── Iniciar una confección (desde la factura o desde este módulo):
     estampa f.confeccion y crea la tarea de taller con sus pasos ── */
  async function iniciar(f, dias) {
    if (f.confeccion && f.confeccion.estado !== 'entregada' &&
        !confirm(`La factura ${rotulo(f)} ya tiene una confección en proceso (entrega ${fmtFecha(f.confeccion.entrega)}). ¿Reemplazar el plazo?`)) return false;
    const hoy = hoyISO();
    f.confeccion = { inicio: hoy, dias, entrega: enDias(hoy, dias), estado: 'pendiente' };
    await DB.facturas.upsert(f);
    await DB.tareas.upsert({
      titulo: `Confección (${dias} días) — Factura ${rotulo(f)}`,
      fecha: hoy,
      notas: `Creada desde la factura ${rotulo(f)}${f.orden && f.numero ? ' · ' + f.numero : ''} — ${f.clienteNombre}`,
      clienteId: f.clienteId, clienteNombre: f.clienteNombre,
      pasos: [
        { titulo: 'Enviar orden al taller', fecha: hoy,                 hecho: false },
        { titulo: 'Seguimiento',            fecha: enDias(hoy, dias),   hecho: false },
        { titulo: 'Seguimiento final',      fecha: enDias(hoy, dias + 1), hecho: false },
      ],
      hecha: false,
    });
    toast(`🧵 Confección a ${dias} días registrada`);
    Tareas.render();
    return true;
  }

  /* ── Lista ── */
  async function render() {
    const lista = await activas();
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = f => (f.moneda === 'USD' && tasa ? f.saldo * tasa : f.saldo) || 0;

    const proceso = lista.filter(f => f.confeccion.estado !== 'entregada');
    const cuenta = e => proceso.filter(f => f.confeccion.estado === e).length;
    const atrasadas = proceso.filter(atrasada);
    const deudaProceso = proceso.reduce((s, f) => s + (f.saldo > 0 ? conv(f) : 0), 0);
    /* Lo que falta pagarle al taller (US$): costo final menos pago inicial.
       Solo suma piezas con costo final conocido. */
    const porPagarUSD = proceso.reduce((s, f) => {
      const c = f.confeccion;
      return s + (c.costoFinalUSD ? Math.max(c.costoFinalUSD - (c.costoInicialUSD || 0), 0) : 0);
    }, 0);

    $('#confStats').innerHTML =
      UI.statTile(cuenta('pendiente'), 'Por enviar al taller', cuenta('pendiente') ? 'rojo' : '') +
      UI.statTile(cuenta('taller'), 'En el taller') +
      UI.statTile(cuenta('camino') + cuenta('lista'), 'En camino / almacén') +
      UI.statTile(atrasadas.length, 'Atrasadas', atrasadas.length ? 'rojo' : '') +
      UI.statTile(fmtMoneda(porPagarUSD, 'USD'), 'Por pagar al taller', porPagarUSD > 0 ? 'rojo' : '') +
      UI.statTile(UI.fmtDinero(deudaProceso), 'Por cobrar al entregar', deudaProceso > 0 ? 'rojo' : 'verde');

    const FILTROS = [['proceso', '🧵 En proceso'], ['grupos', '🗂 Por grupo'], ['entregadas', '✅ Entregadas'], ['todas', 'Todas']];
    $('#confFiltros').innerHTML = FILTROS.map(([k, t]) =>
      `<button class="chip-tab ${filtro === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('');
    UI.$$('#confFiltros .chip-tab').forEach(b => b.addEventListener('click', () => { filtro = b.dataset.f; render(); }));

    const cont = $('#listaConfecciones');
    const fila = f => {
      const c = f.confeccion;
      const debe = f.saldo > 0;
      const dt = diasEnTaller(c);
      const extra =
        (c.estado === 'taller' && dt !== null ? ` · 🧵 lleva ${dt} día${dt === 1 ? '' : 's'} en el taller` : '') +
        (c.estado === 'camino' && c.tracking ? ` · 📦 ${esc(c.tracking)}` : '') +
        (c.grupo && filtro !== 'grupos' ? ` · 🗂 ${esc(c.grupo)}` : '') +
        (c.notas ? ' · ⚠ hay temas anotados' : '');
      return `
      <div class="item" data-id="${f.id}">
        <div class="item-info">
          <div class="item-name">${esc(f.clienteNombre)} <span class="muted">${esc(rotulo(f))}</span>
            <span class="badge ${BADGE[c.estado]}">${ESTADOS[c.estado]}</span></div>
          <div class="item-sub">pactada a ${c.dias} días · <b class="${atrasada(f) ? 'rojo' : ''}">${plazoTxt(c)}</b>${extra}</div>
        </div>
        <b class="${debe ? 'rojo' : 'verde'}">${debe ? fmtMoneda(f.saldo, f.moneda) : '✓ pagada'}</b>
      </div>`;
    };
    const seccion = (titulo, arr) => !arr.length ? '' :
      `<h3 class="sub-h">${titulo} (${arr.length})</h3>${arr.map(fila).join('')}`;

    let html = '';
    if (filtro === 'grupos') {
      /* Como trabaja el taller: varias piezas (aunque sean de fechas
         distintas) van juntas en una misma cotización/lote */
      const porGrupo = new Map();
      for (const f of proceso) {
        const g = f.confeccion.grupo || '';
        if (!porGrupo.has(g)) porGrupo.set(g, []);
        porGrupo.get(g).push(f);
      }
      const nombres = [...porGrupo.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
      if (porGrupo.has('')) nombres.push('');
      html = nombres.map(g => {
        const arr = porGrupo.get(g).sort((a, b) => a.confeccion.entrega.localeCompare(b.confeccion.entrega));
        const conCosto = arr.filter(x => x.confeccion.costoFinalUSD);
        const totalUSD = conCosto.reduce((s, x) => s + x.confeccion.costoFinalUSD, 0);
        const iniUSD = arr.reduce((s, x) => s + (x.confeccion.costoInicialUSD || 0), 0);
        const sinCosto = arr.length - conCosto.length;
        const resumen = [
          totalUSD ? `costo ${fmtMoneda(totalUSD, 'USD')}` : '',
          iniUSD ? `inicial ${fmtMoneda(iniUSD, 'USD')} dado` : '',
          sinCosto && arr.length > sinCosto ? `${sinCosto} sin costo aún` : '',
        ].filter(Boolean).join(' · ');
        return `
        <h3 class="sub-h" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${g ? `🗂 ${esc(g)}` : 'Sueltas — sin grupo'} (${arr.length})${resumen ? ` · ${resumen}` : ''}</span>
          ${g ? `<button class="btn-ghost btn-sm" type="button" data-grupo="${esc(g)}">⚙ Mover el grupo</button>` : ''}
        </h3>
        ${arr.map(fila).join('')}`;
      }).join('');
      if (!proceso.length) html = '';
    } else if (filtro === 'entregadas') {
      const ent = lista.filter(f => f.confeccion.estado === 'entregada')
        .sort((a, b) => ((b.confeccion.entregadaEl || b.confeccion.entrega)).localeCompare(a.confeccion.entregadaEl || a.confeccion.entrega));
      html = seccion('✅ Entregadas', ent.slice(0, 30)) +
        (ent.length > 30 ? `<p class="muted" style="text-align:center;padding:10px">Mostrando 30 de ${ent.length}.</p>` : '');
    } else {
      const base = filtro === 'todas' ? lista : proceso;
      const porEntrega = arr => arr.sort((a, b) => a.confeccion.entrega.localeCompare(b.confeccion.entrega));
      const enEstado = e => porEntrega(base.filter(f => f.confeccion.estado === e && !atrasada(f)));
      html =
        seccion('🔴 Atrasadas — mover ya', porEntrega(base.filter(atrasada))) +
        seccion('📋 Por enviar al taller', enEstado('pendiente')) +
        seccion('✈️ En camino', enEstado('camino')) +
        seccion('📦 En almacén — listas para entregar', enEstado('lista')) +
        seccion('🧵 En el taller', enEstado('taller')) +
        (filtro === 'todas' ? seccion('✅ Entregadas', base.filter(f => f.confeccion.estado === 'entregada')
          .sort((a, b) => (b.confeccion.entregadaEl || b.confeccion.entrega).localeCompare(a.confeccion.entregadaEl || a.confeccion.entrega)).slice(0, 30)) : '');
    }
    cont.innerHTML = html ||
      '<div class="empty"><span>🧵</span>Sin confecciones aquí. Se crean con el botón 🧵 de la factura o con “+ Nueva confección”.</div>';
    UI.$$('#listaConfecciones .item[data-id]').forEach(el =>
      el.addEventListener('click', () => detalle(el.dataset.id)));
    UI.$$('#listaConfecciones [data-grupo]').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); accionesGrupo(b.dataset.grupo); }));
  }

  /* ── Acciones sobre un lote completo: cuando el taller despacha,
     despacha el grupo entero con una sola guía ── */
  async function accionesGrupo(nombre) {
    const piezas = (await activas())
      .filter(f => f.confeccion.grupo === nombre && f.confeccion.estado !== 'entregada');
    if (!piezas.length) return;
    abrirModal(`🗂 ${nombre}`, `
      <p class="muted" style="margin-bottom:12px">${piezas.map(f =>
        `${esc(f.clienteNombre)} ${esc(rotulo(f))} — ${ESTADOS[f.confeccion.estado]}`).join('<br>')}</p>
      <div class="row">
        <div><label>Mover TODO el grupo a</label>
          <select id="grpEstado">
            <option value="">— sin cambio —</option>
            ${['taller', 'camino', 'lista'].map(k => `<option value="${k}">${ESTADOS[k]}</option>`).join('')}
          </select></div>
        <div><label>📦 Tracking del envío (para todas)</label>
          <input id="grpTracking" placeholder="Una guía para el lote"></div>
      </div>
      <button class="btn-gold btn-block" id="grpAplicar">Aplicar a las ${piezas.length} piezas</button>
    `);
    $('#grpAplicar').addEventListener('click', async () => {
      const nuevo = $('#grpEstado').value;
      const trk = $('#grpTracking').value.trim();
      if (!nuevo && !trk) { cerrarModal(); return; }
      for (const f of piezas) {
        if (nuevo) estampar(f.confeccion, nuevo);
        if (trk) f.confeccion.tracking = trk;
        await DB.facturas.upsert(f);
      }
      toast(`🗂 ${piezas.length} pieza${piezas.length === 1 ? '' : 's'} del lote actualizadas${nuevo ? ` → ${ESTADOS[nuevo]}` : ''}`);
      cerrarModal();
      render();
    });
  }

  /* ── Mensaje de WhatsApp según el momento de la confección ── */
  function mensaje(f, emp) {
    const t = f.moneda || 'DOP';
    const c = f.confeccion;
    const saludo = `Hola ${f.clienteNombre}, le saluda *${UI.quienSaluda(emp)}* ✨\n\n`;
    const refLinea = `\n\n🧾 Factura ${rotulo(f)}`;
    const cuentas = emp.cuentas && f.saldo > 0 ? `\n\n*Cuentas para su pago:*\n\n${emp.cuentas}` : '';
    const pie = `\n\n💎 ${emp.nombre} · ${emp.web}`;
    let cuerpo;
    if (c.estado === 'lista') {
      cuerpo = f.saldo > 0
        ? `🎉 ¡Buenas noticias! Su pieza ya está *lista*. Para coordinar la entrega queda un balance de *${fmtMoneda(f.saldo, t)}*. ¿Cuándo le viene bien pasar por la tienda?${refLinea}${cuentas}\n\nTambién puede pagar con tarjeta o EasyPay al recogerla.`
        : `🎉 ¡Buenas noticias! Su pieza ya está *lista* y su cuenta está al día. ¿Cuándo le viene bien pasar a recogerla?${refLinea}`;
    } else if (c.estado === 'entregada') {
      cuerpo = `Esperamos que esté disfrutando su pieza 💍 Recuerde que cuenta con nuestra garantía y limpieza anual gratis — aquí estamos para lo que necesite.${refLinea}`;
    } else {
      cuerpo = `Su pieza está en confección 🧵 Fecha estimada de entrega: *${fmtFecha(c.entrega)}*. Le avisamos apenas esté lista.${refLinea}` +
        (f.saldo > 0 ? ` · balance a completar en la entrega: *${fmtMoneda(f.saldo, t)}*` : '');
    }
    return saludo + cuerpo + pie;
  }

  /* ── Detalle ── */
  async function detalle(fid) {
    const f = await DB.facturas.get(fid);
    if (!f || !f.confeccion) return;
    const c = f.confeccion;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const emp = await UI.getEmpresa();
    const t = f.moneda || 'DOP';
    const debe = f.saldo > 0;
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const gruposExistentes = [...new Set((await activas())
      .map(x => x.confeccion.grupo).filter(Boolean))].sort();

    const dt = diasEnTaller(c);
    const viaje = [
      c.enviadaEl ? `enviada al taller el ${fmtFecha(c.enviadaEl)}` : 'aún NO se ha enviado al taller',
      dt !== null ? `${c.estado === 'taller' ? 'lleva' : 'estuvo'} ${dt} día${dt === 1 ? '' : 's'} en el taller` : '',
      c.despachadaEl ? `despachada el ${fmtFecha(c.despachadaEl)}` : '',
      c.recibidaEl ? `recibida en almacén el ${fmtFecha(c.recibidaEl)}` : '',
    ].filter(Boolean).join(' · ');

    abrirModal(`Confección — ${rotulo(f)}`, `
      <div class="item-name" style="margin-bottom:4px">${esc(f.clienteNombre)}
        <span class="badge ${BADGE[c.estado]}">${ESTADOS[c.estado]}</span></div>
      <div class="deuda-banner">${debe
        ? `Al entregar se cobra <b class="rojo">${fmtMoneda(f.saldo, t)}</b> de ${fmtMoneda(f.total, t)} · ${esc(f.numero || 's/n')}`
        : `✓ Pagada completa (${fmtMoneda(f.total, t)}) · ${esc(f.numero || 's/n')}`}</div>
      <p class="muted" style="margin:10px 0 14px">Pactada a <b>${c.dias} días</b> · encargada el ${fmtFecha(c.inicio)} · <b class="${atrasada(f) ? 'rojo' : ''}">${plazoTxt(c)}</b></p>
      <div class="row">
        <div><label>Estado</label>
          <select id="confEstado">
            ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${c.estado === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
        <div><label>Fecha de entrega al cliente</label><input type="date" id="confEntrega" value="${c.entrega}"></div>
      </div>

      <h3 class="sub-h">🏭 Taller / proveedor (se maneja en US$)</h3>
      <p class="muted" style="margin-bottom:10px">${viaje}</p>
      <div class="row">
        <div><label>Pago inicial al taller (US$)</label>
          <input type="number" id="confCostoIni" min="0" step="0.01" value="${c.costoInicialUSD ?? ''}" placeholder="Lo que pidió para comenzar"></div>
        <div><label>Costo final de la pieza (US$)</label>
          <input type="number" id="confCostoFin" min="0" step="0.01" value="${c.costoFinalUSD ?? ''}" placeholder="Se define al despachar"></div>
      </div>
      <p class="muted" id="confSaldoProv" style="margin:-4px 0 10px"></p>
      <div class="row">
        <div><label>🗂 Grupo / lote del taller</label>
          <input id="confGrupo" list="confGruposList" value="${esc(c.grupo || '')}" placeholder="Ej: cotización taller 15-ago" autocomplete="off">
          <datalist id="confGruposList">${gruposExistentes.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div><label>📦 Tracking (número(s) de guía)</label>
          <input id="confTracking" value="${esc(c.tracking || '')}" placeholder="Ej: 1Z999AA10123456784"></div>
      </div>
      <div class="row"><div>
        <label>⚠ Problemas / temas</label>
        <textarea id="confNotas" placeholder="Ej: el proveedor avisa 3 días extra por el engaste…">${esc(c.notas || '')}</textarea>
      </div></div>
      ${UI.tieneWhatsApp(cliente) ? `<button class="btn-gold btn-block" id="confWA">💬 Avisar al cliente por WhatsApp</button>` : ''}
      <button class="btn-ghost btn-block" id="confFactura" style="margin-top:10px">🧾 Ver factura / registrar abono</button>
    `);

    const guardar = async () => { await DB.facturas.upsert(f); render(); };

    /* Lo que falta pagarle al taller (US$), en vivo según los dos campos */
    const usd = v => fmtMoneda(v, 'USD');
    const pintarSaldoProv = () => {
      const ini = Number($('#confCostoIni').value) || 0;
      const fin = Number($('#confCostoFin').value) || 0;
      const enRD = fin && tasa ? ` ≈ ${fmtMoneda(fin * tasa)} (a ${tasa}) — guardado como costo en Finanzas` : '';
      $('#confSaldoProv').innerHTML = fin
        ? `Falta por pagar al taller: <b class="${fin - ini > 0 ? 'rojo' : 'verde'}">${usd(Math.max(fin - ini, 0))}</b>${ini ? ` (inicial ${usd(ini)} ya dado)` : ''}${enRD}`
        : (ini ? `Inicial dado: ${usd(ini)} — el costo final se define al despachar.` : 'El proveedor fija el costo final al despachar.');
    };
    pintarSaldoProv();
    $('#confCostoIni').addEventListener('change', async e => {
      const v = Number(e.target.value);
      if (v > 0) c.costoInicialUSD = v; else delete c.costoInicialUSD;
      await guardar(); pintarSaldoProv();
    });
    /* El costo final en US$ alimenta f.costo (RD$, el de Finanzas) con la
       tasa viva. Solo se borra f.costo si lo puso este flujo (costoDeUSD),
       para no pisar costos en pesos anotados a mano. */
    $('#confCostoFin').addEventListener('change', async e => {
      const v = Number(e.target.value);
      if (v > 0) {
        c.costoFinalUSD = v;
        if (tasa) {
          f.costo = Math.round(v * tasa * 100) / 100;
          c.costoDeUSD = true;
          toast(`🔒 Costo ${usd(v)} ≈ ${fmtMoneda(f.costo)} — Finanzas lo usa para la ganancia`);
        } else toast('⚠ Sin tasa del dólar a mano: abre la Calculadora para actualizarla');
      } else {
        delete c.costoFinalUSD;
        if (c.costoDeUSD) { delete f.costo; delete c.costoDeUSD; }
      }
      await guardar(); pintarSaldoProv();
    });
    $('#confGrupo').addEventListener('change', async e => {
      const g = e.target.value.trim();
      if (g) c.grupo = g; else delete c.grupo;
      await guardar();
    });
    $('#confTracking').addEventListener('change', async e => {
      c.tracking = e.target.value.trim();
      await guardar();
    });
    $('#confEstado').addEventListener('change', async e => {
      const nuevo = e.target.value;
      if (nuevo === 'entregada' && debe &&
          !confirm(`El cliente aún debe ${fmtMoneda(f.saldo, t)}. ¿Marcar entregada de todos modos?`)) {
        e.target.value = c.estado; return;
      }
      estampar(c, nuevo);
      await guardar();
      toast(`${ESTADOS[nuevo]}`);
      detalle(fid);
    });
    $('#confEntrega').addEventListener('change', async e => {
      if (!e.target.value) { e.target.value = c.entrega; return; }
      c.entrega = e.target.value;
      await guardar();
      toast(`📅 Entrega pactada para el ${fmtFecha(c.entrega)}`);
    });
    $('#confNotas').addEventListener('change', async e => {
      c.notas = e.target.value.trim();
      await guardar();
    });
    const wa = $('#confWA');
    if (wa) wa.addEventListener('click', () => UI.abrirWhatsApp(cliente, mensaje(f, emp)));
    $('#confFactura').addEventListener('click', () => Facturas.detalle(f.id));
  }

  /* ── Nueva confección: buscar la factura y pactar el plazo ── */
  async function nueva() {
    const todas = (await DB.facturas.list())
      .filter(f => f.estado !== 'anulada' && !f.confeccion)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    abrirModal('Nueva confección', `
      <p class="muted" style="margin-bottom:10px">¿De qué factura es la pieza? (si no existe, créala primero en Facturas)</p>
      <input type="search" id="confBuscar" class="search" placeholder="Buscar por cliente, # de orden o NCF…">
      <div id="confResultados" class="list" style="margin-top:10px"></div>
    `);

    const pintar = q => {
      const txt = q.trim().toLowerCase();
      const hits = (txt
        ? todas.filter(f => (f.clienteNombre || '').toLowerCase().includes(txt) ||
            String(f.orden || '').includes(txt) || (f.numero || '').toLowerCase().includes(txt))
        : todas).slice(0, 10);
      $('#confResultados').innerHTML = hits.map(f => `
        <div class="item" data-id="${f.id}">
          <div class="item-info">
            <div class="item-name">${esc(f.clienteNombre)} <span class="muted">${esc(rotulo(f))}</span></div>
            <div class="item-sub">${fmtFecha(f.fecha)} · ${fmtMoneda(f.total, f.moneda)}${f.saldo > 0 ? ` · debe ${fmtMoneda(f.saldo, f.moneda)}` : ''}</div>
          </div><span class="item-arrow">›</span>
        </div>`).join('') || '<div class="empty"><span>🔍</span>Sin resultados.</div>';
      UI.$$('#confResultados .item').forEach(el => el.addEventListener('click', () => plazo(el.dataset.id)));
    };
    $('#confBuscar').addEventListener('input', e => pintar(e.target.value));
    pintar('');

    const plazo = async id => pactar(await DB.facturas.get(id));
  }

  /* ── Detección automática: una factura "lleva confección" si alguna
     de sus líneas menciona confección (p. ej. el producto del catálogo
     "Confección personalizada") ── */
  const esDeConfeccion = f =>
    (f.lineas || []).some(l => /confecci/i.test(l.descripcion || ''));

  /* Modal de plazo compartido: lo usan "+ Nueva confección", la factura
     recién creada y la conversión de cotización */
  function pactar(f, alListo) {
    const listo = () => { if (alListo) alListo(); else { cerrarModal(); render(); } };
    abrirModal(`Confección — ${rotulo(f)}`, `
      <p class="muted" style="margin-bottom:14px">Esta pieza es de confección 🧵 ¿Para cuándo está pactada la de ${esc(f.clienteNombre)}?</p>
      <button class="btn-gold btn-block" id="conf5" style="margin-bottom:10px">⚡ Confección a 5 días</button>
      <button class="btn-gold btn-block" id="conf20">🗓 Confección a 20 días</button>
      <div class="row" style="margin-top:12px;align-items:flex-end">
        <div><label>U otro plazo (días)</label><input type="number" id="confOtro" min="1" step="1" placeholder="Ej: 10"></div>
        <div style="flex:0 0 auto"><button class="btn-ghost" id="confOtroOk">Pactar</button></div>
      </div>
      <button class="btn-ghost btn-block" id="confLuego" style="margin-top:12px">Ahora no — la registro luego</button>
    `);
    const arrancar = async dias => { if (await iniciar(f, dias)) listo(); };
    $('#conf5').addEventListener('click', () => arrancar(5));
    $('#conf20').addEventListener('click', () => arrancar(20));
    $('#confOtroOk').addEventListener('click', () => {
      const d = Number($('#confOtro').value);
      if (d >= 1) arrancar(Math.round(d));
    });
    $('#confLuego').addEventListener('click', listo);
  }

  function init() {
    $('#btnNuevaConfeccion').addEventListener('click', nueva);
  }

  return { init, render, detalle, iniciar, nueva, pactar, esDeConfeccion };
})();
