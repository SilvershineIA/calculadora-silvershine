/* ═══════════════════════════════════════════════════════════
   caja.js — Cuadre de caja y bancos.
   ARQUITECTURA A PRUEBA DE PISOTONES: los saldos NO se guardan
   como número que cada dispositivo reescribe (así se perdían
   movimientos entre teléfono y PC). Se guarda una BASE fija
   (cuentas + saldo inicial) y UN DOC POR MOVIMIENTO — al
   sincronizar, los movimientos de todos los dispositivos se
   unen y el saldo se calcula: inicial + suma de deltas.
   La tasa del dólar viene en vivo de la Calculadora.
   ═══════════════════════════════════════════════════════════ */
const Caja = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;

  const hoyISO = () => UI.fechaISO();
  const r2 = v => Math.round(v * 100) / 100;
  let rangoMovs = 'mes';   // filtro de fecha del historial del panel

  /* Cuentas iniciales = el Excel del usuario (ago 2026).
     EffiCommerce quedó fuera a propósito (no lo usa). */
  const CUENTAS_SEMILLA = [
    { id: 'efectivo',    nombre: 'Efectivo (caja)',              grupo: 'banco',   moneda: 'DOP', saldoInicial: 0 },
    { id: 'mio',         nombre: 'Mio (transitoria tarjetas)',   grupo: 'banco',   moneda: 'DOP', saldoInicial: 0 },
    { id: 'banreservas', nombre: 'Banreservas',                  grupo: 'banco',   moneda: 'DOP', saldoInicial: 92499.36 },
    { id: 'bhd',         nombre: 'BHD',                          grupo: 'banco',   moneda: 'DOP', saldoInicial: 8152.80 },
    { id: 'popular',     nombre: 'Popular',                      grupo: 'banco',   moneda: 'DOP', saldoInicial: 81668.87 },
    { id: 'relay',       nombre: 'Relay',                        grupo: 'usd',     moneda: 'USD', saldoInicial: 119.09 },
    { id: 'shopify',     nombre: 'Shopify Balance',              grupo: 'usd',     moneda: 'USD', saldoInicial: 319.63 },
    { id: 'paypal',      nombre: 'PayPal',                       grupo: 'usd',     moneda: 'USD', saldoInicial: 0 },
    { id: 'tc-dop',      nombre: 'Tarjeta de crédito (RD$)',     grupo: 'tarjeta', moneda: 'DOP', saldoInicial: 65650.42 },
    { id: 'tc-usd',      nombre: 'Tarjeta de crédito (US$)',     grupo: 'tarjeta', moneda: 'USD', saldoInicial: 372.03 },
  ];

  /* Tasa del dólar EN VIVO desde la Calculadora; el respaldo offline es
     local por dispositivo (no se sincroniza: es un valor vivo) */
  const K_TASA = 'sscrm_cuadre_tasa';
  function tasaVigente() {
    const viva = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    if (viva > 0) { try { localStorage.setItem(K_TASA, String(viva)); } catch {} return viva; }
    return Number(localStorage.getItem(K_TASA)) || 60;
  }

  /* Estado calculado: base + movimientos (docs sueltos que se unen al
     sincronizar). Migra el diseño viejo de un solo doc si lo encuentra:
     el PRIMER dispositivo que migre fija la base con SUS saldos — por
     eso conviene actualizar primero el que tenga los números buenos. */
  async function getEstado() {
    let base = await DB.config.get('cuadre-base');
    const viejo = await DB.config.get('cuadre');
    if (!base) {
      const origen = (viejo && viejo.cuentas && viejo.cuentas.length) ? viejo.cuentas : CUENTAS_SEMILLA;
      base = {
        id: 'cuadre-base',
        cuentas: origen.map(c => ({
          id: c.id, nombre: c.nombre, grupo: c.grupo, moneda: c.moneda,
          saldoInicial: c.saldoInicial !== undefined ? c.saldoInicial : (c.saldo || 0),
        })),
        movsHistoricos: ((viejo && viejo.movimientos) || []).slice(0, 50),
      };
      await DB.config.upsert(base);
    }
    if (viejo) await DB.config.remove('cuadre');   // el doc viejo ya no manda

    const movs = (await DB.config.list())
      .filter(x => x.tipo === 'cuadre-mov')
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const saldos = {};
    for (const c of base.cuentas) saldos[c.id] = c.saldoInicial || 0;
    for (const m of movs) {
      for (const cb of (m.cambios || [])) {
        if (saldos[cb.cuenta] !== undefined) saldos[cb.cuenta] = r2(saldos[cb.cuenta] + cb.delta);
      }
    }
    return { base, movs, saldos };
  }

  const uidMov = () => 'cmov-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  async function nuevoMov(desc, cambios, monto, moneda, signo) {
    await DB.config.upsert({
      id: uidMov(), tipo: 'cuadre-mov', ts: Date.now(), fecha: hoyISO(),
      desc, cambios, monto: r2(monto), moneda, signo,
    });
  }

  const fmt = (m, mon) => UI.fmtMoneda(m, mon);

  /* ── Panel ── */
  async function render() {
    const { base, movs, saldos } = await getEstado();
    const tasa = tasaVigente();
    const enPesos = c => c.moneda === 'USD' ? saldos[c.id] * tasa : saldos[c.id];
    const grupo = id => base.cuentas.filter(c => c.grupo === id);
    const tot = arr => r2(arr.reduce((s, c) => s + enPesos(c), 0));
    const bancos = grupo('banco'), usd = grupo('usd'), tarjetas = grupo('tarjeta');

    $('#cuadreStats').innerHTML =
      UI.statTile(UI.fmtDinero(tot(bancos)), 'Efectivo y bancos') +
      UI.statTile(UI.fmtDinero(tot(usd)), 'Dólares en RD$') +
      UI.statTile(UI.fmtDinero(tot(bancos) + tot(usd)), 'Total disponible', 'verde') +
      UI.statTile(UI.fmtDinero(tot(tarjetas)), 'Crédito disponible');

    const filas = arr => arr.map(c => `
      <div class="abono-row cta-row" data-id="${c.id}" style="cursor:pointer" title="Toca para registrar un movimiento">
        <span>${esc(c.nombre)}</span>
        <b>${fmt(saldos[c.id], c.moneda)}${c.moneda === 'USD' ? ` <span class="muted">≈ ${UI.fmtDinero(r2(saldos[c.id] * tasa))}</span>` : ''}</b>
      </div>`).join('');

    $('#cuadreGrupos').innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <button class="btn-gold btn-block" id="btnGasto">💸 Registrar gasto</button>
        <button class="btn-ghost btn-block" id="btnFotoGasto">📸 Foto a gasto</button>
        <button class="btn-ghost btn-block" id="btnArqueo">🔒 Arqueo de caja</button>
      </div>` + `
      <div class="card">
        <h2>🏦 Efectivo, caja y bancos</h2>
        ${filas(bancos)}
        <div class="abono-row"><span><b>Total</b></span><b class="dorado">${UI.fmtDinero(tot(bancos))}</b></div>
      </div>
      <div class="card">
        <h2>💵 Dólares (Shopify, PayPal, Relay)</h2>
        ${filas(usd)}
        <div class="abono-row"><span>💱 Valor del dólar <span class="muted">· en vivo de la Calculadora</span></span><b>${tasa}</b></div>
        <div class="abono-row"><span><b>Total en pesos</b></span><b class="dorado">${UI.fmtDinero(tot(usd))}</b></div>
      </div>
      <div class="card">
        <h2>💳 Tarjetas de crédito (disponible)</h2>
        ${filas(tarjetas)}
        <div class="abono-row"><span><b>Disponible total</b></span><b class="dorado">${UI.fmtDinero(tot(tarjetas))}</b></div>
        <p class="muted" style="margin-top:8px">El pago de la tarjeta se registra como transferencia desde la cuenta principal — toca la cuenta que paga y elige 🔁.</p>
      </div>`;

    const historial = [...movs, ...(base.movsHistoricos || [])]
      .filter(m => UI.enRango(m.fecha, rangoMovs)).slice(0, 30);
    $('#cuadreMovs').innerHTML = UI.chipsRango(rangoMovs) + (historial.map(m => `
      <div class="abono-row">
        <span>${fmtFecha(m.fecha)} · ${esc(m.desc)}</span>
        <b class="${m.signo < 0 ? 'rojo' : 'verde'}">${m.signo < 0 ? '−' : '+'}${fmt(m.monto, m.moneda)}</b>
      </div>`).join('') || '<p class="muted">Sin movimientos en este rango.</p>');
    UI.$$('#cuadreMovs .chip-rango').forEach(b => b.addEventListener('click', () => {
      rangoMovs = b.dataset.rango;
      render();
    }));

    $('#cuadreReportes').innerHTML = `
      <div class="card">
        <h2>📤 Reporte para el contador</h2>
        <div class="row" style="align-items:center">
          <span style="flex:1">🏦 Balances y movimientos</span>
          <button class="btn-ghost btn-sm" data-crep="imp">🖨 Imprimir</button>
          <button class="btn-ghost btn-sm" data-crep="pdf">📄 PDF</button>
          <button class="btn-ghost btn-sm" data-crep="csv">📥 Excel</button>
        </div>
      </div>`;
    UI.$$('#cuadreReportes [data-crep]').forEach(b =>
      b.addEventListener('click', () => reporteCuadre(b.dataset.crep)));

    UI.$$('.cta-row').forEach(el => el.addEventListener('click', () => detalleCuenta(el.dataset.id)));
    $('#btnGasto').addEventListener('click', () => formGasto());
    $('#btnFotoGasto').addEventListener('click', fotoAGasto);
    $('#btnArqueo').addEventListener('click', () => formArqueo());
  }

  /* ── 📸 Foto a gasto: la IA lee la factura y deja el formulario de
     gasto YA LLENO (monto, categoría, nota) — el usuario solo confirma
     la cuenta y guarda. Requiere la clave de IA en Ajustes (se guarda
     SOLO en este dispositivo, nunca se sincroniza ni se sube al repo). */
  const K_IAKEY = 'sscrm_ia_key';

  async function fotoAGasto() {
    const clave = localStorage.getItem(K_IAKEY);
    if (!clave) {
      abrirModal('📸 Foto a gasto', `
        <p class="muted">Para leer facturas con la cámara hace falta una clave de la API de Anthropic
        (la IA que lee la foto). Se configura UNA vez por dispositivo en
        <b>Ajustes → 🤖 Inteligencia artificial</b>. Cada foto cuesta centavos y se cobra
        a tu cuenta de Anthropic (console.anthropic.com).</p>
        <button class="btn-gold btn-block" id="irAjustesIa" style="margin-top:12px">Ir a Ajustes</button>
      `);
      $('#irAjustesIa').addEventListener('click', () => {
        cerrarModal();
        document.querySelector('.nav-btn[data-view="ajustes"]').click();
      });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      abrirModal('📸 Leyendo la factura…',
        '<p class="muted" style="text-align:center;padding:24px 10px">🤖 La IA está leyendo la foto — unos segundos…</p>');
      try {
        const b64 = await comprimirParaIA(file);
        const datos = await leerFacturaIA(b64, clave);
        if (datos.error) throw new Error(datos.error);
        const monto = Number(datos.monto) || 0;
        const nota = [datos.comercio, datos.descripcion,
          datos.fecha ? `factura del ${datos.fecha}` : '',
          datos.moneda === 'USD' ? '(monto en US$ — elige una cuenta en dólares)' : '']
          .filter(Boolean).join(' · ');
        toast(`🤖 Leída${datos.comercio ? ': ' + datos.comercio : ''} — confirma la cuenta y guarda`);
        formGasto(null, {
          categoria: [...CATS_NEGOCIO, CAT_PERSONAL].includes(datos.categoria) ? datos.categoria : undefined,
          nota, monto,
        });
      } catch (e) {
        abrirModal('📸 No se pudo leer', `
          <p class="muted">${esc(String((e && e.message) || e))}</p>
          <p class="muted" style="margin-top:10px">Prueba con una foto más clara (buena luz, factura completa) o registra el gasto a mano con 💸.</p>`);
      }
    };
    input.click();
  }

  /* Achicar la foto antes de mandarla (rápido y barato): máx 1400px, JPEG */
  function comprimirParaIA(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const factor = Math.min(1, 1400 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * factor);
        cv.height = Math.round(img.height * factor);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => rej(new Error('No se pudo abrir la imagen'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function leerFacturaIA(b64, clave) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 2048,
        fallbacks: 'default',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            { type: 'text', text:
`Lee esta foto de una factura o recibo de gasto (República Dominicana) y responde SOLO un objeto JSON, sin texto extra:
{"comercio": "nombre del negocio", "fecha": "YYYY-MM-DD o null si no se ve", "monto": total final a pagar (número), "moneda": "DOP" o "USD", "categoria": "exactamente una de: ${[...CATS_NEGOCIO, CAT_PERSONAL].join(' | ')}", "descripcion": "qué se compró, en pocas palabras"}
Si la imagen no es una factura legible responde {"error": "motivo corto"}.` },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => null);
      const msj = err && err.error && err.error.message;
      throw new Error(resp.status === 401 ? 'La clave de IA no es válida — revísala en Ajustes' : (msj || `La IA respondió ${resp.status}`));
    }
    const data = await resp.json();
    if (data.stop_reason === 'refusal') throw new Error('La IA declinó leer esta imagen');
    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('La IA no devolvió datos legibles');
    return JSON.parse(m[0]);
  }

  /* ── Arqueo de caja: contar el efectivo físico, comparar con el
     sistema y dejar la diferencia registrada con el saldo ajustado ── */
  async function formArqueo() {
    const { base, saldos } = await getEstado();
    const c = base.cuentas.find(x => x.id === 'efectivo');
    if (!c) { toast('No existe la cuenta Efectivo (caja)'); return; }
    const sistema = saldos[c.id];

    abrirModal('🔒 Arqueo de caja', `
      <p class="muted" style="margin-bottom:12px">Cuenta el efectivo físico y compáralo con el sistema — la diferencia queda anotada y el saldo ajustado.</p>
      <div class="abono-row"><span>Efectivo según el sistema</span><b>${fmt(sistema, 'DOP')}</b></div>
      <form id="formArqueo" style="margin-top:10px">
        <div class="row"><div>
          <label>Efectivo contado (RD$) *</label>
          <input name="contado" type="text" inputmode="decimal" required placeholder="0.00" autocomplete="off">
        </div></div>
        <p id="arqueoDif" style="margin:2px 0 10px" class="muted">Escribe lo contado y te muestro la diferencia…</p>
        <div class="row"><div>
          <label>Nota (opcional)</label>
          <input name="nota" placeholder="Ej: se pagó mensajería en efectivo" autocomplete="off">
        </div></div>
        <button type="submit" class="btn-gold btn-block">🔒 Cerrar el día</button>
      </form>
    `);

    const form = $('#formArqueo');
    const pintaDif = () => {
      const v = Number(String(form.contado.value).replace(/,/g, ''));
      if (form.contado.value === '' || Number.isNaN(v)) { $('#arqueoDif').textContent = 'Escribe lo contado y te muestro la diferencia…'; return; }
      const dif = r2(v - sistema);
      $('#arqueoDif').innerHTML = dif === 0 ? '✅ <b class="verde">Cuadre exacto</b>'
        : dif > 0 ? `<b class="verde">Sobrante de ${fmt(dif, 'DOP')}</b> — el saldo subirá`
        : `<b class="rojo">Faltante de ${fmt(-dif, 'DOP')}</b> — el saldo bajará`;
    };
    form.contado.addEventListener('input', pintaDif);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = Number(String(form.contado.value).replace(/,/g, ''));
      if (Number.isNaN(v) || v < 0) { toast('Monto no válido'); return; }
      const dif = r2(v - sistema);
      const nota = form.nota.value.trim();
      const etiqueta = dif === 0 ? 'cuadre exacto'
        : dif > 0 ? `sobrante ${fmt(dif, 'DOP')}` : `faltante ${fmt(-dif, 'DOP')}`;
      await DB.config.upsert({
        id: uidMov(), tipo: 'cuadre-mov', ts: Date.now(), fecha: hoyISO(),
        desc: `🔒 Arqueo de caja — ${etiqueta}${nota ? ' — ' + nota : ''}`,
        cambios: [{ cuenta: 'efectivo', delta: dif }],
        monto: Math.abs(dif), moneda: 'DOP', signo: dif < 0 ? -1 : 1, arqueo: true,
      });
      cerrarModal();
      toast(dif === 0 ? '✅ Caja cuadrada exacta — ¡buen cierre!' : '🔒 Arqueo registrado y saldo ajustado');
      render();
    });
  }

  /* ── Detalle de una cuenta: saldo, acciones y SU historial con saldo
     corrido, filtrable por fecha (Hoy · 7 días · Este mes · Todo) ── */
  async function detalleCuenta(cuentaId, rango = 'mes') {
    const { base, movs, saldos } = await getEstado();
    const c = base.cuentas.find(x => x.id === cuentaId);
    if (!c) return;
    const tasa = tasaVigente();

    // El saldo corrido se calcula sobre TODOS los movimientos (es acumulado);
    // el rango solo decide cuáles filas se muestran
    const propios = movs
      .filter(m => (m.cambios || []).some(cb => cb.cuenta === c.id))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    let corrido = c.saldoInicial || 0;
    const todas = propios.map(m => {
      const delta = (m.cambios || []).filter(cb => cb.cuenta === c.id).reduce((s, cb) => s + cb.delta, 0);
      corrido = r2(corrido + delta);
      return { fecha: m.fecha, desc: m.desc, delta, saldo: corrido };
    }).reverse();
    const filas = todas.filter(f => UI.enRango(f.fecha, rango));
    const historicos = (base.movsHistoricos || [])
      .filter(m => (m.desc || '').includes(c.nombre) && UI.enRango(m.fecha, rango));

    abrirModal(c.nombre, `
      <div class="deuda-banner" style="background:var(--rose-soft);border-color:var(--gold);color:var(--gold-bright)">
        Saldo actual: <b>${fmt(saldos[c.id], c.moneda)}</b>${
        c.moneda === 'USD' ? ` · ≈ ${UI.fmtDinero(r2(saldos[c.id] * tasa))} (a ${tasa})` : ''}
      </div>
      <p class="muted" style="margin-bottom:12px">Saldo inicial: ${fmt(c.saldoInicial || 0, c.moneda)} · ${todas.length} movimiento${todas.length === 1 ? '' : 's'} en total</p>
      <div class="row" style="margin-bottom:8px">
        <button class="btn-gold btn-block" id="dcMov">↔ Movimiento</button>
        <button class="btn-ghost btn-block" id="dcGasto">💸 Gasto</button>
      </div>
      <h3 class="sub-h">Historial de la cuenta</h3>
      ${UI.chipsRango(rango)}
      ${filas.length ? filas.slice(0, 40).map(f => `
        <div class="abono-row" style="align-items:flex-start">
          <span>${fmtFecha(f.fecha)} · ${esc(f.desc)}</span>
          <span style="text-align:right;white-space:nowrap">
            <b class="${f.delta < 0 ? 'rojo' : 'verde'}">${f.delta < 0 ? '−' : '+'}${fmt(Math.abs(f.delta), c.moneda)}</b><br>
            <span class="muted" style="font-size:.78rem">saldo ${fmt(f.saldo, c.moneda)}</span>
          </span>
        </div>`).join('') : '<p class="muted">Sin movimientos en este rango.</p>'}
      ${filas.length > 40 ? `<p class="muted">…y ${filas.length - 40} más (completos en el reporte 📤).</p>` : ''}
      ${historicos.length ? `
        <h3 class="sub-h" style="margin-top:12px">Historial anterior (del cuadre viejo)</h3>
        ${historicos.map(m => `
          <div class="abono-row"><span>${fmtFecha(m.fecha)} · ${esc(m.desc)}</span>
          <b class="${m.signo < 0 ? 'rojo' : 'verde'}">${m.signo < 0 ? '−' : '+'}${fmt(m.monto, m.moneda)}</b></div>`).join('')}` : ''}
    `);
    UI.$$('#modalBody .chip-rango').forEach(b =>
      b.addEventListener('click', () => detalleCuenta(cuentaId, b.dataset.rango)));
    $('#dcMov').addEventListener('click', () => movimiento(c.id));
    $('#dcGasto').addEventListener('click', () => formGasto(c.id));
  }

  /* ── Registrar gasto: negocio o personal, con cualquier cuenta ── */
  /* "Materiales" es INVERSIÓN EN INVENTARIO, no gasto operativo: el
     material ya resta en la ganancia vía el costo de cada pieza vendida.
     Se registra aquí para que la cuenta baje, pero NO resta en la neta. */
  const CATS_NEGOCIO = ['Materiales (inventario — no resta en ganancia)', 'Taller', 'Envíos', 'Publicidad',
    'Local (renta, luz, agua)', 'Comisiones y fees', 'Otros negocio'];
  const CAT_PERSONAL = 'Personal / familia';

  /* pre: {categoria, nota} para llegar con el gasto ya perfilado
     (p. ej. el shipping de un lote de confecciones → Envíos) */
  async function formGasto(cuentaPre, pre = {}) {
    const { base } = await getEstado();
    abrirModal('💸 Registrar gasto', `
      <form id="formGasto">
        <div class="row">
          <div><label>¿De qué se trata?</label>
            <select name="ambito">
              <option value="negocio">🏪 Negocio</option>
              <option value="personal">🏠 Personal</option>
            </select></div>
          <div id="gCatRow"><label>Categoría</label>
            <select name="categoria">${CATS_NEGOCIO.map(c => `<option ${c === pre.categoria ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div><label>Pagado con</label>
            <select name="cuenta">
              ${base.cuentas.map(c => `<option value="${c.id}" ${c.id === cuentaPre ? 'selected' : ''}>${esc(c.nombre)} (${c.moneda === 'USD' ? 'US$' : 'RD$'})</option>`).join('')}
            </select></div>
          <div><label>Monto <span id="gMon">(RD$)</span></label>
            <input name="monto" type="text" inputmode="decimal" required placeholder="0.00" autocomplete="off"></div>
        </div>
        <div class="row"><div>
          <label>Descripción / nota</label>
          <input name="nota" value="${esc(pre.nota || '')}" placeholder="Ej: onza de plata, renta agosto, supermercado…" autocomplete="off">
        </div></div>
        <button type="submit" class="btn-gold btn-block">Registrar gasto</button>
      </form>
    `);
    const form = $('#formGasto');
    if (pre.monto > 0) form.monto.value = pre.monto;
    form.ambito.addEventListener('change', () => {
      $('#gCatRow').hidden = form.ambito.value === 'personal';
    });
    form.cuenta.addEventListener('change', () => {
      const c = base.cuentas.find(x => x.id === form.cuenta.value);
      $('#gMon').textContent = c && c.moneda === 'USD' ? '(US$)' : '(RD$)';
    });
    form.cuenta.dispatchEvent(new Event('change'));   // label correcto si vino preseleccionada
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const monto = Number(String(form.monto.value).replace(/,/g, ''));
      if (Number.isNaN(monto) || !(monto > 0)) { toast('Monto no válido'); return; }
      const c = base.cuentas.find(x => x.id === form.cuenta.value);
      const ambito = form.ambito.value;
      const categoria = ambito === 'personal' ? CAT_PERSONAL : form.categoria.value;
      const nota = form.nota.value.trim();
      await DB.config.upsert({
        id: uidMov(), tipo: 'cuadre-mov', ts: Date.now(), fecha: hoyISO(),
        desc: `Gasto ${ambito === 'personal' ? 'personal' : 'de negocio'} · ${categoria}${nota ? ' — ' + nota : ''} · ${c.nombre}`,
        cambios: [{ cuenta: c.id, delta: -monto }],
        monto: r2(monto), moneda: c.moneda, signo: -1,
        gasto: { ambito, categoria, cuentaNombre: c.nombre },
      });
      toast(`💸 Gasto registrado — ${c.nombre} bajó ${fmt(monto, c.moneda)}`);
      render();
      if (cuentaPre) detalleCuenta(cuentaPre); else cerrarModal();
    });
  }

  /* ── Reporte del cuadre: saldos + resumen + movimientos ── */
  async function reporteCuadre(salida) {
    const { base, movs, saldos } = await getEstado();
    const tasa = tasaVigente();
    const n2 = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const GRUPOS = { banco: 'Bancos y caja', usd: 'Dólares', tarjeta: 'Tarjeta (disponible)' };
    const enPesos = c => c.moneda === 'USD' ? r2(saldos[c.id] * tasa) : saldos[c.id];
    const tot = g => r2(base.cuentas.filter(c => c.grupo === g).reduce((s, c) => s + enPesos(c), 0));

    const secSaldos = {
      titulo: 'Saldos por cuenta',
      columnas: [
        { t: 'Cuenta', w: 190 }, { t: 'Grupo', w: 110 }, { t: 'Moneda', w: 50 },
        { t: 'Saldo', w: 90, a: 'right' }, { t: 'En RD$', w: 90, a: 'right' },
      ],
      filas: base.cuentas.map(c => [c.nombre, GRUPOS[c.grupo] || c.grupo,
        c.moneda === 'USD' ? 'US$' : 'RD$', n2(saldos[c.id]), n2(enPesos(c))]),
    };
    const secResumen = {
      titulo: 'Resumen',
      columnas: [{ t: 'Concepto', w: 300 }, { t: 'RD$', w: 120, a: 'right' }],
      filas: [
        ['Efectivo, caja y bancos', n2(tot('banco'))],
        [`Dólares en pesos (tasa ${tasa})`, n2(tot('usd'))],
        ['TOTAL DISPONIBLE', n2(r2(tot('banco') + tot('usd')))],
        ['Crédito disponible en tarjetas', n2(tot('tarjeta'))],
      ],
    };
    const historial = [...movs, ...(base.movsHistoricos || [])];
    const secMovs = {
      titulo: `Movimientos registrados (${historial.length})`,
      columnas: [
        { t: 'Fecha', w: 62 }, { t: 'Descripción', w: 300 },
        { t: 'Monto', w: 80, a: 'right' }, { t: 'Mon.', w: 36 },
      ],
      filas: historial.map(m => [UI.fmtFecha(m.fecha), m.desc,
        (m.signo < 0 ? '-' : '+') + n2(m.monto), m.moneda === 'USD' ? 'US$' : 'RD$']),
    };
    const hoyTxt = UI.fmtFecha(hoyISO());
    const secciones = [secSaldos, secResumen, secMovs];
    const archivo = `silvershine-cuadre-${hoyISO()}`;
    if (salida === 'csv') Reportes.descargarCSV(archivo + '.csv', secciones);
    else if (salida === 'pdf') await Reportes.pdf(archivo + '.pdf', 'Cuadre de caja y bancos', `Saldos al ${hoyTxt}`, secciones);
    else await Reportes.imprimir('Cuadre de caja y bancos', `Saldos al ${hoyTxt}`, secciones);
  }

  /* ── Movimiento sobre una cuenta ── */
  async function movimiento(cuentaId) {
    const { base, saldos } = await getEstado();
    const c = base.cuentas.find(x => x.id === cuentaId);
    if (!c) return;
    const saldo = saldos[c.id];

    abrirModal(`${c.nombre} — ${fmt(saldo, c.moneda)}`, `
      <form id="formMov">
        <div class="row">
          <div><label>Operación</label>
            <select name="tipo">
              <option value="entrada">➕ Entrada — depósito o cobro</option>
              <option value="salida">➖ Salida — gasto o retiro</option>
              <option value="transfer">🔁 Transferir a otra cuenta</option>
              <option value="fijar">✏️ Fijar el saldo exacto</option>
            </select></div>
          <div><label>Monto (${c.moneda === 'USD' ? 'US$' : 'RD$'})</label>
            <input name="monto" type="text" inputmode="decimal" required placeholder="0.00" autocomplete="off"></div>
        </div>
        <div class="row" id="movDestinoRow" hidden><div>
          <label>Cuenta destino</label>
          <select name="destino">
            ${base.cuentas.filter(x => x.id !== c.id).map(x =>
              `<option value="${x.id}">${esc(x.nombre)} (${x.moneda === 'USD' ? 'US$' : 'RD$'})</option>`).join('')}
          </select>
        </div></div>
        <div class="row"><div>
          <label>Nota (opcional)</label>
          <input name="nota" placeholder="Ej: depósito de Adan, pago tarjeta, retiro caja…" autocomplete="off">
        </div></div>
        <button type="submit" class="btn-gold btn-block">Aplicar al cuadre</button>
        <button type="button" class="btn-ghost btn-block" id="movVolver" style="margin-top:8px">← Volver a la cuenta</button>
      </form>
    `);
    $('#movVolver').addEventListener('click', () => detalleCuenta(cuentaId));

    const form = $('#formMov');
    form.tipo.addEventListener('change', () => { $('#movDestinoRow').hidden = form.tipo.value !== 'transfer'; });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const monto = Number(String(form.monto.value).replace(/,/g, ''));
      if (Number.isNaN(monto) || monto < 0) { toast('Monto no válido'); return; }
      const nota = form.nota.value.trim();
      const conNota = b => nota ? `${b} — ${nota}` : b;
      const tipo = form.tipo.value;

      if (tipo === 'entrada') {
        await nuevoMov(conNota(`Entrada · ${c.nombre}`), [{ cuenta: c.id, delta: monto }], monto, c.moneda, 1);
      } else if (tipo === 'salida') {
        await nuevoMov(conNota(`Salida · ${c.nombre}`), [{ cuenta: c.id, delta: -monto }], monto, c.moneda, -1);
      } else if (tipo === 'fijar') {
        const dif = r2(monto - saldo);
        await nuevoMov(conNota(`Saldo fijado · ${c.nombre}`), [{ cuenta: c.id, delta: dif }],
          Math.abs(dif), c.moneda, dif >= 0 ? 1 : -1);
      } else {
        const d = base.cuentas.find(x => x.id === form.destino.value);
        if (!d) { toast('Elige la cuenta destino'); return; }
        const tasa = tasaVigente();
        const recibido = c.moneda === d.moneda ? monto
          : r2(c.moneda === 'USD' ? monto * tasa : monto / tasa);
        await nuevoMov(conNota(`${c.nombre} → ${d.nombre}${c.moneda !== d.moneda ? ` (a ${tasa})` : ''}`),
          [{ cuenta: c.id, delta: -monto }, { cuenta: d.id, delta: recibido }], monto, c.moneda, -1);
      }

      toast('✓ Cuadre actualizado');
      render();
      detalleCuenta(cuentaId);   // de vuelta al detalle con el saldo fresco
    });
  }

  /* ── Para otros módulos ── */
  async function listaCuentas() {
    const { base } = await getEstado();
    return base.cuentas.map(c => ({ id: c.id, nombre: c.nombre, moneda: c.moneda }));
  }

  /* Registrar un cobro en el cuadre (lo llama el abono de facturas).
     Si la moneda del abono difiere de la cuenta, convierte con la tasa. */
  async function registrarCobro(cuentaId, monto, monedaAbono, desc) {
    if (!cuentaId || !(monto > 0)) return;
    const { base } = await getEstado();
    const c = base.cuentas.find(x => x.id === cuentaId);
    if (!c) return;
    const mon = monedaAbono || 'DOP';
    const tasa = tasaVigente();
    const recibido = c.moneda === mon ? monto
      : r2(mon === 'USD' ? monto * tasa : monto / tasa);
    await nuevoMov(desc, [{ cuenta: c.id, delta: recibido }], recibido, c.moneda, 1);
    toast(`🏦 ${c.nombre}: +${fmt(recibido, c.moneda)}`);
  }

  function init() {}

  return { init, render, listaCuentas, registrarCobro, formGasto };
})();
