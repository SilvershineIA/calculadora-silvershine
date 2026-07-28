/* ═══════════════════════════════════════════════════════════
   calculadora.js — Calculadora de piezas (fusionada desde la
   app original). Precios de oro/plata en línea, kilates,
   piedras, desglose y ganancia. Puede pasar el resultado
   directo a una factura o cotización.
   Conserva la configuración guardada de la calculadora
   original (misma clave de almacenamiento).
   ═══════════════════════════════════════════════════════════ */
const Calculadora = (() => {
  const OZ_GRAMOS = 31.1035;
  const METALES = [
    { id: '10k', nombre: 'Oro 10k',   metal: 'oro',   pureza: 0.417, texto: 'oro 10k' },
    { id: '14k', nombre: 'Oro 14k',   metal: 'oro',   pureza: 0.585, texto: 'oro 14k' },
    { id: '18k', nombre: 'Oro 18k',   metal: 'oro',   pureza: 0.750, texto: 'oro 18k' },
    { id: '925', nombre: 'Plata 925', metal: 'plata', pureza: 0.925, texto: 'plata 925' },
  ];
  const PIEDRAS_DEFAULT = [
    { nombre: 'Diamante',   precio: 800 },
    { nombre: 'Moissanita', precio: 80 },
    { nombre: 'Zirconia',   precio: 5 },
  ];
  const LS_KEY = 'calcAnillos.v1';   // misma clave de la calculadora original

  let state = {
    spot: 4050, spotPlata: 46, spotFecha: null,
    kilate: '14k', ajusteOro: 0,
    peso: '', manoObra: 0, margen: 0, descuento: 0,
    moneda: 'DOP', tasa: 58.19, tasaFecha: null,
    monedaVista: null,
    tiposPiedra: JSON.parse(JSON.stringify(PIEDRAS_DEFAULT)),
    piedrasAnillo: [],
  };

  const guardar = () => {
    // Conservar campos de la app original que no usamos (ej. historial)
    let previo = {};
    try { previo = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch {}
    localStorage.setItem(LS_KEY, JSON.stringify({ ...previo, ...state }));
  };
  const cargar = () => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && typeof s === 'object') state = Object.assign(state, s);
    } catch {}
  };

  const $id = id => document.getElementById(id);
  const fmt = n => (isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const enPesosMode = () => state.monedaVista !== 'USD';
  const tasaNum = () => Number(state.tasa) || 0;
  const fmtM = v => enPesosMode() ? fmt(v) + ' ' + state.moneda : '$' + fmt(v);
  const convertirValores = factor => {
    state.manoObra = round2((Number(state.manoObra) || 0) * factor);
    state.tiposPiedra.forEach(t => t.precio = round2((Number(t.precio) || 0) * factor));
  };
  const metalActual = () => METALES.find(x => x.id === state.kilate) || METALES[1];
  const precioGramoDe = m => {
    const spot = Number(m.metal === 'plata' ? state.spotPlata : state.spot) || 0;
    return spot / OZ_GRAMOS * m.pureza * (1 + (Number(state.ajusteOro) || 0) / 100);
  };

  /* ── Precios en línea ── */
  async function fetchOro() {
    const st = $id('spotStatus');
    st.className = 'info'; st.textContent = 'Consultando precios en línea…';
    const pedir = async sym => {
      const r = await fetch('https://api.gold-api.com/price/' + sym, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (!d.price) throw new Error('sin precio');
      return d;
    };
    const [oro, plata] = await Promise.allSettled([pedir('XAU'), pedir('XAG')]);
    const partes = [];
    if (oro.status === 'fulfilled') {
      state.spot = round2(oro.value.price);
      state.spotFecha = oro.value.updatedAt || new Date().toISOString();
      $id('spot').value = state.spot;
      partes.push('oro $' + fmt(state.spot) + '/oz');
    }
    if (plata.status === 'fulfilled') {
      state.spotPlata = round2(plata.value.price);
      $id('spotPlata').value = state.spotPlata;
      partes.push('plata $' + fmt(state.spotPlata) + '/oz');
    }
    if (partes.length) {
      st.className = 'ok';
      st.textContent = '✔ Precios en línea: ' + partes.join(' · ');
      guardar(); render();
    } else {
      st.className = 'err';
      st.textContent = '⚠ Sin conexión a los precios. Usando los últimos: oro $' + fmt(state.spot) + '/oz · plata $' + fmt(state.spotPlata) + '/oz.';
    }
  }

  async function fetchTasa() {
    const st = $id('tasaStatus');
    st.className = 'info'; st.textContent = 'Consultando tasa de cambio…';
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const tasa = d && d.rates && d.rates[state.moneda];
      if (!tasa) throw new Error('moneda no disponible');
      state.tasa = round2(tasa);
      state.tasaFecha = d.time_last_update_utc || new Date().toISOString();
      $id('tasa').value = state.tasa;
      st.className = 'ok';
      st.textContent = '✔ Tasa en línea: 1 USD = ' + fmt(state.tasa) + ' ' + state.moneda;
      guardar(); render();
    } catch (e) {
      st.className = 'err';
      st.textContent = '⚠ Sin conexión a la tasa. Usando la última: ' + fmt(state.tasa) + ' ' + state.moneda + '/USD.';
    }
  }

  /* ── Renders ── */
  function renderKilates() {
    const cont = $id('kilates');
    cont.innerHTML = '';
    METALES.forEach(m => {
      const div = document.createElement('div');
      div.className = 'kt' + (state.kilate === m.id ? ' active' : '');
      const pgUSD = precioGramoDe(m);
      const pgPesos = pgUSD * tasaNum();
      const principal = enPesosMode() ? fmt(pgPesos) + ' ' + state.moneda : '$' + fmt(pgUSD);
      const secundario = enPesosMode() ? '$' + fmt(pgUSD) + ' USD' : fmt(pgPesos) + ' ' + state.moneda;
      div.innerHTML = `<div class="k">${m.nombre}</div>
        <div class="p">${(m.pureza * 100).toFixed(1)}% puro</div>
        <div class="g">${principal}/g</div>
        <div class="p">${secundario}/g</div>`;
      div.onclick = () => { state.kilate = m.id; guardar(); render(); };
      cont.appendChild(div);
    });
  }

  function renderTipos() {
    const tb = $id('tblPrecios').querySelector('tbody');
    tb.innerHTML = '';
    state.tiposPiedra.forEach((p, i) => {
      const tr = document.createElement('tr');
      const tdN = document.createElement('td');
      tdN.setAttribute('data-label', 'Piedra');
      const inN = document.createElement('input');
      inN.value = p.nombre;
      inN.onchange = () => {
        const viejo = p.nombre;
        p.nombre = inN.value.trim() || viejo;
        state.piedrasAnillo.forEach(x => { if (x.tipo === viejo) x.tipo = p.nombre; });
        guardar(); render();
      };
      tdN.appendChild(inN);
      const tdP = document.createElement('td');
      tdP.setAttribute('data-label', 'Precio/quilate');
      const inP = document.createElement('input');
      inP.type = 'number'; inP.step = '0.01'; inP.min = '0'; inP.value = p.precio;
      inP.onchange = () => { p.precio = Number(inP.value) || 0; guardar(); render(); };
      tdP.appendChild(inP);
      const tdX = document.createElement('td');
      const bx = document.createElement('button');
      bx.className = 'btn-x'; bx.textContent = '✕';
      bx.onclick = () => {
        state.tiposPiedra.splice(i, 1);
        state.piedrasAnillo = state.piedrasAnillo.filter(x => x.tipo !== p.nombre);
        guardar(); render();
      };
      tdX.appendChild(bx);
      tr.append(tdN, tdP, tdX);
      tb.appendChild(tr);
    });
  }

  const subtotalPiedra = p => {
    const t = state.tiposPiedra.find(x => x.nombre === p.tipo);
    return t ? (Number(p.quilates) || 0) * (Number(p.cantidad) || 0) * (Number(t.precio) || 0) : 0;
  };

  function renderPiedras() {
    const tb = $id('tblPiedras').querySelector('tbody');
    tb.innerHTML = '';
    state.piedrasAnillo.forEach((p, i) => {
      const tr = document.createElement('tr');
      const tdT = document.createElement('td');
      tdT.setAttribute('data-label', 'Tipo');
      const sel = document.createElement('select');
      state.tiposPiedra.forEach(t => {
        const o = document.createElement('option');
        o.value = t.nombre; o.textContent = t.nombre;
        if (t.nombre === p.tipo) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => { p.tipo = sel.value; guardar(); render(); };
      tdT.appendChild(sel);
      const tdQ = document.createElement('td');
      tdQ.setAttribute('data-label', 'Quilates (c/u)');
      const inQ = document.createElement('input');
      inQ.type = 'number'; inQ.step = '0.01'; inQ.min = '0'; inQ.value = p.quilates;
      inQ.onchange = () => { p.quilates = Number(inQ.value) || 0; guardar(); render(); };
      tdQ.appendChild(inQ);
      const tdC = document.createElement('td');
      tdC.setAttribute('data-label', 'Cantidad');
      const inC = document.createElement('input');
      inC.type = 'number'; inC.step = '1'; inC.min = '1'; inC.value = p.cantidad;
      inC.onchange = () => { p.cantidad = Math.max(1, Math.round(Number(inC.value) || 1)); guardar(); render(); };
      tdC.appendChild(inC);
      const tdS = document.createElement('td');
      tdS.className = 'num';
      tdS.setAttribute('data-label', 'Subtotal');
      tdS.textContent = fmtM(subtotalPiedra(p));
      const tdX = document.createElement('td');
      const bx = document.createElement('button');
      bx.className = 'btn-x'; bx.textContent = '✕';
      bx.onclick = () => { state.piedrasAnillo.splice(i, 1); guardar(); render(); };
      tdX.appendChild(bx);
      tr.append(tdT, tdQ, tdC, tdS, tdX);
      tb.appendChild(tr);
    });
  }

  /* ── Cálculo ── */
  function calcular() {
    const m = metalActual();
    const pGramo = precioGramoDe(m) * (enPesosMode() ? tasaNum() : 1);
    const peso = Number(state.peso) || 0;
    const oro = peso * pGramo;
    const piedras = state.piedrasAnillo.reduce((s, p) => s + subtotalPiedra(p), 0);
    const mano = Number(state.manoObra) || 0;
    const costo = oro + piedras + mano;
    const ganancia = costo * (Number(state.margen) || 0) / 100;
    const bruto = costo + ganancia;
    const descuento = Math.min(Number(state.descuento) || 0, bruto);
    const total = bruto - descuento;
    const gananciaNeta = ganancia - descuento;
    const t = tasaNum();
    const equivalente = enPesosMode() ? (t ? total / t : 0) : total * t;
    return { metal: m, pGramo, peso, oro, piedras, mano, costo, ganancia, bruto, descuento, gananciaNeta, total, equivalente };
  }

  function renderResultado() {
    const c = calcular();
    $id('rMetalNombre').textContent = c.metal.metal === 'plata' ? 'Plata' : 'Oro';
    $id('rKt').textContent = c.metal.id === '925' ? '925' : c.metal.id;
    $id('rPeso').textContent = c.peso;
    $id('rGramo').textContent = fmtM(c.pGramo);
    $id('rOro').textContent = fmtM(c.oro);
    $id('rPiedras').textContent = fmtM(c.piedras);
    $id('rMano').textContent = fmtM(c.mano);
    $id('rCosto').textContent = fmtM(c.costo);
    $id('rMargenPct').textContent = Number(state.margen) || 0;
    $id('rGanancia').textContent = fmtM(c.ganancia);
    $id('lineaDescuento').style.display = c.descuento > 0 ? 'flex' : 'none';
    $id('rDescuento').textContent = '− ' + fmtM(c.descuento);
    $id('rTotal').textContent = fmtM(c.total);
    $id('rEqLabel').textContent = (enPesosMode() ? 'USD' : state.moneda) + ' · tasa ' + fmt(tasaNum());
    $id('rTotalEq').textContent = enPesosMode() ? '$' + fmt(c.equivalente) : fmt(c.equivalente) + ' ' + state.moneda;
    $id('gPct').textContent = Number(state.margen) || 0;
    $id('gGanancia').textContent = fmtM(c.gananciaNeta);
    $id('gGanancia').style.color = c.gananciaNeta < 0 ? 'var(--red)' : '';
  }

  function render() {
    document.querySelectorAll('.lblMon').forEach(el => el.textContent = enPesosMode() ? state.moneda : 'USD');
    renderKilates();
    renderTipos();
    renderPiedras();
    renderResultado();
  }

  /* ── Pasar a factura / cotización ── */
  function descripcionPieza(c) {
    let d = `Anillo de ${c.metal.texto} — ${c.peso} g`;
    const piedras = state.piedrasAnillo
      .filter(p => Number(p.quilates) > 0)
      .map(p => `${p.cantidad} × ${p.tipo} ${p.quilates}ct`);
    if (piedras.length) d += ' · ' + piedras.join(' + ');
    return d;
  }
  function pasarA(destino) {
    const c = calcular();
    if (!(c.total > 0) || !(c.peso > 0)) { UI.toast('Calcula la pieza primero (peso y precio)'); return; }
    const obj = {
      moneda: enPesosMode() ? 'DOP' : 'USD',
      lineas: [{ descripcion: descripcionPieza(c), cantidad: 1, precio: round2(c.total) }],
    };
    if (destino === 'factura') Facturas.formulario(obj);
    else Cotizaciones.formulario({ ...obj, peso: c.peso || null });
  }

  /* ── Eventos ── */
  let fetchHecho = false;
  function init() {
    cargar();
    if (!state.monedaVista) {
      convertirValores(tasaNum() || 1);
      state.monedaVista = 'PESOS';
      guardar();
    }
    $id('spot').value = state.spot;
    $id('spotPlata').value = state.spotPlata;
    $id('ajusteOro').value = state.ajusteOro;
    $id('peso').value = state.peso;
    $id('manoObra').value = state.manoObra;
    $id('margen').value = state.margen;
    $id('descuento').value = state.descuento;
    $id('moneda').value = state.moneda;
    $id('tasa').value = state.tasa;
    $id('monedaVista').value = state.monedaVista;

    const on = (id, ev, fn) => $id(id).addEventListener(ev, fn);
    on('spot', 'input', e => { state.spot = Number(e.target.value) || 0; state.spotFecha = null; guardar(); render(); });
    on('spotPlata', 'input', e => { state.spotPlata = Number(e.target.value) || 0; guardar(); render(); });
    on('ajusteOro', 'input', e => { state.ajusteOro = Number(e.target.value) || 0; guardar(); render(); });
    on('peso', 'input', e => { state.peso = e.target.value; guardar(); render(); });
    on('manoObra', 'input', e => { state.manoObra = Number(e.target.value) || 0; guardar(); render(); });
    on('margen', 'input', e => { state.margen = Number(e.target.value) || 0; guardar(); render(); });
    on('descuento', 'input', e => { state.descuento = Number(e.target.value) || 0; guardar(); render(); });
    on('btnFetch', 'click', fetchOro);
    on('btnFetchTasa', 'click', fetchTasa);
    on('moneda', 'change', e => { state.moneda = e.target.value; guardar(); render(); fetchTasa(); });
    on('tasa', 'input', e => { state.tasa = Number(e.target.value) || 0; state.tasaFecha = null; guardar(); render(); });
    on('monedaVista', 'change', e => {
      const nueva = e.target.value;
      if (nueva === state.monedaVista) return;
      const t = tasaNum();
      if (!t) { UI.toast('Primero define la tasa de cambio'); e.target.value = state.monedaVista; return; }
      convertirValores(nueva === 'USD' ? 1 / t : t);
      state.monedaVista = nueva;
      $id('manoObra').value = state.manoObra;
      guardar(); render();
    });
    on('btnAddTipo', 'click', () => {
      state.tiposPiedra.push({ nombre: 'Nueva piedra ' + (state.tiposPiedra.length + 1), precio: 0 });
      guardar(); render();
    });
    on('btnResetPiedras', 'click', () => {
      if (!confirm('¿Restaurar los precios estándar de piedras?')) return;
      state.tiposPiedra = JSON.parse(JSON.stringify(PIEDRAS_DEFAULT));
      if (enPesosMode()) state.tiposPiedra.forEach(t => t.precio = round2(t.precio * tasaNum()));
      guardar(); render();
    });
    on('btnAddPiedra', 'click', () => {
      if (!state.tiposPiedra.length) { UI.toast('Primero agrega un tipo de piedra'); return; }
      state.piedrasAnillo.push({ tipo: state.tiposPiedra[0].nombre, quilates: 0.5, cantidad: 1 });
      guardar(); render();
    });
    on('btnPasarFactura', 'click', () => pasarA('factura'));
    on('btnPasarCot', 'click', () => pasarA('cotizacion'));
  }

  /* Al abrir la vista: refrescar precios en línea la primera vez */
  function abrir() {
    render();
    if (!fetchHecho) { fetchHecho = true; fetchOro(); fetchTasa(); }
  }

  return { init, abrir, render, tasaActual: () => tasaNum() };
})();
