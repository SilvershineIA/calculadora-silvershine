/* ═══════════════════════════════════════════════════════════
   finanzas.js — Módulo de finanzas: ventas, costos y ganancia
   por período (mes, trimestre, semestre, año o rango libre).
   ═══════════════════════════════════════════════════════════ */
const Finanzas = (() => {
  const { $, fmtMoneda, fmtFecha, esc } = UI;

  let periodo = 'mes', desde = '', hasta = '';

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

    $('#finStats').innerHTML = `
      <div class="stat"><div class="n">${fmtMoneda(ventas)}</div><div class="l">Ventas (${fs.length} fact.)</div></div>
      <div class="stat"><div class="n verde">${fmtMoneda(cobrado)}</div><div class="l">Cobrado</div></div>
      <div class="stat"><div class="n ${pendiente > 0 ? 'rojo' : ''}">${fmtMoneda(pendiente)}</div><div class="l">Pendiente</div></div>
      <div class="stat"><div class="n">${fmtMoneda(costo)}</div><div class="l">Costos</div></div>
      <div class="stat"><div class="n ${ganancia >= 0 ? 'verde' : 'rojo'}">${fmtMoneda(ganancia)}</div><div class="l">Ganancia</div></div>
      <div class="stat"><div class="n">${margen === null ? '—' : margen + '%'}</div><div class="l">Margen</div></div>
    `;
    $('#finNota').innerHTML =
      (conCosto < fs.length
        ? `Ganancia y margen calculados sobre las <b>${conCosto} de ${fs.length}</b> facturas que tienen costo — ponle el costo a las demás (✏️ Editar) para afinar el número.`
        : fs.length ? 'Todas las facturas del período tienen costo. 🎉' : 'No hay facturas en este período.') +
      (hayUSD ? (tasa ? ` Los US$ se convierten a RD$ con la tasa actual (${tasa}).` : ' ⚠ Hay facturas en US$ y no hay tasa configurada en la Calculadora — se suman sin convertir.') : '');

    /* ── Desglose por mes ── */
    const porMes = new Map();
    for (const f of fs) {
      const clave = (f.fecha || '').slice(0, 7);
      if (!clave) continue;
      const g = porMes.get(clave) || { ventas: 0, costo: 0, ventasConCosto: 0, n: 0 };
      const mon = f.moneda || 'DOP';
      g.ventas += conv(f.total, mon); g.n++;
      if (f.costo > 0) { g.costo += conv(f.costo, mon); g.ventasConCosto += conv(f.total, mon); }
      porMes.set(clave, g);
    }
    const meses = [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const maxV = Math.max(...meses.map(([, g]) => g.ventas), 1);
    $('#finMeses').innerHTML = meses.length < 2 ? '' : `
      <h2>Por mes</h2>
      ${meses.map(([clave, g]) => {
        const [yy, mm] = clave.split('-');
        const gan = g.ventasConCosto - g.costo;
        return `
        <div class="fin-mes">
          <div class="fin-mes-cab">
            <span><b>${MESES[Number(mm) - 1]} ${yy}</b> · ${g.n} fact.</span>
            <span>${fmtMoneda(g.ventas)}${g.costo > 0 ? ` · <span class="${gan >= 0 ? 'verde' : 'rojo'}">ganancia ${fmtMoneda(gan)}</span>` : ''}</span>
          </div>
          <div class="fin-barra"><div style="width:${Math.round(g.ventas / maxV * 100)}%"></div></div>
        </div>`;
      }).join('')}`;

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
            gan !== null ? ` · costo ${fmtMoneda(f.costo, t)} · <span class="${gan >= 0 ? 'verde' : 'rojo'}">ganó ${fmtMoneda(gan, t)}</span>` : ' · <span class="muted">sin costo</span>'}${
            f.estado === 'pendiente' && f.saldo > 0 ? ` · <span class="rojo">debe ${fmtMoneda(f.saldo, t)}</span>` : ''}</div>
        </div>
        <span class="item-arrow">›</span>
      </div>`;
    }).join('') + (fs.length > vista.length
      ? `<p class="muted" style="text-align:center;padding:10px">Mostrando 100 de ${fs.length} facturas.</p>` : '') ||
      '<div class="empty"><span>📈</span>No hay facturas en este período.</div>';
  }

  function init() {
    $('#finPeriodo').addEventListener('change', e => {
      periodo = e.target.value;
      $('#finCustom').hidden = periodo !== 'custom';
      if (periodo !== 'custom') render();
    });
    $('#finDesde').addEventListener('change', e => { desde = e.target.value; if (hasta) render(); });
    $('#finHasta').addEventListener('change', e => { hasta = e.target.value; if (desde) render(); });
    $('#finLista').addEventListener('click', e => {
      const item = e.target.closest('.item[data-id]');
      if (item) Facturas.detalle(item.dataset.id);
    });
  }

  return { init, render };
})();
