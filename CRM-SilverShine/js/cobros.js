/* ═══════════════════════════════════════════════════════════
   cobros.js — Módulo de cobros: facturas pendientes por
   urgencia, plan de próximo cobro y recordatorios.
   ═══════════════════════════════════════════════════════════ */
const Cobros = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  const hoyISO = () => new Date().toISOString().slice(0, 10);

  /* Urgencia de un cobro:
     - Con próximo cobro programado: vencido si la fecha ya pasó.
     - Sin programar: vencido si la factura tiene más de 30 días. */
  function clasificar(f) {
    const hoy = hoyISO();
    const en7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    if (f.proxCobro && f.proxCobro.fecha) {
      if (f.proxCobro.fecha < hoy) return 'vencido';
      if (f.proxCobro.fecha <= en7) return 'proximo';
      return 'despues';
    }
    const dias = Math.floor((Date.now() - new Date(f.fecha + 'T00:00').getTime()) / 864e5);
    if (dias > 30) return 'vencido';
    if (dias > 7) return 'proximo';
    return 'despues';
  }

  async function pendientes() {
    return (await DB.facturas.list()).filter(f => f.estado === 'pendiente' && f.saldo > 0);
  }

  /* Mensaje de recordatorio (compartido por el detalle y por Mi Día) */
  const mensajeRecordatorio = (f, emp) => {
    const t = f.moneda || 'DOP';
    return `Hola ${f.clienteNombre}, le saluda *${UI.quienSaluda(emp)}* ✨\n\n` +
      `Le recordamos con cariño su balance pendiente:\n` +
      `🧾 Factura ${f.orden ? '#' + f.orden : (f.numero || '')}\n` +
      `🔴 Pendiente: *${fmtMoneda(f.saldo, t)}*` +
      (f.proxCobro && f.proxCobro.monto ? `\n📅 ${f.planPago ? 'Su cuota EasyPay' : 'Próximo abono acordado'}: ${fmtMoneda(f.proxCobro.monto, t)}${f.proxCobro.fecha ? ' para el ' + fmtFecha(f.proxCobro.fecha) : ''}` : '') +
      (emp.cuentas ? `\n\n*Cuentas para su pago:*\n\n${emp.cuentas}` : '') +
      `\n\nTambién puede pagar con tarjeta o EasyPay en la tienda. ¡Gracias!\n💎 ${emp.nombre} · ${emp.web}`;
  };

  /* Recordatorio en 1 toque desde Mi Día: envía, lo anota y sale */
  async function recordatorioRapido(facturaId) {
    const f = await DB.facturas.get(facturaId);
    if (!f) return false;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    if (!UI.tieneWhatsApp(cliente)) { detalle(facturaId); return false; }
    const emp = await UI.getEmpresa();
    UI.abrirWhatsApp(cliente, mensajeRecordatorio(f, emp));
    f.ultimoRecordatorio = hoyISO();
    await DB.facturas.upsert(f);
    toast('💬 Recordatorio enviado y anotado');
    return true;
  }

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaCobros');
    const lista = await pendientes();

    const total = lista.reduce((s, f) => s + f.saldo, 0);
    const easy = lista.filter(f => f.planPago);
    const resto = lista.filter(f => !f.planPago);

    // Métricas globales (incluyen EasyPay)
    const vencidosTotal = lista.filter(f => clasificar(f) === 'vencido').length;
    const proximosTotal = lista.filter(f => clasificar(f) === 'proximo').length;

    // Secciones generales solo con las facturas sin plan
    const grupos = { vencido: [], proximo: [], despues: [] };
    for (const f of resto) grupos[clasificar(f)].push(f);
    const fechaDe = f => (f.proxCobro && f.proxCobro.fecha) || f.fecha || '';
    const ordenar = arr => arr.sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)));
    Object.values(grupos).forEach(ordenar);

    // EasyPay: vencidos primero, luego por fecha de próxima cuota
    easy.sort((a, b) => {
      const va = clasificar(a) === 'vencido' ? 0 : 1;
      const vb = clasificar(b) === 'vencido' ? 0 : 1;
      return va - vb || fechaDe(a).localeCompare(fechaDe(b));
    });
    const easySaldo = easy.reduce((s, f) => s + f.saldo, 0);

    $('#cobrosResumen').innerHTML =
      UI.statTile(vencidosTotal, 'Vencidos', vencidosTotal > 0 ? 'rojo' : '') +
      UI.statTile(proximosTotal, 'Próximos 7 días') +
      UI.statTile(easy.length, 'Planes EasyPay') +
      UI.statTile(UI.fmtDinero(total), 'Total en la calle');

    if (!lista.length) {
      cont.innerHTML = '<div class="empty"><span>🎉</span>No hay cobros pendientes. Todo al día.</div>';
      return;
    }

    const fila = (f, cls, extraSub) => `
      <div class="item cobro" data-id="${f.id}">
        <div class="item-info">
          <div class="item-name">${esc(f.clienteNombre)}</div>
          <div class="item-sub">${extraSub}</div>
        </div>
        <b class="${cls === 'rojo' ? 'rojo' : ''}">${fmtMoneda(f.saldo, f.moneda)}</b>
      </div>`;

    const seccion = (titulo, arr, cls) => !arr.length ? '' : `
      <h3 class="sub-h ${cls}">${titulo} (${arr.length})</h3>
      ${arr.map(f => fila(f, cls,
        `${esc(f.numero || 's/n')} · factura del ${fmtFecha(f.fecha)}${
          f.proxCobro && f.proxCobro.fecha ? ` · <b>cobrar ${fmtFecha(f.proxCobro.fecha)}${
            f.proxCobro.monto ? ' (' + fmtMoneda(f.proxCobro.monto, f.moneda) + ')' : ''}</b>` : ''}`)).join('')}`;

    const seccionEasy = !easy.length ? '' : `
      <h3 class="sub-h">📅 Planes EasyPay (${easy.length}) · ${fmtMoneda(easySaldo)} por cobrar</h3>
      ${easy.map(f => {
        const cuotas = f.planPago.cuotas && f.planPago.cuotas.length ? Facturas.cuotasConEstado(f) : [];
        const cubiertas = cuotas.filter(c => c.cubierta).length;
        const vencido = clasificar(f) === 'vencido';
        const progreso = cuotas.length
          ? `Cuota ${Math.min(cubiertas + 1, cuotas.length)}/${cuotas.length}`
          : '🗓 cuotas por programar';
        return fila(f, vencido ? 'rojo' : '',
          `${vencido ? '🔴' : '🟢'} ${progreso}${
            f.proxCobro && f.proxCobro.fecha ? ` · <b>cobrar ${fmtFecha(f.proxCobro.fecha)} (${fmtMoneda(f.proxCobro.monto, f.moneda)})</b>` : ''} · ${esc(f.numero || 's/n')}`);
      }).join('')}`;

    cont.innerHTML =
      seccionEasy +
      seccion('🔴 Vencidos', grupos.vencido, 'rojo') +
      seccion('🟡 Próximos 7 días', grupos.proximo, '') +
      seccion('⚪ Más adelante', grupos.despues, '');

    cont.querySelectorAll('.cobro').forEach(el =>
      el.addEventListener('click', () => detalle(el.dataset.id)));
  }

  /* ── Detalle de cobro ── */
  async function detalle(id) {
    const f = await DB.facturas.get(id);
    if (!f) return;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const t = f.moneda || 'DOP';

    abrirModal(`Cobro — ${f.clienteNombre}`, `
      <div class="deuda-banner">Debe <b>${fmtMoneda(f.saldo, t)}</b> de ${fmtMoneda(f.total, t)} · ${esc(f.numero || 's/n')}</div>
      <p class="muted" style="margin-bottom:12px">Factura del ${fmtFecha(f.fecha)}.
        ${f.planPago ? '📅 <b>Plan EasyPay</b> (' + esc(f.planPago.frecuencia) + '). ' : ''}
        ${f.proxCobro && f.proxCobro.fecha ? `Próximo cobro: <b>${fmtFecha(f.proxCobro.fecha)}</b>${f.proxCobro.monto ? ' por ' + fmtMoneda(f.proxCobro.monto, t) : ''}.` : 'Sin próximo cobro programado.'}</p>

      <button class="btn-gold btn-block" id="coAbonar">💵 Registrar abono</button>
      <div class="row" style="margin-top:10px">
        ${UI.tieneWhatsApp(cliente) ? `<button class="btn-ghost btn-block" id="coWhatsApp">💬 Recordar por WhatsApp</button>` : ''}
        ${cliente && cliente.correo ? `<button class="btn-ghost btn-block" id="coCorreo">✉️ Recordar por correo</button>` : ''}
      </div>

      <h3 class="sub-h" style="margin-top:16px">📅 Programar próximo cobro</h3>
      <form id="formProx">
        <div class="row">
          <div><label>Fecha</label><input name="fecha" type="date" required value="${(f.proxCobro && f.proxCobro.fecha) || ''}"></div>
          <div><label>Monto esperado (opcional)</label><input name="monto" type="number" step="0.01" min="0" value="${(f.proxCobro && f.proxCobro.monto) || ''}"></div>
        </div>
        <div class="row">
          <button type="submit" class="btn-ghost btn-block">Guardar programación</button>
          ${f.proxCobro ? '<button type="button" class="btn-danger btn-block" id="coQuitarProx">Quitar</button>' : ''}
        </div>
      </form>
      <button class="btn-ghost btn-block" id="coVerFactura" style="margin-top:6px">Ver factura completa</button>
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#coAbonar', () => Facturas.formAbono(f));
    on('#coVerFactura', () => Facturas.detalle(f.id));

    on('#coWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp(cliente, mensajeRecordatorio(f, emp));
      f.ultimoRecordatorio = hoyISO();          // Mi Día lo marca como despachado
      await DB.facturas.upsert(f);
    });
    on('#coCorreo', async () => {
      const emp = await UI.getEmpresa();
      location.href = `mailto:${cliente.correo}?subject=${encodeURIComponent(`Recordatorio de balance — ${emp.nombre}`)}&body=${encodeURIComponent(mensajeRecordatorio(f, emp).replace(/\*/g, ''))}`;
      f.ultimoRecordatorio = hoyISO();
      await DB.facturas.upsert(f);
    });

    $('#formProx').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      f.proxCobro = { fecha: fd.get('fecha'), monto: Number(fd.get('monto')) || null };
      await DB.facturas.upsert(f);
      cerrarModal(); toast('Próximo cobro programado'); render();
    });
    on('#coQuitarProx', async () => {
      delete f.proxCobro;
      await DB.facturas.upsert(f);
      cerrarModal(); toast('Programación eliminada'); render();
    });
  }

  return { render, detalle, clasificar, pendientes, recordatorioRapido };
})();
