/* ═══════════════════════════════════════════════════════════
   finanzas.js — Módulo de finanzas: ventas, costos y ganancia
   por período (mes, trimestre, semestre, año o rango libre),
   con medidor de cobros y gráficos de ventas y top clientes.
   ═══════════════════════════════════════════════════════════ */
const Finanzas = (() => {
  const { $, fmtMoneda, fmtDinero, statTile, fmtFecha, esc } = UI;

  let periodo = 'mes', desde = '', hasta = '';
  let chartData = [];          // datos por columna, para el tooltip

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

  function rangoDe(p) {
    const hoy = new Date();
    const y = hoy.getFullYear(), m = hoy.getMonth();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fin = (yy, mm) => new Date(yy, mm + 1, 0);       // último día del mes mm
    switch (p) {
      case 'mes':        return { d: iso(new Date(y, m, 1)), h: iso(fin(y, m)) };
      case 'mesPasado':  return { d: iso(new Date(y, m - 1, 1)), h: iso(fin(y, m - 1)) };
      case 'trimestre':  { const q = Math.floor(m / 3) * 3; return { d: iso(new Date(y, q, 1)), h: iso(fin(y, q + 2)) }; }
      case 'semestre':   { const s = m < 6 ? 0 : 6; return { d: iso(new Date(y, s, 1)), h: iso(fin(y, s + 5)) }; }
      case 'ano':        return { d: `${y}-01-01`, h: `${y}-12-31` };
      case 'anoPasado':  return { d: `${y - 1}-01-01`, h: `${y - 1}-12-31` };
      case 'custom':     return { d: desde, h: hasta };
      default:           return { d: '', h: '' };          // todo el histórico
    }
  }

  /* Números compactos para ejes y etiquetas: 86k, 1.1M */
  const compacto = v =>
    v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 >= 5e4 ? 1 : 0) + 'M' :
    v >= 1e3 ? Math.round(v / 1e3) + 'k' :
    String(Math.round(v));

  /* Tope "bonito" del eje Y: 1 / 2 / 2.5 / 5 × 10^k por encima del máximo */
  const topeBonito = v => {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };

  /* ═══════ Estimador de costos de plata ═══════════════════════
     Tabla de costos del taller en US$ (solitarios, duos y trios).
     Plata = factura de RD$15,000 o menos sin costo puesto.       */
  const PLATA_MAX_DOP = 15000;
  const COSTOS_PLATA = {
    sol: {
      'trinidad de amor': 24.20, 'herencia de amor': 26.32, 'lazo eterno': 23.58,
      'sendero de luz': 20.38, 'alma unida': 15.71, 'claridad infinita': 19.63,
      'esencia radiante': 29.66, 'llama serena': 23.90, 'luz del corazon': 23.59,
      'princesa': 17.97, 'cumbre de amor': 34.20, 'brillo del destino': 23.76,
      'eco de ternura': 19.63, 'jardin de luz': 13.11,
    },
    duo: {
      'claridad infinita': 19.63, 'eco de ternura': 17.70,
      'llama serena': 20.90, 'brillo del destino': 23.76,
    },
    trio: {
      'trinidad de amor': 47.74, 'herencia de amor': 49.86, 'lazo eterno': 47.12,
      'sendero de luz': 43.94, 'alma unida': 39.25, 'claridad infinita': 34.39,
      'esencia radiante': 53.20, 'llama serena': 38.66, 'luz del corazon': 47.13,
      'princesa': 41.51, 'cumbre de amor': 57.74, 'brillo del destino': 38.52,
      'eco de ternura': 32.46, 'jardin de luz': 36.65,
    },
    banda: { '2mm con piedra': 8.80, '2mm liso': 8.78, '4mm liso': 14.76 },
  };
  const NOMBRES_PLATA = Object.keys(COSTOS_PLATA.sol).sort((a, b) => b.length - a.length);
  const PCT_DEFECTO = 0.38;      // % costo/venta si no hay ninguna línea identificada

  const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* Costo US$ de una línea según su descripción, o null si no se identifica.
     "Trio X" → trio; "Duo X" → duo; el nombre solo → solitario.
     "2mm … y 4mm …" (duo de boda) → banda 2mm + banda 4mm.                  */
  function costoLineaUSD(descripcion) {
    const d = normTxt(descripcion);
    if (!d) return null;
    for (const base of NOMBRES_PLATA) {
      if (!d.includes(base)) continue;
      if (/\btrio\b/.test(d)) return COSTOS_PLATA.trio[base] ?? null;
      if (/\bduo\b/.test(d))  return COSTOS_PLATA.duo[base] ?? COSTOS_PLATA.sol[base] ?? null;
      return COSTOS_PLATA.sol[base] ?? null;
    }
    const b = COSTOS_PLATA.banda;
    const p2 = d.includes('2mm'), p4 = /4m?m/.test(d);   // "4m size 8" aparece así en QuickBooks
    if (p2 && p4) return b['2mm liso'] + b['4mm liso'];
    if (p4) return b['4mm liso'];
    if (p2) return d.includes('piedra') ? b['2mm con piedra'] : b['2mm liso'];
    return null;
  }

  /* Recorre todas las facturas de plata sin costo y propone un costo:
     líneas identificadas al costo real de la tabla, el resto a un % del
     subtotal (el % sale de las propias líneas identificadas). */
  async function estimarCostos() {
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    if (!tasa) { UI.toast('Configura la tasa del dólar en la Calculadora primero'); return; }

    const todas = await DB.facturas.list();
    const cand = [];
    let sumCostoIdDOP = 0, sumSubIdDOP = 0;    // para deducir el % costo/venta

    for (const f of todas) {
      if (f.estado === 'anulada' || f.costo > 0 || !(f.total > 0)) continue;
      const mon = f.moneda || 'DOP';
      const aDOP = mon === 'USD' ? tasa : 1;
      if (f.total * aDOP > PLATA_MAX_DOP) continue;                       // eso no es plata
      const lineas = f.lineas || [];
      if (lineas.some(l => /\boro\b/.test(normTxt(l.descripcion)))) continue;  // oro barato: manual

      let costoUSD = 0, subId = 0, subNoId = 0;
      for (const l of lineas) {
        const cant = Number(l.cantidad) || 1;
        const sub = cant * (Number(l.precio) || 0);
        const c = costoLineaUSD(l.descripcion);
        if (c !== null) { costoUSD += c * cant; subId += sub; }
        else subNoId += sub;
      }
      sumCostoIdDOP += costoUSD * tasa;
      sumSubIdDOP += subId * aDOP;
      cand.push({ f, mon, costoUSD, subId, subNoId });
    }
    if (!cand.length) {
      UI.toast('No hay facturas de plata sin costo — todo está al día 🎉');
      return;
    }

    let pct = sumSubIdDOP > 0 ? sumCostoIdDOP / sumSubIdDOP : PCT_DEFECTO;
    pct = Math.min(0.7, Math.max(0.15, pct));

    /* Costo propuesto en la moneda de cada factura */
    const props = cand.map(c => {
      const enUSD = c.mon === 'USD';
      const costo = (enUSD ? c.costoUSD : c.costoUSD * tasa) + pct * c.subNoId;
      const v = enUSD ? Math.round(costo * 100) / 100 : Math.round(costo);
      const metodo = c.subNoId <= 0 ? 'nombre' : (c.costoUSD > 0 ? 'mixto' : 'pct');
      return { ...c, costo: v, metodo, sospechosa: v >= c.f.total * 0.8 };
    }).sort((a, b) => (b.f.fecha || '').localeCompare(a.f.fecha || ''));

    const nNombre = props.filter(p => p.metodo === 'nombre').length;
    const nMixto  = props.filter(p => p.metodo === 'mixto').length;
    const nPct    = props.filter(p => p.metodo === 'pct').length;
    const EMO = { nombre: '📗', mixto: '📙', pct: '📊' };

    const body = UI.abrirModal('🪄 Estimar costos de plata', `
      <p class="muted" style="margin-bottom:10px">
        Plata = facturas de <b>RD$${PLATA_MAX_DOP.toLocaleString('es-DO')} o menos</b> sin costo puesto.
        Tabla del taller en US$ convertida con la tasa <b>${tasa}</b>.<br>
        📗 ${nNombre} por nombre exacto · 📙 ${nMixto} mixtas · 📊 ${nPct} por porcentaje
        (${Math.round(pct * 100)}% del subtotal${sumSubIdDOP > 0 ? ', deducido de las líneas identificadas' : ' típico'}).
        Las dudosas (costo ≥ 80% de la venta) vienen desmarcadas.
      </p>
      <div class="est-lista">
        ${props.map((p, i) => `
          <label class="est-row ${p.sospechosa ? 'est-dudosa' : ''}">
            <input type="checkbox" data-i="${i}" ${p.sospechosa ? '' : 'checked'}>
            <span class="est-info">${fmtFecha(p.f.fecha)} · ${esc(p.f.clienteNombre || 'Sin nombre')}
              <span class="muted">${esc(p.f.orden ? '#' + p.f.orden : (p.f.numero || 's/n'))}</span></span>
            <span class="est-monto">${fmtDinero(p.f.total, p.mon)} → <b>${fmtDinero(p.costo, p.mon)}</b> ${EMO[p.metodo]}</span>
          </label>`).join('')}
      </div>
      <button class="btn-gold btn-block" id="btnAplicarEst" style="margin-top:14px"></button>
    `);

    const btn = body.querySelector('#btnAplicarEst');
    const cuenta = () => {
      const n = body.querySelectorAll('.est-row input:checked').length;
      btn.textContent = `💾 Aplicar costo a ${n} factura${n === 1 ? '' : 's'}`;
      btn.disabled = !n;
    };
    cuenta();
    body.querySelector('.est-lista').addEventListener('change', cuenta);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      const elegidas = [...body.querySelectorAll('.est-row input:checked')]
        .map(ch => props[Number(ch.dataset.i)]);
      const porId = new Map(elegidas.map(p => [p.f.id, p]));
      /* Un solo guardado del arreglo completo (mucho más rápido que
         cientos de upserts) y cada cambio se notifica a la nube. */
      const nuevas = (await DB.facturas.list()).map(f => {
        const p = porId.get(f.id);
        return p ? { ...f, costo: p.costo, costoEstimado: p.metodo } : f;
      });
      await DB.reemplazar('facturas', nuevas);
      if (typeof Sync !== 'undefined') {
        for (const f of nuevas) if (porId.has(f.id)) Sync.notificar('facturas', 'upsert', f);
        setTimeout(() => Sync.vaciarCola(), 1500);   // por si la cola quedó a medias
      }
      UI.cerrarModal();
      UI.toast(`🪄 Costo estimado puesto a ${elegidas.length} facturas de plata`);
      render();
    });
  }

  async function render() {
    const { d, h } = rangoDe(periodo);
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = (monto, mon) => (mon === 'USD' && tasa ? monto * tasa : monto) || 0;

    const todas = (await DB.facturas.list()).filter(f => f.estado !== 'anulada');

    /* ── Tu semana: la rutina de 15 minutos del dueño ──
       Últimos 7 días contra los 7 anteriores (ventanas completas — la
       comparación no engaña a mitad de semana). El DSO usa las ventas
       de 90 días: cuántos días tarda en volver el dinero facturado. */
    {
      const hoyIso = UI.fechaISO();
      const hace = n => UI.fechaISO(new Date(Date.now() - n * 864e5));
      const d7 = hace(7), d14 = hace(14), d90 = hace(90);
      const cobradoEn = (desde, hasta) => todas.reduce((s, f) =>
        s + (f.abonos || []).filter(a => a.fecha > desde && a.fecha <= hasta)
          .reduce((s2, a) => s2 + conv(a.monto, f.moneda || 'DOP'), 0), 0);
      const facturadoEn = (desde, hasta) => todas
        .filter(f => (f.fecha || '') > desde && (f.fecha || '') <= hasta)
        .reduce((s, f) => s + conv(f.total, f.moneda || 'DOP'), 0);
      const cob7 = cobradoEn(d7, hoyIso), cobPrev = cobradoEn(d14, d7);
      const fac7 = facturadoEn(d7, hoyIso), facPrev = facturadoEn(d14, d7);
      const pendTotal = todas.filter(f => f.estado === 'pendiente' && f.saldo > 0)
        .reduce((s, f) => s + conv(f.saldo, f.moneda || 'DOP'), 0);
      const ventas90 = facturadoEn(d90, hoyIso);
      const dso = ventas90 > 0 ? Math.round(pendTotal / ventas90 * 90) : null;
      const con90 = todas.filter(f => (f.fecha || '') > d90 && f.costo > 0);
      const v90c = con90.reduce((s, f) => s + conv(f.total, f.moneda || 'DOP'), 0);
      const c90 = con90.reduce((s, f) => s + conv(f.costo, f.moneda || 'DOP'), 0);
      const margen90 = v90c > 0 ? Math.round((v90c - c90) / v90c * 100) : null;
      const delta = (v, p) => (v || p)
        ? `<span class="${v >= p ? 'verde' : 'rojo'}">${v >= p ? '↑' : '↓'} ${UI.fmtDinero(Math.abs(v - p))}</span> vs. la semana anterior`
        : 'sin movimiento en dos semanas';
      $('#finSemana').innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <h2>📆 Tu semana <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.8rem">· últimos 7 días — la rutina de 15 minutos</span></h2>
          <div class="stat-grid">
            ${UI.statTile(UI.fmtDinero(cob7), 'Cobrado', 'verde')}
            ${UI.statTile(UI.fmtDinero(fac7), 'Facturado')}
            ${UI.statTile(UI.fmtDinero(pendTotal), 'En la calle', pendTotal > 0 ? 'rojo' : '')}
            ${UI.statTile(dso === null ? '—' : dso + ' días', 'DSO · días en cobrar')}
            ${UI.statTile(margen90 === null ? '—' : margen90 + '%', 'Margen 90 días')}
          </div>
          <p class="muted" style="margin-top:10px;line-height:1.8">
            💵 Cobrado: ${delta(cob7, cobPrev)} · 🧾 Facturado: ${delta(fac7, facPrev)}.<br>
            El <b>DSO</b> es cuántos días tarda en regresar el dinero que facturas — si sube semana tras semana, los cobros se están enfriando.
          </p>
        </div>`;
    }

    const fs = todas
      .filter(f => (!d || (f.fecha || '') >= d) && (!h || (f.fecha || '') <= h))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    let ventas = 0, cobrado = 0, pendiente = 0, costo = 0, ventasConCosto = 0, conCosto = 0, hayUSD = false;
    for (const f of fs) {
      const mon = f.moneda || 'DOP';
      if (mon === 'USD') hayUSD = true;
      ventas += conv(f.total, mon);
      cobrado += conv(f.total - (f.saldo || 0), mon);
      if (f.estado === 'pendiente') pendiente += conv(f.saldo, mon);
      if (f.costo > 0) {
        conCosto++;
        costo += conv(f.costo, mon);
        ventasConCosto += conv(f.total, mon);
      }
    }
    const ganancia = ventasConCosto - costo;
    const margen = ventasConCosto > 0 ? Math.round(ganancia / ventasConCosto * 100) : null;

    // Ganancia NETA = bruta − gastos OPERATIVOS del período.
    // "Materiales" queda fuera: es inversión en inventario y ya resta
    // en la bruta vía el costo de cada pieza (evita contarlo dos veces).
    const esMaterial = g => /^materiales/i.test((g.gasto && g.gasto.categoria) || '');
    const todosGastos = await gastosEn(d, h);
    const gastosNeg = todosGastos
      .filter(g => g.gasto.ambito === 'negocio' && !esMaterial(g))
      .reduce((s, g) => s + g.enRD, 0);
    const neta = ganancia - gastosNeg;
    /* Sueldos = TODO lo personal (lo que el dueño se llevó);
       Cuadre = lo que NO se ve en ningún otro renglón de la vista:
       materiales (fuera de operativos a propósito) y cualquier otra
       salida sin casilla. Operativos + Sueldos + Cuadre = todos los
       gastos del período, sin repetir nada. */
    const sueldos = todosGastos
      .filter(g => g.gasto.ambito === 'personal')
      .reduce((s, g) => s + g.enRD, 0);
    const esCuadre = g => g.gasto.ambito !== 'personal' &&
      !(g.gasto.ambito === 'negocio' && !esMaterial(g));
    const cuadreGastos = todosGastos.filter(esCuadre).reduce((s, g) => s + g.enRD, 0);

    $('#finStats').innerHTML =
      statTile(fmtDinero(ventas), `Ventas · ${fs.length} facturas`, '', 'stat-hero') +
      statTile(fmtDinero(cobrado), 'Cobrado', 'verde') +
      statTile(fmtDinero(pendiente), 'Pendiente', pendiente > 0 ? 'rojo' : '') +
      statTile(fmtDinero(costo), 'Costos') +
      statTile(fmtDinero(ganancia), 'Ganancia bruta', ganancia >= 0 ? 'verde' : 'rojo') +
      statTile(margen === null ? '—' : margen + '%', 'Margen') +
      statTile(fmtDinero(gastosNeg), 'Gastos operativos') +
      statTile(fmtDinero(neta), 'Ganancia neta', neta >= 0 ? 'verde' : 'rojo') +
      statTile(fmtDinero(sueldos), 'Sueldos (personal) · toca 🔍', '', 'tile-sueldos') +
      statTile(fmtDinero(cuadreGastos), 'Cuadre', '', 'tile-cuadre');

    /* Desglose tocable: para cuadrar el número contra los papeles */
    const desgloseGastos = (titulo, arr, total) => UI.abrirModal(titulo, (arr.length
      ? arr.slice().sort((a, b) => b.enRD - a.enRD).map(g => `
        <div class="abono-row">
          <span>${fmtFecha(g.fecha)} · ${esc(g.desc || (g.gasto && g.gasto.categoria) || 'Gasto')}<br>
            <span class="muted" style="font-size:.78rem">${esc((g.gasto && g.gasto.categoria) || '')}${
              g.gasto && g.gasto.cuentaNombre ? ' · ' + esc(g.gasto.cuentaNombre) : ''}${
              g.moneda === 'USD' ? ` · US$${Number(g.monto).toLocaleString('en-US')} a tasa` : ''}</span></span>
          <b>${fmtDinero(g.enRD)}</b>
        </div>`).join('') +
        `<div class="abono-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:10px">
          <span><b>Total del período</b></span><b>${fmtDinero(total)}</b></div>`
      : '<p class="muted">Sin gastos de este tipo en el período.</p>'));
    const tS = document.querySelector('.tile-sueldos');
    const tC = document.querySelector('.tile-cuadre');
    if (tS) { tS.style.cursor = 'pointer'; tS.addEventListener('click', () =>
      desgloseGastos('💼 Sueldos (personal) — desglose', todosGastos.filter(g => g.gasto.ambito === 'personal'), sueldos)); }
    if (tC) { tC.style.cursor = 'pointer'; tC.addEventListener('click', () =>
      desgloseGastos('🏦 Cuadre — gastos que no salen en otros renglones (materiales y demás)', todosGastos.filter(esCuadre), cuadreGastos)); }

    $('#finNota').innerHTML =
      (conCosto < fs.length
        ? `Ganancia y margen calculados sobre las <b>${conCosto} de ${fs.length}</b> facturas que tienen costo — ponle el costo a las demás (✏️ Editar) para afinar el número.`
        : fs.length ? 'Todas las facturas del período tienen costo. 🎉' : 'No hay facturas en este período.') +
      (hayUSD ? (tasa ? ` Los US$ se convierten a RD$ con la tasa actual (${tasa}).` : ' ⚠ Hay facturas en US$ y no hay tasa configurada en la Calculadora — se suman sin convertir.') : '');

    /* ── Medidor: cuánto de lo vendido ya está cobrado ── */
    const elMeter = $('#finMeter');
    if (ventas > 0) {
      const pct = Math.max(0, Math.min(100, Math.round(cobrado / ventas * 100)));
      elMeter.hidden = false;
      elMeter.innerHTML = `
        <div class="fin-meter-cab">
          <span>Cobrado <b>${fmtDinero(cobrado)}</b> de ${fmtDinero(ventas)} · <b>${pct}%</b></span>
          ${pendiente > 0
            ? `<span class="rojo">En la calle ${fmtDinero(pendiente)}</span>`
            : '<span class="verde">Todo cobrado 🎉</span>'}
        </div>
        <div class="fin-meter-track"><div style="width:${pct}%"></div></div>`;
    } else elMeter.hidden = true;

    /* ── Gráficos ── */
    renderCharts(fs, conv, d, h);

    /* ── Facturas del período ── */
    const vista = fs.slice(0, 100);
    $('#finLista').innerHTML = vista.map(f => {
      const t = f.moneda || 'DOP';
      const gan = f.costo > 0 ? f.total - f.costo : null;
      return `
      <div class="item" data-id="${f.id}">
        <div class="item-info">
          <div class="item-name">${esc(f.clienteNombre)} <span class="muted">${esc(f.orden ? '#' + f.orden : (f.numero || 's/n'))}</span></div>
          <div class="item-sub">${fmtFecha(f.fecha)} · ${fmtMoneda(f.total, t)}${
            gan !== null ? ` · <span class="${gan >= 0 ? 'verde' : 'rojo'}">ganó ${fmtMoneda(gan, t)}</span>` : ''}${
            f.estado === 'pendiente' && f.saldo > 0 ? ` · <span class="rojo">debe ${fmtMoneda(f.saldo, t)}</span>` : ''}
            · costo <input class="fin-costo ${f.costoEstimado ? 'fin-costo-est' : ''}" data-fid="${f.id}" type="text" inputmode="decimal" autocomplete="off" value="${f.costo ?? ''}" placeholder="5000+1200+300" title="${f.costoEstimado ? 'Costo estimado automáticamente — escribe encima para corregirlo' : 'Acepta sumas: 5000+1200+300'}"></div>
        </div>
        <span class="item-arrow">›</span>
      </div>`;
    }).join('') + (fs.length > vista.length
      ? `<p class="muted" style="text-align:center;padding:10px">Mostrando 100 de ${fs.length} facturas.</p>` : '') ||
      '<div class="empty"><span>📈</span>No hay facturas en este período.</div>';
  }

  /* ── Gráficos: ventas por día/mes + top clientes ────────── */
  function renderCharts(fs, conv, d, h) {
    const cont = $('#finCharts');
    const conFecha = fs.filter(f => f.fecha);
    if (!conFecha.length) { cont.innerHTML = ''; chartData = []; return; }

    /* Rango real: el elegido, o el de las propias facturas (histórico).
       El tope se recorta a hoy para no pintar días futuros vacíos. */
    const isoLocal = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const fechas = conFecha.map(f => f.fecha).sort();
    const ultima = fechas[fechas.length - 1], hoy = isoLocal(new Date());
    const d0 = d || fechas[0];
    let h0 = h || ultima;
    if (h0 > hoy) h0 = hoy;
    if (h0 < ultima) h0 = ultima;    // por si hay facturas con fecha futura
    if (h0 < d0) h0 = d0;
    const dias = Math.round((new Date(h0 + 'T00:00:00') - new Date(d0 + 'T00:00:00')) / 86400000) + 1;
    const esDiario = dias <= 62;

    /* Cubetas rellenas con ceros para que el eje del tiempo sea honesto */
    const cubetas = new Map();   // clave → { v, c, vcc, n }
    if (esDiario) {
      const dt = new Date(d0 + 'T00:00:00');
      for (let i = 0; i < dias; i++) {
        cubetas.set(isoLocal(dt), { v: 0, c: 0, vcc: 0, n: 0 });
        dt.setDate(dt.getDate() + 1);
      }
    } else {
      let [yy, mm] = d0.split('-').map(Number);
      const [yF, mF] = h0.split('-').map(Number);
      while (yy < yF || (yy === yF && mm <= mF)) {
        cubetas.set(`${yy}-${String(mm).padStart(2, '0')}`, { v: 0, c: 0, vcc: 0, n: 0 });
        if (++mm > 12) { mm = 1; yy++; }
      }
    }
    for (const f of conFecha) {
      const clave = esDiario ? f.fecha : f.fecha.slice(0, 7);
      const g = cubetas.get(clave);
      if (!g) continue;
      const mon = f.moneda || 'DOP';
      g.v += conv(f.total, mon); g.n++;
      if (f.costo > 0) { g.c += conv(f.costo, mon); g.vcc += conv(f.total, mon); }
    }

    const buckets = [...cubetas.entries()].map(([clave, g]) => {
      const titulo = esDiario
        ? fmtFecha(clave)
        : `${MESES[Number(clave.slice(5)) - 1]} ${clave.slice(0, 4)}`;
      const x = esDiario ? String(Number(clave.slice(8))) : MESES[Number(clave.slice(5)) - 1];
      return { clave, titulo, x, ...g };
    });
    chartData = buckets;

    const tope = topeBonito(Math.max(...buckets.map(b => b.v), 1));
    const capLabels = !esDiario && buckets.length <= 9;   // pocos meses → valor sobre cada barra
    const pasoX = Math.max(1, Math.ceil(buckets.length / (esDiario ? 8 : 13)));

    const columnas = buckets.map((b, i) => {
      const pct = Math.round(b.v / tope * 1000) / 10;
      return `
      <div class="ch-col" data-i="${i}" tabindex="0" aria-label="${esc(b.titulo)}: ${esc(fmtDinero(b.v))}">
        <div class="ch-stack">
          ${capLabels && b.v > 0 ? `<span class="ch-val" style="bottom:calc(${pct}% + 3px)">${compacto(b.v)}</span>` : ''}
          <div class="ch-bar" style="height:${pct}%${b.v <= 0 ? ';display:none' : ''}"></div>
        </div>
        <span class="ch-x">${i % pasoX === 0 || i === buckets.length - 1 ? esc(b.x) : ''}</span>
      </div>`;
    }).join('');

    /* Top clientes del período */
    const porCli = new Map();
    for (const f of fs) {
      const nom = f.clienteNombre || 'Sin nombre';
      const g = porCli.get(nom) || { v: 0, n: 0 };
      g.v += conv(f.total, f.moneda || 'DOP'); g.n++;
      porCli.set(nom, g);
    }
    const top = [...porCli.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 6);
    const maxCli = top.length ? top[0][1].v : 1;

    cont.innerHTML = `
      <div class="card">
        <h2>${esDiario ? '📊 Ventas por día' : '📊 Ventas por mes'}</h2>
        <div class="ch-scroll">
          <div class="ch-plot" style="min-width:${buckets.length * 14}px">
            <div class="ch-grid">
              <div class="ch-gridline" style="top:0"><span>${compacto(tope)}</span></div>
              <div class="ch-gridline" style="top:50%"><span>${compacto(tope / 2)}</span></div>
              <div class="ch-gridline" style="bottom:0"></div>
            </div>
            <div class="ch-cols">${columnas}</div>
            <div class="ch-tip" hidden></div>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>👑 Top clientes</h2>
        <div class="top-cli">
          ${top.map(([nom, g]) => `
            <div>
              <div class="top-cli-cab">
                <span class="nom">${esc(nom)} <span class="muted">· ${g.n} fact.</span></span>
                <b>${fmtDinero(g.v)}</b>
              </div>
              <div class="top-cli-track"><div style="width:${Math.round(g.v / maxCli * 100)}%"></div></div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* Tooltip del gráfico de columnas (los nombres van con textContent) */
  function mostrarTip(col) {
    const plot = col.closest('.ch-plot'), tip = plot && plot.querySelector('.ch-tip');
    const b = chartData[Number(col.dataset.i)];
    if (!tip || !b) return;
    tip.textContent = '';
    const t = document.createElement('div');
    t.className = 'ch-tip-t'; t.textContent = b.titulo;
    tip.append(t);
    const fila = (etq, val, cls) => {
      const r = document.createElement('div'); r.className = 'ch-tip-fila';
      const e = document.createElement('span'); e.textContent = etq;
      const v = document.createElement('b'); v.textContent = val;
      if (cls) v.className = cls;
      r.append(e, v); tip.append(r);
    };
    fila('Ventas', fmtDinero(b.v));
    fila('Facturas', String(b.n));
    if (b.c > 0) {
      const g = b.vcc - b.c;
      fila('Costos', fmtDinero(b.c));
      fila('Ganancia', fmtDinero(g), g >= 0 ? 'verde' : 'rojo');
    }
    tip.hidden = false;
    const pr = plot.getBoundingClientRect(), cr = col.getBoundingClientRect();
    const barra = col.querySelector('.ch-bar');
    const br = barra && barra.style.display !== 'none' ? barra.getBoundingClientRect() : cr;
    const x = cr.left - pr.left + cr.width / 2 - tip.offsetWidth / 2;
    tip.style.left = Math.max(0, Math.min(x, pr.width - tip.offsetWidth)) + 'px';
    tip.style.top = Math.max(0, (br.top - pr.top) - tip.offsetHeight - 8) + 'px';
  }
  function ocultarTip() {
    document.querySelectorAll('.ch-tip').forEach(t => { t.hidden = true; });
  }

  /* ═══════ Cuadre contra QuickBooks ═══════════════════════════
     Compara las facturas de ESTE dispositivo con el export de
     QuickBooks que viene con la app (corte 27 jul 2026) y muestra
     exactamente qué está anulado, qué falta, qué cambió de monto y
     qué es nuevo — para cuadrar contra los reportes de QuickBooks. */
  const CORTE_QB = '2026-07-27';
  const DUP_CONOCIDAS = new Set([
    'fac-qb-00086', 'fac-qb-00089', 'fac-qb-00104', 'fac-qb-00105', 'fac-qb-00115',
    'fac-qb-00120', 'fac-qb-00122', 'fac-qb-00145', 'fac-qb-00160', 'fac-qb-00175',
    'fac-qb-00187', 'fac-qb-00199', 'fac-qb-00205', 'fac-qb-00229', 'fac-qb-00232',
    'fac-qb-00282', 'fac-qb-00307', 'fac-qb-00316', 'fac-qb-00357', 'fac-qb-00362',
    'fac-qb-00468', 'fac-qb-00485', 'fac-qb-00496',
    'fac-qb-00045',                                  // duplicada de Samuel Tejeda
    /* Internas sin NCF re-facturadas con comprobante (cuadre del 31 jul 2026,
       confirmado mes por mes contra los balances de QuickBooks) */
    'fac-qb-00396', 'fac-qb-00393', 'fac-qb-00377', 'fac-qb-00361', 'fac-qb-00343',
    'fac-qb-00339', 'fac-qb-00328', 'fac-qb-00283', 'fac-qb-00273', 'fac-qb-00260',
    'fac-qb-00245', 'fac-qb-00244', 'fac-qb-00240', 'fac-qb-00222', 'fac-qb-00223',
    'fac-qb-00213', 'fac-qb-00214', 'fac-qb-00190', 'fac-qb-00158', 'fac-qb-00139',
    'fac-qb-00092',
  ]);

  async function cuadreQB() {
    let qb;
    try { qb = (await (await fetch('datos-quickbooks.json')).json()).facturas || []; }
    catch { UI.toast('No se pudo leer el export de QuickBooks (¿sin internet?)'); return; }

    const locales = await DB.facturas.list();
    const locPorId = new Map(locales.map(f => [f.id, f]));
    const qbIds = new Set(qb.map(f => f.id));
    const es2026 = f => (f.fecha || '').startsWith('2026');
    /* Referencia = export SIN las duplicadas ya confirmadas (así el cuadre
       marca solo lo inesperado) */
    const refActiva = f => f.estado !== 'anulada' && !DUP_CONOCIDAS.has(f.id);

    const anuladas = [], faltantes = [], distintas = [];
    for (const f of qb) {
      if (!es2026(f) || !refActiva(f)) continue;
      const l = locPorId.get(f.id);
      if (!l) { faltantes.push(f); continue; }
      if (l.estado === 'anulada') { anuladas.push(l); continue; }
      if (Math.abs((l.total || 0) - f.total) > 0.01) distintas.push({ f, l });
    }
    const nuevas = locales
      .filter(l => !qbIds.has(l.id) && l.estado !== 'anulada' && es2026(l))
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    /* Ventas por mes: dispositivo vs export limpio */
    const porMes = new Map();
    const add = (f, campo) => {
      const clave = f.fecha.slice(0, 7);
      const g = porMes.get(clave) || { disp: 0, qb: 0 };
      g[campo] += Number(f.total) || 0;
      porMes.set(clave, g);
    };
    for (const l of locales) if (es2026(l) && l.estado !== 'anulada') add(l, 'disp');
    for (const f of qb) if (es2026(f) && refActiva(f)) add(f, 'qb');

    const sum = (arr, sel) => arr.reduce((s, x) => s + (Number(sel ? sel(x) : x.total) || 0), 0);
    const dispCorte = sum(locales.filter(l => l.estado !== 'anulada' && es2026(l) && l.fecha <= CORTE_QB));
    const qbCorte = sum(qb.filter(f => es2026(f) && refActiva(f) && f.fecha <= CORTE_QB));

    const filaF = f => `<tr><td>${esc(f.numero || f.orden || 's/n')} · ${esc(f.clienteNombre || '')} <span class="muted">${fmtFecha(f.fecha)}</span></td><td class="num">${fmtMoneda(f.total, f.moneda || 'DOP')}</td></tr>`;
    const seccion = (titulo, filas, vacio) => `
      <h3 class="sub-h">${titulo}</h3>
      ${filas.length ? `<table class="fact-lineas"><tbody>${filas.join('')}</tbody></table>` : `<p class="muted">${vacio}</p>`}`;

    UI.abrirModal('🔍 Cuadre contra QuickBooks', `
      <p class="muted" style="margin-bottom:10px">
        Comparación de este dispositivo contra el export de QuickBooks
        (corte <b>27 jul 2026</b>), descontando las ${DUP_CONOCIDAS.size} facturas confirmadas
        como duplicadas o internas sin NCF (cuadradas contra QuickBooks el 31 jul 2026).
      </p>
      <table class="fact-lineas"><tbody>
        <tr><td>Ventas 2026 hasta el corte — <b>este dispositivo</b></td><td class="num"><b>${fmtMoneda(dispCorte)}</b></td></tr>
        <tr><td>Ventas 2026 hasta el corte — <b>export limpio</b></td><td class="num"><b>${fmtMoneda(qbCorte)}</b></td></tr>
        <tr><td>Diferencia</td><td class="num ${Math.abs(dispCorte - qbCorte) > 0.01 ? 'rojo' : 'verde'}"><b>${fmtMoneda(dispCorte - qbCorte)}</b></td></tr>
      </tbody></table>

      <h3 class="sub-h">Por mes (dispositivo vs export limpio)</h3>
      <table class="fact-lineas"><tbody>
        ${[...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([clave, g]) => {
          const dif = g.disp - g.qb;
          return `<tr><td>${MESES[Number(clave.slice(5)) - 1]} ${clave.slice(0, 4)}${clave === '2026-07' ? ' <span class="muted">(QB solo hasta el 27)</span>' : ''}</td>
            <td class="num">${fmtMoneda(g.disp)} <span class="muted">vs</span> ${fmtMoneda(g.qb)}${Math.abs(dif) > 0.01 ? ` <b class="rojo">(${dif > 0 ? '+' : ''}${fmtDinero(dif)})</b>` : ' <span class="verde">✓</span>'}</td></tr>`;
        }).join('')}
      </tbody></table>

      ${seccion(`⚠ Del export pero ANULADAS aquí (${anuladas.length}) — si QuickBooks las tiene válidas, hay que restaurarlas`,
        anuladas.map(filaF), 'Ninguna — bien.')}
      ${seccion(`⚠ Del export pero NO EXISTEN aquí (${faltantes.length})`,
        faltantes.map(filaF), 'Ninguna — bien.')}
      ${seccion(`⚠ Con TOTAL DIFERENTE al export (${distintas.length})`,
        distintas.map(({ f, l }) => `<tr><td>${esc(f.numero || 's/n')} · ${esc(f.clienteNombre || '')}</td><td class="num">aquí ${fmtMoneda(l.total, l.moneda || 'DOP')} · export ${fmtMoneda(f.total)}</td></tr>`),
        'Ninguna — bien.')}
      ${seccion(`Nuevas en el CRM, no están en el export (${nuevas.length}) — suman ${fmtMoneda(sum(nuevas))}`,
        nuevas.map(filaF), 'Ninguna.')}
    `);
  }

  /* ── Reportes para el contador (usan el período elegido arriba) ── */
  async function datosReporteVentas(d, h) {
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const clientes = await DB.clientes.list();
    const rncDe = new Map(clientes.map(c => [c.id, c.rnc || '']));
    const fs = (await DB.facturas.list())
      .filter(f => (!d || (f.fecha || '') >= d) && (!h || (f.fecha || '') <= h))
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    const n2 = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Cada fila va en su moneda original (columna Mon.), pero los TOTALES
    // convierten los US$ a RD$ con la tasa viva para no mezclar monedas
    const convT = (m, mon) => (mon === 'USD' && tasa ? m * tasa : m) || 0;
    let tSub = 0, tImp = 0, tTot = 0, tCob = 0, tPen = 0, hayUSD = false;
    const filas = fs.map(f => {
      const anulada = f.estado === 'anulada';
      const mon = f.moneda || 'DOP';
      if (mon === 'USD') hayUSD = true;
      const imp = f.impuesto || 0;
      const sub = (f.total || 0) - imp;
      const cob = anulada ? 0 : (f.total || 0) - (f.saldo || 0);
      const pen = f.estado === 'pendiente' ? (f.saldo || 0) : 0;
      if (!anulada) {
        tSub += convT(sub, mon); tImp += convT(imp, mon); tTot += convT(f.total || 0, mon);
        tCob += convT(cob, mon); tPen += convT(pen, mon);
      }
      return [UI.fmtFecha(f.fecha), f.numero || '', f.orden ? '#' + f.orden : '', f.clienteNombre,
        rncDe.get(f.clienteId) || '', n2(sub), n2(imp), n2(f.total), n2(cob), n2(pen),
        anulada ? 'ANULADA' : f.estado, mon === 'USD' ? 'US$' : 'RD$'];
    });
    return {
      titulo: 'Reporte de ventas (facturas)',
      seccion: {
        columnas: [
          { t: 'Fecha', w: 58 }, { t: 'NCF', w: 82 }, { t: 'Orden', w: 40 },
          { t: 'Cliente', w: 150 }, { t: 'RNC/Céd.', w: 68 },
          { t: 'Subtotal', w: 62, a: 'right' }, { t: 'ITBIS', w: 52, a: 'right' },
          { t: 'Total', w: 66, a: 'right' }, { t: 'Cobrado', w: 66, a: 'right' },
          { t: 'Pendiente', w: 66, a: 'right' }, { t: 'Estado', w: 52 }, { t: 'Mon.', w: 30 },
        ],
        filas,
        totales: ['TOTALES', '', '', `${fs.length} facturas`, '', n2(tSub), n2(tImp), n2(tTot), n2(tCob), n2(tPen), '', ''],
      },
      nota: 'Las anuladas se listan pero NO suman en los totales.' +
        (hayUSD ? (tasa ? ` Los US$ se convierten a RD$ en los totales (tasa ${tasa}).` : ' ⚠ Hay US$ y no hay tasa — totales sin convertir.') : ''),
    };
  }

  async function datosReporteCobros(d, h) {
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const fs = (await DB.facturas.list()).filter(f => f.estado !== 'anulada');
    const n2 = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const movs = [];
    let totalRD = 0;
    for (const f of fs) {
      for (const a of (f.abonos || [])) {
        if ((d && (a.fecha || '') < d) || (h && (a.fecha || '') > h)) continue;
        const enRD = f.moneda === 'USD' && tasa ? a.monto * tasa : a.monto;
        totalRD += enRD;
        movs.push({ fecha: a.fecha, fila: [UI.fmtFecha(a.fecha), f.clienteNombre,
          f.orden ? '#' + f.orden : (f.numero || ''), a.metodo || '', a.cuentaNombre || '', n2(a.monto),
          f.moneda === 'USD' ? 'US$' : 'RD$', n2(enRD)] });
      }
    }
    movs.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    return {
      titulo: 'Reporte de cobros (pagos recibidos)',
      seccion: {
        columnas: [
          { t: 'Fecha', w: 60 }, { t: 'Cliente', w: 140 }, { t: 'Factura', w: 70 },
          { t: 'Método', w: 70 }, { t: 'Cuenta', w: 95 }, { t: 'Monto', w: 60, a: 'right' },
          { t: 'Mon.', w: 30 }, { t: 'En RD$', w: 62, a: 'right' },
        ],
        filas: movs.map(m => m.fila),
        totales: ['TOTAL', `${movs.length} pagos`, '', '', '', '', '', n2(totalRD)],
      },
    };
  }

  function textoPeriodo(d, h) {
    return (!d && !h) ? 'Todo el histórico'
      : `Período: ${d ? UI.fmtFecha(d) : 'inicio'} al ${h ? UI.fmtFecha(h) : 'hoy'}`;
  }

  /* Gastos del cuadre en un rango (docs 'cuadre-mov' con etiqueta gasto) */
  async function gastosEn(d, h) {
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 60;
    return (await DB.config.list())
      .filter(m => m.tipo === 'cuadre-mov' && m.gasto &&
        (!d || (m.fecha || '') >= d) && (!h || (m.fecha || '') <= h))
      .map(m => ({ ...m, enRD: m.moneda === 'USD' ? (m.monto * (tasa || 60)) : m.monto }))
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  }

  /* Reporte de gastos: detalle + por categoría + ganancia bruta y NETA.
     Materiales va aparte: es inventario, ya contado en el costo por pieza. */
  async function datosReporteGastos(d, h) {
    const n2 = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const gastos = await gastosEn(d, h);
    const esMaterial = g => /^materiales/i.test((g.gasto && g.gasto.categoria) || '');
    const materiales = gastos.filter(g => g.gasto.ambito === 'negocio' && esMaterial(g));
    const neg = gastos.filter(g => g.gasto.ambito === 'negocio' && !esMaterial(g));
    const per = gastos.filter(g => g.gasto.ambito === 'personal');
    const sum = arr => arr.reduce((s, g) => s + g.enRD, 0);

    const detalle = {
      titulo: 'Detalle de gastos',
      columnas: [
        { t: 'Fecha', w: 58 }, { t: 'Descripción', w: 200 }, { t: 'Categoría', w: 120 },
        { t: 'Ámbito', w: 58 }, { t: 'Cuenta', w: 110 },
        { t: 'Monto', w: 60, a: 'right' }, { t: 'Mon.', w: 32 }, { t: 'En RD$', w: 65, a: 'right' },
      ],
      filas: gastos.map(g => [UI.fmtFecha(g.fecha), g.desc.replace(/^Gasto [^·]+· /, ''),
        g.gasto.categoria, g.gasto.ambito === 'personal' ? 'Personal' : 'Negocio',
        g.gasto.cuentaNombre || '', n2(g.monto), g.moneda === 'USD' ? 'US$' : 'RD$', n2(g.enRD)]),
      totales: ['TOTAL', `${gastos.length} gastos`, '', '', '', '', '', n2(sum(gastos))],
    };

    const porCat = new Map();
    for (const g of gastos) {
      const k = `${g.gasto.categoria}|${g.gasto.ambito}`;
      porCat.set(k, (porCat.get(k) || 0) + g.enRD);
    }
    const categorias = {
      titulo: 'Por categoría',
      columnas: [{ t: 'Categoría', w: 240 }, { t: 'Ámbito', w: 80 }, { t: 'Total RD$', w: 100, a: 'right' }],
      filas: [...porCat.entries()].sort((a, b) => b[1] - a[1])
        .map(([k, v]) => { const [cat, amb] = k.split('|'); return [cat, amb === 'personal' ? 'Personal' : 'Negocio', n2(v)]; }),
    };

    // Ganancia bruta del período (ventas con costo) y neta (− gastos de negocio)
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = (m, mon) => (mon === 'USD' && tasa ? m * tasa : m) || 0;
    const fsCosto = (await DB.facturas.list()).filter(f => f.estado !== 'anulada' && f.costo > 0 &&
      (!d || (f.fecha || '') >= d) && (!h || (f.fecha || '') <= h));
    const vc = fsCosto.reduce((s, f) => s + conv(f.total, f.moneda || 'DOP'), 0);
    const cc = fsCosto.reduce((s, f) => s + conv(f.costo, f.moneda || 'DOP'), 0);
    const bruta = vc - cc;
    const neta = bruta - sum(neg);
    const resumen = {
      titulo: 'Resumen del período',
      columnas: [{ t: 'Concepto', w: 340 }, { t: 'RD$', w: 120, a: 'right' }],
      filas: [
        ['Gastos operativos del negocio (sin materiales)', n2(sum(neg))],
        ['Compras de materiales — inventario, ya contadas en el costo de las piezas', n2(sum(materiales))],
        ['Gastos personales', n2(sum(per))],
        ['Total de salidas', n2(sum(gastos))],
        [`Ganancia BRUTA (ventas con costo: ${fsCosto.length} fact.)`, n2(bruta)],
        ['Ganancia NETA (bruta − gastos operativos)', n2(neta)],
      ],
    };
    return { titulo: 'Reporte de gastos', secciones: [detalle, categorias, resumen], horizontal: true };
  }

  async function reporte(tipo, salida) {
    const { d, h } = rangoDe(periodo);
    let titulo, secciones, horizontal = false, nota = '';
    if (tipo === 'ventas') {
      const r = await datosReporteVentas(d, h);
      titulo = r.titulo; secciones = [r.seccion]; horizontal = true; nota = r.nota || '';
    } else if (tipo === 'cobros') {
      const r = await datosReporteCobros(d, h);
      titulo = r.titulo; secciones = [r.seccion];
    } else {
      const r = await datosReporteGastos(d, h);
      titulo = r.titulo; secciones = r.secciones; horizontal = r.horizontal;
    }
    const sub = textoPeriodo(d, h) + (nota ? ` · ${nota}` : '');
    const archivo = `silvershine-${tipo}-${(d || 'inicio')}-a-${(h || 'hoy')}`;
    if (salida === 'csv') Reportes.descargarCSV(archivo + '.csv', secciones);
    else if (salida === 'pdf') await Reportes.pdf(archivo + '.pdf', titulo, sub, secciones, { horizontal });
    else await Reportes.imprimir(titulo, sub, secciones, { horizontal });
  }

  function init() {
    UI.$$('#finReportes [data-rep]').forEach(b => b.addEventListener('click', () => {
      const [tipo, salida] = b.dataset.rep.split('-');
      reporte(tipo, salida);
    }));
    $('#finPeriodo').addEventListener('change', e => {
      periodo = e.target.value;
      $('#finCustom').hidden = periodo !== 'custom';
      if (periodo !== 'custom') render();
    });
    /* Escribir una fecha activa el rango personalizado solo (aunque el
       selector estuviera en otro período) y filtra al momento */
    const usarCustom = () => { periodo = 'custom'; $('#finPeriodo').value = 'custom'; $('#finCustom').hidden = false; };
    $('#finDesde').addEventListener('change', e => { desde = e.target.value; usarCustom(); render(); });
    $('#finHasta').addEventListener('change', e => { hasta = e.target.value; usarCustom(); render(); });
    const btnEst = $('#btnEstimarCostos');
    if (btnEst) btnEst.addEventListener('click', estimarCostos);   // puede faltar si el HTML viene de un caché viejo
    const btnCua = $('#btnCuadreQB');
    if (btnCua) btnCua.addEventListener('click', cuadreQB);

    /* Tooltip de los gráficos: ratón y teclado */
    const charts = $('#finCharts');
    charts.addEventListener('pointerover', e => {
      const col = e.target.closest('.ch-col');
      if (col) mostrarTip(col);
    });
    charts.addEventListener('pointerout', e => {
      if (e.target.closest('.ch-col')) ocultarTip();
    });
    charts.addEventListener('focusin', e => {
      const col = e.target.closest('.ch-col');
      if (col) mostrarTip(col);
    });
    charts.addEventListener('focusout', ocultarTip);

    $('#finLista').addEventListener('click', e => {
      if (e.target.closest('.fin-costo')) return;   // escribir el costo no abre el detalle
      const item = e.target.closest('.item[data-id]');
      if (item) Facturas.detalle(item.dataset.id);
    });
    /* Guardar el costo directo desde la fila.
       La celda acepta sumas y restas: "5000+1200+300" → 6,500. */
    const evaluarCosto = txt => {
      const limpio = String(txt).replace(/,/g, '').replace(/\s+/g, '');
      if (!limpio) return null;                              // vacío = quitar costo
      if (!/^[\d.+\-*/()]+$/.test(limpio)) return NaN;
      try {
        const v = Function(`"use strict";return(${limpio})`)();
        return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : NaN;
      } catch { return NaN; }
    };
    $('#finLista').addEventListener('change', async e => {
      const inp = e.target.closest('.fin-costo');
      if (!inp) return;
      const v = evaluarCosto(inp.value);
      if (Number.isNaN(v)) { UI.toast('Costo no válido — usa números y + − × ÷, ej: 5000+1200'); render(); return; }
      const f = await DB.facturas.get(inp.dataset.fid);
      if (!f) return;
      f.costo = v || null;
      f.costoEstimado = null;                 // escrito a mano: ya no es un estimado
      await DB.facturas.upsert(f);
      UI.toast(f.costo ? `Costo guardado: ${fmtMoneda(f.costo, f.moneda || 'DOP')}` : 'Costo quitado');
      render();
    });
  }

  return { init, render };
})();
