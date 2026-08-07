/* ═══════════════════════════════════════════════════════════
   caja.js — Cuadre de caja y bancos: el efectivo real del
   negocio, copiado del Excel del usuario. Cada cuenta se
   mantiene al día con entradas, salidas, transferencias
   (p. ej. pagar la tarjeta desde Popular) y ajustes.
   Vive en config ('cuadre') → sincroniza entre dispositivos.
   ═══════════════════════════════════════════════════════════ */
const Caja = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const r2 = v => Math.round(v * 100) / 100;

  /* Cuentas iniciales = el Excel del usuario (ago 2026).
     EffiCommerce quedó fuera a propósito (no lo usa). */
  const DEFECTO = {
    id: 'cuadre',
    tasa: 60,
    movimientos: [],
    cuentas: [
      { id: 'efectivo',    nombre: 'Efectivo (caja)',              grupo: 'banco',   moneda: 'DOP', saldo: 0 },
      { id: 'mio',         nombre: 'Mio (transitoria tarjetas)',   grupo: 'banco',   moneda: 'DOP', saldo: 0 },
      { id: 'banreservas', nombre: 'Banreservas',                  grupo: 'banco',   moneda: 'DOP', saldo: 92499.36 },
      { id: 'bhd',         nombre: 'BHD',                          grupo: 'banco',   moneda: 'DOP', saldo: 8152.80 },
      { id: 'popular',     nombre: 'Popular',                      grupo: 'banco',   moneda: 'DOP', saldo: 81668.87 },
      { id: 'relay',       nombre: 'Relay',                        grupo: 'usd',     moneda: 'USD', saldo: 119.09 },
      { id: 'shopify',     nombre: 'Shopify Balance',              grupo: 'usd',     moneda: 'USD', saldo: 319.63 },
      { id: 'paypal',      nombre: 'PayPal',                       grupo: 'usd',     moneda: 'USD', saldo: 0 },
      { id: 'tc-dop',      nombre: 'Tarjeta de crédito (RD$)',     grupo: 'tarjeta', moneda: 'DOP', saldo: 65650.42 },
      { id: 'tc-usd',      nombre: 'Tarjeta de crédito (US$)',     grupo: 'tarjeta', moneda: 'USD', saldo: 372.03 },
    ],
  };

  async function getCuadre() {
    const g = await DB.config.get('cuadre');
    if (!g) return JSON.parse(JSON.stringify(DEFECTO));
    return { ...g, tasa: g.tasa || DEFECTO.tasa, cuentas: g.cuentas || DEFECTO.cuentas.map(c => ({ ...c })), movimientos: g.movimientos || [] };
  }

  /* Tasa del dólar EN VIVO desde la Calculadora (que la trae de internet);
     lo guardado en el cuadre queda solo como respaldo si aún no cargó. */
  function tasaVigente(q) {
    const viva = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    return viva > 0 ? viva : (q.tasa || 60);
  }

  const fmt = (m, mon) => UI.fmtMoneda(m, mon);
  const enPesos = (c, tasa) => c.moneda === 'USD' ? c.saldo * tasa : c.saldo;

  /* ── Panel ── */
  async function render() {
    const q = await getCuadre();
    const tasa = tasaVigente(q);
    if (tasa !== q.tasa) { q.tasa = tasa; await DB.config.upsert(q); }   // respaldo fresco para cuando no haya internet
    const grupo = id => q.cuentas.filter(c => c.grupo === id);
    const tot = arr => r2(arr.reduce((s, c) => s + enPesos(c, tasa), 0));
    const bancos = grupo('banco'), usd = grupo('usd'), tarjetas = grupo('tarjeta');

    $('#cuadreStats').innerHTML =
      UI.statTile(UI.fmtDinero(tot(bancos)), 'Efectivo y bancos') +
      UI.statTile(UI.fmtDinero(tot(usd)), 'Dólares en RD$') +
      UI.statTile(UI.fmtDinero(tot(bancos) + tot(usd)), 'Total disponible', 'verde') +
      UI.statTile(UI.fmtDinero(tot(tarjetas)), 'Crédito disponible');

    const filas = arr => arr.map(c => `
      <div class="abono-row cta-row" data-id="${c.id}" style="cursor:pointer" title="Toca para registrar un movimiento">
        <span>${esc(c.nombre)}</span>
        <b>${fmt(c.saldo, c.moneda)}${c.moneda === 'USD' ? ` <span class="muted">≈ ${UI.fmtDinero(r2(c.saldo * tasa))}</span>` : ''}</b>
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

    $('#cuadreMovs').innerHTML = q.movimientos.slice(0, 15).map(m => `
      <div class="abono-row">
        <span>${fmtFecha(m.fecha)} · ${esc(m.desc)}</span>
        <b class="${m.signo < 0 ? 'rojo' : 'verde'}">${m.signo < 0 ? '−' : '+'}${fmt(m.monto, m.moneda)}</b>
      </div>`).join('') || '<p class="muted">Sin movimientos todavía — toca cualquier cuenta para registrar el primero.</p>';

    UI.$$('.cta-row').forEach(el => el.addEventListener('click', () => movimiento(el.dataset.id)));
  }

  /* ── Movimiento sobre una cuenta ── */
  async function movimiento(cuentaId) {
    const q = await getCuadre();
    const c = q.cuentas.find(x => x.id === cuentaId);
    if (!c) return;

    abrirModal(`${c.nombre} — ${fmt(c.saldo, c.moneda)}`, `
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
            ${q.cuentas.filter(x => x.id !== c.id).map(x =>
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
      const conNota = base => nota ? `${base} — ${nota}` : base;
      const tipo = form.tipo.value;
      const nuevos = [];
      const anotar = (desc, m, moneda, signo) => nuevos.push({ fecha: hoyISO(), desc, monto: r2(m), moneda, signo });

      if (tipo === 'entrada') {
        c.saldo = r2(c.saldo + monto);
        anotar(conNota(`Entrada · ${c.nombre}`), monto, c.moneda, 1);
      } else if (tipo === 'salida') {
        c.saldo = r2(c.saldo - monto);
        anotar(conNota(`Salida · ${c.nombre}`), monto, c.moneda, -1);
      } else if (tipo === 'fijar') {
        const dif = r2(monto - c.saldo);
        c.saldo = r2(monto);
        anotar(conNota(`Saldo fijado · ${c.nombre}`), Math.abs(dif), c.moneda, dif >= 0 ? 1 : -1);
      } else {
        const d = q.cuentas.find(x => x.id === form.destino.value);
        if (!d) { toast('Elige la cuenta destino'); return; }
        // Entre monedas distintas se convierte con la tasa en vivo
        const tasa = tasaVigente(q);
        const recibido = c.moneda === d.moneda ? monto
          : r2(c.moneda === 'USD' ? monto * tasa : monto / tasa);
        c.saldo = r2(c.saldo - monto);
        d.saldo = r2(d.saldo + recibido);
        anotar(conNota(`${c.nombre} → ${d.nombre}${c.moneda !== d.moneda ? ` (a ${tasa})` : ''}`), monto, c.moneda, -1);
      }

      q.movimientos = [...nuevos, ...q.movimientos].slice(0, 200);
      await DB.config.upsert(q);
      cerrarModal();
      toast('✓ Cuadre actualizado');
      render();
    });
  }

  /* ── Para otros módulos ── */
  async function listaCuentas() {
    const q = await getCuadre();
    return q.cuentas.map(c => ({ id: c.id, nombre: c.nombre, moneda: c.moneda }));
  }

  /* Registrar un cobro en el cuadre (lo llama el abono de facturas).
     Si la moneda del abono difiere de la cuenta, convierte con la tasa. */
  async function registrarCobro(cuentaId, monto, monedaAbono, desc) {
    if (!cuentaId || !(monto > 0)) return;
    const q = await getCuadre();
    const c = q.cuentas.find(x => x.id === cuentaId);
    if (!c) return;
    const mon = monedaAbono || 'DOP';
    const tasa = tasaVigente(q);
    const recibido = c.moneda === mon ? monto
      : r2(mon === 'USD' ? monto * tasa : monto / tasa);
    c.saldo = r2(c.saldo + recibido);
    q.movimientos = [{ fecha: hoyISO(), desc, monto: r2(recibido), moneda: c.moneda, signo: 1 }, ...q.movimientos].slice(0, 200);
    await DB.config.upsert(q);
    toast(`🏦 ${c.nombre}: +${fmt(recibido, c.moneda)}`);
  }

  function init() {}

  return { init, render, listaCuentas, registrarCobro };
})();
