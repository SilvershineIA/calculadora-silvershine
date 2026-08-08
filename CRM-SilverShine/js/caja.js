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

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const r2 = v => Math.round(v * 100) / 100;

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

    const historial = [...movs, ...(base.movsHistoricos || [])].slice(0, 15);
    $('#cuadreMovs').innerHTML = historial.map(m => `
      <div class="abono-row">
        <span>${fmtFecha(m.fecha)} · ${esc(m.desc)}</span>
        <b class="${m.signo < 0 ? 'rojo' : 'verde'}">${m.signo < 0 ? '−' : '+'}${fmt(m.monto, m.moneda)}</b>
      </div>`).join('') || '<p class="muted">Sin movimientos todavía — toca cualquier cuenta para registrar el primero.</p>';

    UI.$$('.cta-row').forEach(el => el.addEventListener('click', () => movimiento(el.dataset.id)));
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
      </form>
    `);

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

      cerrarModal();
      toast('✓ Cuadre actualizado');
      render();
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

  return { init, render, listaCuentas, registrarCobro };
})();
