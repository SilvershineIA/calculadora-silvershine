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

  async function render() {
    const { d, h } = rangoDe(periodo);
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = (monto, mon) => (mon === 'USD' && tasa ? monto * tasa : monto) || 0;

    const todas = (await DB.facturas.list()).filter(f => f.estado !== 'anulada');
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

    $('#finStats').innerHTML =
      statTile(fmtDinero(ventas), `Ventas · ${fs.length} facturas`, '', 'stat-hero') +
      statTile(fmtDinero(cobrado), 'Cobrado', 'verde') +
      statTile(fmtDinero(pendiente), 'Pendiente', pendiente > 0 ? 'rojo' : '') +
      statTile(fmtDinero(costo), 'Costos') +
      statTile(fmtDinero(ganancia), 'Ganancia', ganancia >= 0 ? 'verde' : 'rojo') +
      statTile(margen === null ? '—' : margen + '%', 'Margen');

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
            · costo <input class="fin-costo" data-fid="${f.id}" type="text" inputmode="decimal" autocomplete="off" value="${f.costo ?? ''}" placeholder="5000+1200+300" title="Acepta sumas: 5000+1200+300"></div>
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
        <div class="ch-plot">
          <div class="ch-grid">
            <div class="ch-gridline" style="top:0"><span>${compacto(tope)}</span></div>
            <div class="ch-gridline" style="top:50%"><span>${compacto(tope / 2)}</span></div>
            <div class="ch-gridline" style="bottom:0"></div>
          </div>
          <div class="ch-cols">${columnas}</div>
          <div class="ch-tip" hidden></div>
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

  function init() {
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
      await DB.facturas.upsert(f);
      UI.toast(f.costo ? `Costo guardado: ${fmtMoneda(f.costo, f.moneda || 'DOP')}` : 'Costo quitado');
      render();
    });
  }

  return { init, render };
})();
