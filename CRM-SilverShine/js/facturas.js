/* ═══════════════════════════════════════════════════════════
   facturas.js — Módulo de facturación: lista, detalle, abonos,
   crear/editar, imprimir y enviar.
   ═══════════════════════════════════════════════════════════ */
const Facturas = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta', 'EasyPay'];
  const ITBIS = 0.18;
  let filtro = '', filtroEstado = '';

  /* ── Utilidades ── */
  const badge = f => {
    const cls = { pendiente: 'b-pend', pagada: 'b-pag', anulada: 'b-anu' }[f.estado] || 'b-pend';
    const txt = f.estado === 'pendiente' && f.saldo < f.total ? 'abonada' : f.estado;
    return `<span class="badge ${cls}">${txt}</span>`;
  };

  async function siguienteNumero() {
    const lista = await DB.facturas.list();
    let max = 0;
    for (const f of lista) {
      const m = /^B02(\d+)$/.exec(f.numero || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return 'B02' + String(max + 1).padStart(8, '0');
  }

  /* Número de orden estilo Shopify (#1825…), continúa la secuencia de la tienda */
  async function siguienteOrden() {
    const lista = await DB.facturas.list();
    let max = 1824;                       // última orden de Shopify antes del CRM
    for (const f of lista) max = Math.max(max, Number(f.orden) || 0);
    return max + 1;
  }

  const rotulo = f => f.orden ? `#${f.orden}` : (f.numero || 's/n');
  const FEE_DESC = 'Tarifa administrativa EasyPay';

  /* ── Plan EasyPay: cuotas programadas ── */
  function generarCuotas(total, inicial, n, frecuencia, primerFecha) {
    const resto = Math.round((total - inicial) * 100) / 100;
    const base = Math.floor(resto / n * 100) / 100;
    const cuotas = [];
    const inicio = new Date(primerFecha + 'T00:00:00');
    const dia = inicio.getDate();
    let acum = 0;
    for (let i = 0; i < n; i++) {
      let fecha;
      if (frecuencia === 'semanal') fecha = new Date(inicio.getTime() + i * 7 * 864e5);
      else if (frecuencia === 'quincenal') fecha = new Date(inicio.getTime() + i * 15 * 864e5);
      else {
        // mensual conservando el día (sin desborde: 31 ene + 1 mes = fin de feb)
        fecha = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
        const ultimo = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).getDate();
        fecha.setDate(Math.min(dia, ultimo));
      }
      const monto = i === n - 1 ? Math.round((resto - acum) * 100) / 100 : base;
      acum = Math.round((acum + monto) * 100) / 100;
      cuotas.push({ fecha: UI.fechaISO(fecha), monto });
    }
    return cuotas;
  }

  /* Poner proxCobro en la siguiente cuota no cubierta (según lo abonado) */
  function actualizarProxCobro(f) {
    if (!f.planPago || !f.planPago.cuotas || !f.planPago.cuotas.length) return;   // plan sin cuotas: se programa a mano
    const pagado = Math.round((f.total - f.saldo) * 100) / 100;
    let acum = Number(f.planPago.inicial) || 0;
    for (const c of f.planPago.cuotas) {
      acum = Math.round((acum + c.monto) * 100) / 100;
      if (acum > pagado + 0.005) {
        f.proxCobro = { fecha: c.fecha, monto: Math.round((acum - pagado) * 100) / 100 };
        return;
      }
    }
    delete f.proxCobro;
  }

  /* Estado visual de cada cuota del plan */
  function cuotasConEstado(f) {
    const hoy = UI.fechaISO();
    const pagado = Math.round((f.total - f.saldo) * 100) / 100;
    let acum = Number(f.planPago.inicial) || 0;
    return f.planPago.cuotas.map((c, i) => {
      acum = Math.round((acum + c.monto) * 100) / 100;
      const cubierta = acum <= pagado + 0.005;
      return { ...c, num: i + 1, cubierta, vencida: !cubierta && c.fecha < hoy };
    });
  }

  const totalDe = (lineas, conItbis) => {
    const sub = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
    const imp = conItbis ? sub * ITBIS : 0;
    return { sub, imp, total: sub + imp };
  };

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaFacturas');
    let lista = await DB.facturas.list();

    // Totales de la vista
    const pend = lista.filter(f => f.estado === 'pendiente' && f.saldo > 0);
    const porCobrar = pend.reduce((s, f) => s + f.saldo, 0);
    $('#factResumen').innerHTML =
      UI.statTile(UI.fmtDinero(porCobrar), 'Por cobrar', porCobrar > 0 ? 'rojo' : '') +
      UI.statTile(pend.length, 'Facturas pendientes');

    if (filtroEstado) lista = lista.filter(f => f.estado === filtroEstado);
    if (filtro) {
      const f = filtro.toLowerCase();
      lista = lista.filter(x =>
        (x.numero || '').toLowerCase().includes(f) ||
        (x.clienteNombre || '').toLowerCase().includes(f));
    }
    lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const vista = lista.slice(0, 150);

    if (!lista.length) {
      cont.innerHTML = `<div class="empty"><span>🧾</span>${
        filtro || filtroEstado ? 'Ninguna factura coincide.' : 'No hay facturas todavía.'
      }</div>`;
      return;
    }

    cont.innerHTML = vista.map(f => `
      <div class="item" data-id="${f.id}">
        <div class="item-info">
          <div class="item-name">${esc(f.clienteNombre)} ${badge(f)}</div>
          <div class="item-sub">${f.orden ? '#' + f.orden + ' · ' : ''}${esc(f.numero || 's/n')} · ${fmtFecha(f.fecha)} · ${fmtMoneda(f.total, f.moneda)}${
            f.estado === 'pendiente' && f.saldo > 0 && f.saldo < f.total
              ? ` · <b class="rojo">debe ${fmtMoneda(f.saldo, f.moneda)}</b>` : ''}</div>
        </div>
        <span class="item-arrow">›</span>
      </div>`).join('') +
      (lista.length > vista.length ? `<p class="muted" style="text-align:center;padding:10px">Mostrando 150 de ${lista.length} — usa la búsqueda para encontrar más.</p>` : '');
  }

  /* ── Detalle ── */
  async function detalle(id) {
    const f = await DB.facturas.get(id);
    if (!f) return;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const t = f.moneda || 'DOP';
    const abonado = f.total - f.saldo;

    abrirModal(`Factura ${rotulo(f)}`, `
      <div class="fact-head">
        <div><b>${esc(f.clienteNombre)}</b> ${badge(f)}<br>
        <span class="muted">${fmtFecha(f.fecha)}${f.orden && f.numero ? ' · ' + esc(f.numero) : ''}${f.ncf && !f.orden ? ' · NCF: ' + esc(f.ncf) : ''}</span></div>
      </div>
      <table class="fact-lineas">
        ${f.lineas.map(l => `<tr>
          <td>${esc(l.descripcion)}${l.cantidad > 1 ? ` <span class="muted">×${l.cantidad}</span>` : ''}</td>
          <td class="num">${fmtMoneda(l.cantidad * l.precio, t)}</td></tr>`).join('')}
        ${f.impuesto ? `<tr><td class="muted">ITBIS</td><td class="num">${fmtMoneda(f.impuesto, t)}</td></tr>` : ''}
        <tr class="fact-total"><td>Total</td><td class="num">${fmtMoneda(f.total, t)}</td></tr>
        ${abonado > 0.005 ? `<tr><td class="verde">Abonado</td><td class="num verde">−${fmtMoneda(abonado, t)}</td></tr>` : ''}
        ${f.saldo > 0.005 ? `<tr class="fact-total"><td class="rojo">Pendiente</td><td class="num rojo">${fmtMoneda(f.saldo, t)}</td></tr>` : ''}
      </table>

      ${f.notasInternas ? `<div class="nota-privada">🔒 <b>Nota privada:</b> ${esc(f.notasInternas)}</div>` : ''}
      ${f.costo > 0 ? `<div class="nota-privada">🔒 <b>Costo:</b> ${fmtMoneda(f.costo, t)} · <b>Ganancia:</b> <span class="${f.total - f.costo >= 0 ? 'verde' : 'rojo'}">${fmtMoneda(f.total - f.costo, t)}${f.total > 0 ? ` (${Math.round((f.total - f.costo) / f.total * 100)}%)` : ''}</span></div>` : ''}

      ${f.planPago ? `
        <h3 class="sub-h">📅 Plan EasyPay${f.planPago.cuotas.length ? ` (${esc(f.planPago.frecuencia)})` : ''}</h3>
        ${f.planPago.inicial > 0 ? `<div class="abono-row"><span>Pagado antes del plan</span><b class="verde">${fmtMoneda(f.planPago.inicial, t)} ✓</b></div>` : ''}
        ${f.planPago.cuotas.length
          ? cuotasConEstado(f).map(c => `<div class="abono-row">
              <span>${c.vencida ? '🔴' : c.cubierta ? '✅' : '•'} Cuota ${c.num} · ${fmtFecha(c.fecha)}</span>
              <b class="${c.vencida ? 'rojo' : c.cubierta ? 'verde' : ''}">${fmtMoneda(c.monto, t)}</b></div>`).join('')
          : '<p class="muted" style="margin:6px 0">🗓 Cuotas por programar — desde Cobros puedes fijar el próximo cobro.</p>'}` : ''}

      ${f.abonos && f.abonos.length ? `
        <h3 class="sub-h">Abonos registrados <span class="muted" style="text-transform:none;letter-spacing:0">· toca uno para su recibo 🧾</span></h3>
        ${f.abonos.map((a, i) => `<div class="abono-row abono-click" data-abono="${i}" style="cursor:pointer"><span>🧾 ${fmtFecha(a.fecha)} · ${esc(a.metodo)}</span><b>${fmtMoneda(a.monto, t)}</b></div>`).join('')}` : ''}

      ${f.estado === 'pendiente' && f.saldo > 0.005 ? `<button class="btn-gold btn-block" id="fAbonar" style="margin:14px 0 6px">💵 Registrar abono</button>` : ''}

      <div class="row" style="margin-top:12px">
        <button class="btn-ghost btn-block" id="fImprimir">🖨 Imprimir</button>
        ${UI.tieneWhatsApp(cliente) ? `<button class="btn-ghost btn-block" id="fWhatsApp">💬 WhatsApp</button>` : ''}
        ${cliente && cliente.correo ? `<button class="btn-ghost btn-block" id="fCorreo">✉️ Correo</button>` : ''}
        <button class="btn-ghost btn-block" id="fTarea">✓ Tarea</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost btn-block" id="fTGrabado">🪶 Grabado</button>
        <button class="btn-ghost btn-block" id="fTConfeccion">🧵 Confección</button>
      </div>
      <div class="row" style="margin-top:10px">
        ${f.estado !== 'anulada' ? `<button class="btn-ghost btn-block" id="fEditar">✏️ Editar</button>` : ''}
        ${f.estado !== 'anulada' ? `<button class="btn-danger btn-block" id="fAnular">Anular</button>` : ''}
        ${f.estado === 'anulada' ? `<button class="btn-gold btn-block" id="fDesanular">↩ Desanular</button>` : ''}
      </div>
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    UI.$$('[data-abono]').forEach(el =>
      el.addEventListener('click', () => reciboOpciones(f, Number(el.dataset.abono))));
    on('#fAbonar', () => formAbono(f));
    on('#fImprimir', () => imprimir(f, cliente));
    /* Tareas de taller con pasos preprogramados */
    const enDias = n => { const d = new Date(); d.setDate(d.getDate() + n); return UI.fechaISO(d); };
    const crearTareaTaller = async (titulo, pasos, notasExtra) => {
      await DB.tareas.upsert({
        titulo: `${titulo} — Factura ${rotulo(f)}`,
        fecha: pasos[0].fecha,
        notas: [notasExtra, `Creada desde la factura ${rotulo(f)}${f.orden && f.numero ? ' · ' + f.numero : ''} — ${f.clienteNombre}`]
          .filter(Boolean).join('\n'),
        clienteId: f.clienteId, clienteNombre: f.clienteNombre,
        pasos, hecha: false,
      });
      toast(`✓ Tarea "${titulo}" creada (${pasos.length} pasos)`);
      Tareas.render();
    };
    on('#fTGrabado', () => {
      abrirModal(`Grabado — ${rotulo(f)}`, `
        <form id="formGrabado">
          <div class="row"><div>
            <label>¿Qué se va a grabar? *</label>
            <textarea name="texto" required placeholder='Ej: "Andrea & Luis 12-08-26" en el interior del anillo'></textarea>
          </div></div>
          <button type="submit" class="btn-gold btn-block">Crear tarea de grabado</button>
          <button type="button" class="btn-ghost btn-block" id="grabVolver" style="margin-top:10px">← Volver a la factura</button>
        </form>
      `);
      $('#formGrabado').addEventListener('submit', async e => {
        e.preventDefault();
        const texto = String(new FormData(e.target).get('texto')).trim();
        if (!texto) return;
        await crearTareaTaller('Grabado', [
          { titulo: `Enviar a Rubén — «${texto}»`, fecha: enDias(0), hecho: false },
          { titulo: 'Seguimiento',                  fecha: enDias(2), hecho: false },
          { titulo: 'Envío',                        fecha: enDias(3), hecho: false },
        ], `Grabar: «${texto}»`);
        detalle(f.id);
      });
      $('#grabVolver').addEventListener('click', () => detalle(f.id));
    });
    on('#fTConfeccion', () => {
      abrirModal(`Confección — ${rotulo(f)}`, `
        <p class="muted" style="margin-bottom:14px">¿Para cuándo está pactada la confección?</p>
        <button class="btn-gold btn-block" id="conf5" style="margin-bottom:10px">⚡ Confección a 5 días</button>
        <button class="btn-gold btn-block" id="conf20">🗓 Confección a 20 días</button>
        <button class="btn-ghost btn-block" id="confVolver" style="margin-top:12px">← Volver a la factura</button>
      `);
      const crear = async dias => {
        await Confecciones.iniciar(f, dias);   // estampa f.confeccion + crea la tarea de taller
        detalle(f.id);
      };
      $('#conf5').addEventListener('click', () => crear(5));
      $('#conf20').addEventListener('click', () => crear(20));
      $('#confVolver').addEventListener('click', () => detalle(f.id));
    });
    on('#fTarea', () => Tareas.formulario({
      clienteId: f.clienteId,
      clienteNombre: f.clienteNombre,
      notas: `Factura ${rotulo(f)}${f.orden && f.numero ? ' · ' + f.numero : ''} — ${f.clienteNombre}`,
    }));

    /* Mensaje de factura (WhatsApp usa *negritas*; el correo va sin asteriscos) */
    const mensajeFactura = emp => {
      const lineasTxt = f.lineas.map(l =>
        `▪ ${l.descripcion}${l.cantidad > 1 ? ` ×${l.cantidad}` : ''} — ${fmtMoneda(l.cantidad * l.precio, t)}`).join('\n');
      let msg = `Hola ${f.clienteNombre}, le saluda *${UI.quienSaluda(emp)}* ✨\n\n` +
        `🧾 *Factura ${rotulo(f)}*${f.orden && f.ncf ? ` · NCF ${f.ncf}` : ''}\n` +
        `📅 ${fmtFecha(f.fecha)}\n\n${lineasTxt}\n` +
        (f.impuesto ? `▪ ITBIS — ${fmtMoneda(f.impuesto, t)}\n` : '') +
        `\n💰 *Total: ${fmtMoneda(f.total, t)}*`;
      if (f.saldo > 0.005) {
        msg += `\n🔴 Balance pendiente: *${fmtMoneda(f.saldo, t)}*`;
        if (f.planPago && f.planPago.cuotas && f.planPago.cuotas.length) {
          const cuotas = cuotasConEstado(f);
          msg += `\n\n📅 *Su plan de pagos:*` +
            (f.planPago.inicial > 0 ? `\n▪ Reserva: ${fmtMoneda(f.planPago.inicial, t)}${
              f.total - f.saldo >= f.planPago.inicial - 0.005 ? ' ✅' : ''}` : '') +
            cuotas.map(q =>
              `\n▪ Cuota ${q.num} · ${fmtFecha(q.fecha)}: ${fmtMoneda(q.monto, t)}${q.cubierta ? ' ✅' : ''}`).join('') +
            `\n📦 Su pieza se entrega al saldar el plan por completo.`;
        }
        if (emp.cuentas) msg += `\n\n*Cuentas para su pago:*\n\n${emp.cuentas}`;
      } else {
        msg += `\n✅ Pagada — ¡gracias por su compra!`;
      }
      msg += `\n\n📄 Si prefiere su factura en PDF por correo, con gusto se la enviamos — solo díganos.`;
      msg += `\n\n💎 ${emp.nombre} · ${emp.web}`;
      return msg;
    };
    on('#fWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp(cliente, mensajeFactura(emp));
    });
    on('#fCorreo', async () => {
      const emp = await UI.getEmpresa();
      const asunto = `Factura ${f.orden ? '#' + f.orden : f.numero} — ${emp.nombre}`;
      toast('Generando el PDF de la factura…');
      const modo = await PDFDoc.enviarPorCorreo('factura', f, cliente, mensajeFactura(emp).replace(/\*/g, ''), asunto);
      if (modo === 'descargado') toast('📄 PDF descargado — adjúntalo al correo que se abrió');
      if (modo === 'compartido' && cliente.correo) toast(`✉️ ${cliente.correo} copiado — pégalo en "Para:"`);
    });
    on('#fEditar', () => formulario(f));
    on('#fAnular', async () => {
      if (!confirm(`¿Anular la factura ${f.numero}? Se conserva en el historial como anulada y podrás desanularla después.`)) return;
      f.estado = 'anulada';   // el saldo se conserva para poder desanular con su balance exacto
      await DB.facturas.upsert(f);
      cerrarModal(); toast('Factura anulada'); render();
    });
    on('#fDesanular', async () => {
      const abonado = (f.abonos || []).reduce((s, a) => s + a.monto, 0);
      const saldoRest = f.saldo > 0.005 ? f.saldo : Math.max(0, Math.round((f.total - abonado) * 100) / 100);
      if (!confirm(`¿Restaurar la factura ${rotulo(f)}? Volverá como ${
        saldoRest > 0.005 ? `pendiente con balance ${fmtMoneda(saldoRest, t)}` : 'pagada'}.`)) return;
      f.saldo = saldoRest;
      f.estado = saldoRest > 0.005 ? 'pendiente' : 'pagada';
      if (f.planPago) actualizarProxCobro(f);
      await DB.facturas.upsert(f);
      toast('↩ Factura restaurada');
      render();
      detalle(f.id);
    });
  }

  /* ── Recibo de pago ── */
  async function reciboOpciones(f, i) {
    const abono = f.abonos[i];
    if (!abono) return;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const t = f.moneda || 'DOP';
    const numRec = `REC-${f.orden || f.numero || 's-n'}-${i + 1}`;
    const abonado = Math.round((f.total - f.saldo) * 100) / 100;

    abrirModal(`Recibo ${numRec}`, `
      <div class="deuda-banner" style="background:#E8F3E9;border-color:var(--green);color:var(--green)">
        ✅ Pago recibido: <b>${fmtMoneda(abono.monto, t)}</b>
      </div>
      <p class="muted" style="margin-bottom:14px;line-height:1.8">
        ${fmtFecha(abono.fecha)} · ${esc(abono.metodo || 'pago')}<br>
        Factura ${rotulo(f)}${f.orden && f.numero ? ' · ' + esc(f.numero) : ''} — ${esc(f.clienteNombre)}<br>
        ${f.saldo > 0.005 ? `Balance restante: <b class="rojo">${fmtMoneda(f.saldo, t)}</b>` : '<b class="verde">Factura saldada 🎉</b>'}
      </p>
      <div class="row">
        <button class="btn-ghost btn-block" id="rImprimir">🖨 Imprimir</button>
        ${UI.tieneWhatsApp(cliente) ? '<button class="btn-ghost btn-block" id="rWhatsApp">💬 WhatsApp</button>' : ''}
        ${cliente && cliente.correo ? '<button class="btn-ghost btn-block" id="rCorreo">✉️ Correo (PDF)</button>' : ''}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost btn-block" id="rCorregir">✏️ Corregir abono</button>
        <button class="btn-danger btn-block" id="rEliminar">🗑 Eliminar abono</button>
      </div>
      <button class="btn-ghost btn-block" id="rVolver" style="margin-top:10px">← Ver la factura</button>
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    const mensajeRecibo = emp =>
      `✅ *${emp.nombre} — Recibo de pago*\n${numRec} · ${fmtFecha(abono.fecha)}\n\n` +
      `Hola ${f.clienteNombre}, le saluda *${UI.quienSaluda(emp)}* ✨ Confirmamos su pago:\n\n` +
      `💵 *${fmtMoneda(abono.monto, t)}* (${abono.metodo || 'pago'})\n` +
      `🧾 Factura ${rotulo(f)}: total ${fmtMoneda(f.total, t)} · abonado ${fmtMoneda(abonado, t)}\n` +
      (f.saldo > 0.005 ? `🔴 Balance restante: *${fmtMoneda(f.saldo, t)}*` : `🎉 *Factura saldada — ¡muchas gracias!*`) +
      `\n\n📄 Si prefiere su recibo en PDF por correo, con gusto se lo enviamos — solo díganos.` +
      `\n\n💎 ${emp.nombre} · ${emp.web}`;

    on('#rImprimir', () => imprimirRecibo(f, abono, numRec));
    on('#rWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp(cliente, mensajeRecibo(emp));
    });
    on('#rCorreo', async () => {
      const emp = await UI.getEmpresa();
      toast('Generando el PDF del recibo…');
      const doc = await PDFDoc.docRecibo(f, abono, cliente, emp, numRec);
      const modo = await PDFDoc.compartirDoc(doc, `Recibo-${numRec}-SilverShine.pdf`, cliente,
        mensajeRecibo(emp).replace(/\*/g, ''), `Recibo de pago ${numRec} — ${emp.nombre}`);
      if (modo === 'descargado') toast('📄 PDF descargado — adjúntalo al correo que se abrió');
    });
    on('#rVolver', () => detalle(f.id));
    on('#rCorregir', () => formCorregirAbono(f, i));
    on('#rEliminar', async () => {
      if (!confirm(`¿Eliminar este abono de ${fmtMoneda(abono.monto, t)}? El balance de la factura vuelve a subir y el recibo desaparece.`)) return;
      await eliminarAbono(f, i);
      toast('Abono eliminado — balance restaurado');
      render();
      detalle(f.id);
    });
  }

  /* Fila espejo del abono en la colección pagos */
  async function pagoDeAbono(f, a) {
    return (await DB.pagos.list()).find(p =>
      p.facturaId === f.id && p.fecha === a.fecha && Math.abs((p.monto || 0) - a.monto) < 0.005);
  }

  /* Revertir un abono: sube el saldo, reabre la factura y borra la fila de pagos */
  async function eliminarAbono(f, i) {
    const a = f.abonos[i];
    if (!a) return;
    const pago = await pagoDeAbono(f, a);
    f.abonos.splice(i, 1);
    f.saldo = Math.round(Math.min(f.total, f.saldo + a.monto) * 100) / 100;
    if (f.saldo > 0.005 && f.estado === 'pagada') f.estado = 'pendiente';
    actualizarProxCobro(f);
    await DB.facturas.upsert(f);
    if (pago) await DB.pagos.remove(pago.id);
  }

  /* Corregir monto, fecha o método de un abono ya registrado */
  function formCorregirAbono(f, i) {
    const a = f.abonos[i];
    if (!a) return;
    const t = f.moneda || 'DOP';
    const maxMonto = Math.round((f.saldo + a.monto) * 100) / 100;
    abrirModal(`Corregir abono — ${rotulo(f)}`, `
      <p class="muted" style="margin-bottom:14px">${esc(f.clienteNombre)} · este abono: <b>${fmtMoneda(a.monto, t)}</b> · máximo: ${fmtMoneda(maxMonto, t)}</p>
      <form id="formCorregir">
        <div class="row">
          <div><label>Monto *</label><input name="monto" type="number" step="0.01" min="0.01" max="${maxMonto}" required value="${a.monto}"></div>
          <div><label>Fecha</label><input name="fecha" type="date" value="${a.fecha}"></div>
        </div>
        <div class="row"><div>
          <label>Método de pago</label>
          <select name="metodo">${METODOS.map(m => `<option ${m === a.metodo ? 'selected' : ''}>${m}</option>`).join('')}${
            METODOS.includes(a.metodo) ? '' : `<option selected>${esc(a.metodo || 'Otro')}</option>`}</select>
        </div></div>
        <button type="submit" class="btn-gold btn-block">Guardar corrección</button>
      </form>
    `);
    $('#formCorregir').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const monto = Math.min(Number(fd.get('monto')), maxMonto);
      if (!(monto > 0)) return;
      const pago = await pagoDeAbono(f, a);
      f.saldo = Math.round((f.saldo + a.monto - monto) * 100) / 100;
      a.monto = monto; a.fecha = fd.get('fecha'); a.metodo = fd.get('metodo');
      if (f.saldo <= 0.005) { f.saldo = 0; f.estado = 'pagada'; delete f.proxCobro; }
      else { if (f.estado === 'pagada') f.estado = 'pendiente'; actualizarProxCobro(f); }
      await DB.facturas.upsert(f);
      if (pago) {
        await DB.pagos.upsert({ ...pago, fecha: a.fecha, monto: a.monto, metodo: a.metodo });
      }
      toast('Abono corregido');
      render();
      detalle(f.id);
    });
  }

  async function imprimirRecibo(f, abono, numRec) {
    const emp = await UI.getEmpresa();
    const t = f.moneda || 'DOP';
    const abonado = Math.round((f.total - f.saldo) * 100) / 100;
    const datosEmp = [
      [emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · '),
      emp.direccion,
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
    ].filter(Boolean).join('<br>');
    $('#printArea').innerHTML = `
      <div class="p-head">
        <img src="logo.png" class="p-logo" alt="${esc(emp.nombre)}">
        ${datosEmp ? `<div class="p-empresa">${datosEmp}</div>` : ''}
      </div>
      <div class="p-meta">
        <div><b>RECIBO DE PAGO</b> ${esc(numRec)}<br>Fecha: ${fmtFecha(abono.fecha)}</div>
        <div style="text-align:right"><b>${esc(f.clienteNombre)}</b></div>
      </div>
      <div class="p-total"><span>PAGO RECIBIDO</span><span>${fmtMoneda(abono.monto, t)}</span></div>
      <table class="p-tabla" style="margin-top:18px">
        <tr><td>Método de pago</td><td class="num">${esc(abono.metodo || '—')}</td></tr>
        <tr><td>Aplicado a la factura</td><td class="num">${rotulo(f)}${f.numero ? ' · ' + esc(f.numero) : ''}</td></tr>
        <tr><td>Total de la factura</td><td class="num">${fmtMoneda(f.total, t)}</td></tr>
        <tr><td>Abonado a la fecha</td><td class="num">${fmtMoneda(abonado, t)}</td></tr>
        <tr><td><b>${f.saldo > 0.005 ? 'Balance pendiente' : 'Estado'}</b></td>
            <td class="num"><b>${f.saldo > 0.005 ? fmtMoneda(f.saldo, t) : 'SALDADA — ¡Gracias!'}</b></td></tr>
      </table>
      ${emp.pie ? `<div class="p-pie">${esc(emp.pie)}</div>` : ''}
    `;
    await UI.imprimirArea();
  }

  /* ── Registrar abono ── */
  /* El método de pago sugiere la cuenta del Cuadre que recibe el dinero:
     Efectivo→caja, Tarjeta→Mio (transitoria), Transferencia/EasyPay→Popular */
  const CUENTA_POR_METODO = { Efectivo: 'efectivo', Transferencia: 'popular', Tarjeta: 'mio', EasyPay: 'popular' };

  async function formAbono(f) {
    const t = f.moneda || 'DOP';
    const cuentas = await Caja.listaCuentas();
    const sugerida = CUENTA_POR_METODO[METODOS[0]];
    abrirModal(`Abono a ${f.numero || 'factura'}`, `
      <p class="muted" style="margin-bottom:14px">${esc(f.clienteNombre)} · pendiente: <b class="rojo">${fmtMoneda(f.saldo, t)}</b></p>
      <form id="formAbono">
        <div class="row">
          <div><label>Monto *</label><input name="monto" type="number" step="0.01" min="0.01" max="${f.saldo}" required value="${f.saldo}"></div>
          <div><label>Fecha</label><input name="fecha" type="date" value="${UI.fechaISO()}"></div>
        </div>
        <div class="row">
          <div><label>Método de pago</label>
            <select name="metodo">${METODOS.map(m => `<option>${m}</option>`).join('')}</select></div>
          <div><label>🏦 ¿A qué cuenta entró?</label>
            <select name="cuenta">
              ${cuentas.map(c => `<option value="${c.id}" ${c.id === sugerida ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
              <option value="">No registrar en el Cuadre</option>
            </select></div>
        </div>
        <button type="submit" class="btn-gold btn-block">Registrar abono</button>
      </form>
    `);
    const form = $('#formAbono');
    form.metodo.addEventListener('change', () => {
      const sug = CUENTA_POR_METODO[form.metodo.value];
      if (sug) form.cuenta.value = sug;
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const monto = Math.min(Number(fd.get('monto')), f.saldo);
      if (!(monto > 0)) return;
      const cuentaId = fd.get('cuenta') || null;
      const cuentaSel = cuentaId ? cuentas.find(c => c.id === cuentaId) : null;
      f.abonos = f.abonos || [];
      f.abonos.push({ fecha: fd.get('fecha'), monto, metodo: fd.get('metodo'),
        cuenta: cuentaId, cuentaNombre: cuentaSel ? cuentaSel.nombre : null });
      f.saldo = Math.round((f.saldo - monto) * 100) / 100;
      if (f.saldo <= 0.005) { f.saldo = 0; f.estado = 'pagada'; delete f.proxCobro; }
      else actualizarProxCobro(f);      // el plan EasyPay avanza a la siguiente cuota
      await DB.facturas.upsert(f);
      await DB.pagos.upsert({ clienteId: f.clienteId, clienteNombre: f.clienteNombre,
        fecha: fd.get('fecha'), monto, metodo: fd.get('metodo'), facturaId: f.id });
      // El cuadre se alimenta solo (si eligió cuenta)
      await Caja.registrarCobro(fd.get('cuenta'), monto, t, `Cobro ${f.clienteNombre} · Factura ${rotulo(f)}`);
      toast(f.estado === 'pagada' ? '¡Factura saldada! 🎉' : 'Abono registrado');
      render();
      reciboOpciones(f, f.abonos.length - 1);   // recibo listo para entregar
    });
  }

  /* ── Crear / editar factura ── */
  async function formulario(f) {
    const esNueva = !f || !f.id;
    f = f || {};
    const numero = f.numero || await siguienteNumero();
    const productos = await DB.productos.list();
    let lineas = f.lineas ? f.lineas.map(l => ({ ...l })) : [{ descripcion: '', cantidad: 1, precio: '' }];
    let clienteSel = f.clienteId ? await DB.clientes.get(f.clienteId) : null;

    abrirModal(esNueva ? 'Nueva factura' : `Editar ${f.numero}`, `
      <form id="formFactura">
        <div class="row"><div>
          <label>Cliente *</label>
          <input id="cliBuscar" autocomplete="off" placeholder="Escribe para buscar…" value="${esc(clienteSel ? clienteSel.nombre : '')}">
          <div id="cliSugerencias" class="sugerencias" hidden></div>
        </div></div>
        <div class="row">
          <div><label>Orden #</label><input name="orden" type="number" min="1" value="${f.orden || await siguienteOrden()}"></div>
          <div><label>Número (NCF)</label><input name="numero" value="${esc(numero)}"></div>
        </div>
        <div class="row">
          <div><label>Fecha</label><input name="fecha" type="date" value="${f.fecha || UI.fechaISO()}"></div>
        </div>
        <div class="row">
          <div><label>Moneda</label>
            <select name="moneda">
              <option value="DOP" ${f.moneda !== 'USD' ? 'selected' : ''}>RD$ (DOP)</option>
              <option value="USD" ${f.moneda === 'USD' ? 'selected' : ''}>US$ (USD)</option>
            </select></div>
          <div><label>ITBIS 18%</label>
            <select name="itbis">
              <option value="no" ${!f.impuesto ? 'selected' : ''}>Sin ITBIS</option>
              <option value="si" ${f.impuesto ? 'selected' : ''}>Agregar ITBIS</option>
            </select></div>
        </div>

        <div class="row"><div>
          <label>Forma de pago</label>
          <select name="formaPago" id="fpSelect">
            <option value="inmediato" ${!f.planPago ? 'selected' : ''}>💵 Pago inmediato</option>
            <option value="easypay" ${f.planPago ? 'selected' : ''}>📅 EasyPay — pagos programados</option>
          </select>
        </div></div>
        <div id="easypayCampos" ${f.planPago ? '' : 'hidden'} style="background:var(--rose-soft);border-radius:10px;padding:12px;margin-bottom:12px">
          <div class="row">
            <div><label>Plan (reglas oficiales EasyPay)</label>
              <select name="epPlan">
                <option value="4m" ${!f.planPago || f.planPago.plan === '4m' ? 'selected' : ''}>4 meses — 25% reserva · sin cargos</option>
                <option value="6m" ${f.planPago && f.planPago.plan === '6m' ? 'selected' : ''}>6 meses — 20% + RD$300/cuota</option>
                <option value="612m" ${f.planPago && f.planPago.plan === '612m' ? 'selected' : ''}>6 a 12 meses — 15% + RD$500/cuota</option>
                <option value="custom" ${f.planPago && !f.planPago.plan ? 'selected' : ''}>Personalizado</option>
              </select></div>
            <div><label>Cuotas (meses)</label><input name="epCuotas" type="number" min="2" max="12" step="1" value="${f.planPago ? f.planPago.cuotas.length || 4 : 4}"></div>
          </div>
          <div class="row" id="epCustomCampos" ${f.planPago && !f.planPago.plan ? '' : 'hidden'}>
            <div><label>Inicial</label><input name="epInicial" type="number" min="0" step="0.01" value="${f.planPago ? f.planPago.inicial : 0}"></div>
            <div><label>Frecuencia</label>
              <select name="epFrecuencia">
                <option value="quincenal" ${!f.planPago || f.planPago.frecuencia === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                <option value="semanal" ${f.planPago && f.planPago.frecuencia === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="mensual" ${f.planPago && f.planPago.frecuencia === 'mensual' ? 'selected' : ''}>Mensual</option>
              </select></div>
          </div>
          <div class="row"><div><label>Primer cobro</label><input name="epPrimera" type="date" value="${
            f.planPago && f.planPago.cuotas[0] ? f.planPago.cuotas[0].fecha : (() => {
              const d = new Date(); const dia = d.getDate();
              d.setDate(1); d.setMonth(d.getMonth() + 1);
              d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
              return UI.fechaISO(d);
            })()}"></div></div>
          <p class="muted" id="epPreview" style="margin-top:4px"></p>
        </div>

        <label style="margin-top:4px">Líneas</label>
        <div id="lineasCont"></div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="btn-ghost btn-sm" id="addLinea">+ Línea libre</button>
          <div style="flex:1;position:relative">
            <input id="addProdBuscar" placeholder="🛍 Del catálogo…" autocomplete="off">
            <div id="addProdSug" class="sugerencias" hidden></div>
          </div>
        </div>

        <div class="fact-preview" id="factPreview"></div>

        <div class="row"><div>
          <label>Nota (visible en la factura)</label>
          <input name="notas" value="${esc(f.notas || '')}">
        </div></div>
        <div class="row"><div>
          <label>🔒 Nota privada (uso interno — nunca se imprime ni se envía)</label>
          <textarea name="notasInternas">${esc(f.notasInternas || '')}</textarea>
        </div></div>
        <div class="row"><div>
          <label>🔒 Costo de producción (privado — alimenta Finanzas)</label>
          <input name="costo" type="number" step="0.01" min="0" value="${f.costo ?? ''}" placeholder="Materiales + mano de obra (opcional)">
        </div></div>
        <button type="submit" class="btn-gold btn-block">${esNueva ? 'Crear factura' : 'Guardar cambios'}</button>
      </form>
    `);

    /* Selector de cliente (con creación rápida en el mismo campo) */
    const inpCli = $('#cliBuscar'), sug = $('#cliSugerencias');
    UI.buscadorCliente(inpCli, sug, c => { clienteSel = c; });

    /* Líneas */
    function pintarLineas() {
      const cont = $('#lineasCont');
      cont.innerHTML = lineas.map((l, i) => `
        <div class="linea-row">
          <input placeholder="Descripción" data-i="${i}" data-k="descripcion" value="${esc(l.descripcion)}">
          <input type="number" min="1" step="1" data-i="${i}" data-k="cantidad" value="${l.cantidad}" title="Cantidad">
          <input type="number" min="0" step="0.01" placeholder="Precio" data-i="${i}" data-k="precio" value="${l.precio}">
          <button type="button" class="btn-x" data-del="${i}">✕</button>
        </div>`).join('');
      cont.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        lineas[inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'descripcion' ? inp.value : inp.value;
        preview();
      }));
      cont.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        lineas.splice(Number(b.dataset.del), 1);
        if (!lineas.length) lineas.push({ descripcion: '', cantidad: 1, precio: '' });
        pintarLineas(); preview();
      }));
      preview();
    }
    function preview() {
      const form = $('#formFactura');
      const { sub, imp, total } = totalDe(lineas, form.itbis.value === 'si');
      const m = form.moneda.value;
      $('#factPreview').innerHTML =
        `Subtotal: <b>${fmtMoneda(sub, m)}</b>${imp ? ` · ITBIS: <b>${fmtMoneda(imp, m)}</b>` : ''} · Total: <b class="dorado">${fmtMoneda(total, m)}</b>`;
      previewEasyPay(total, m);
    }
    function previewEasyPay(total, m) {
      const form = $('#formFactura');
      const el = $('#epPreview');
      if (!el || form.formaPago.value !== 'easypay') return;
      const planId = form.epPlan.value;
      if (planId !== 'custom') {
        // Reglas oficiales: base sin la línea de tarifa administrativa
        const baseLineas = lineas.filter(l => !String(l.descripcion || '').startsWith(FEE_DESC));
        const { total: totB } = totalDe(baseLineas, form.itbis.value === 'si');
        const c = UI.calcularEasyPay(Math.round(totB * 100) / 100, planId, Number(form.epCuotas.value));
        if (!c) { el.textContent = 'Agrega líneas con precio para calcular el plan.'; return; }
        el.textContent = `Reserva hoy ${fmtMoneda(c.reserva, m)} (mín. RD$7,000) + ${c.meses} cuotas mensuales de ${fmtMoneda(c.cuota, m)}` +
          `${c.fee ? ` — incluye RD$${c.fee} de tarifa admin. por cuota` : ' — sin cargos'} · total con tarifas ${fmtMoneda(c.totalConTarifas, m)}`;
        return;
      }
      const inicial = Number(form.epInicial.value) || 0;
      const n = Math.max(1, Math.round(Number(form.epCuotas.value) || 1));
      if (total <= inicial) { el.textContent = 'La inicial cubre el total — no harían falta cuotas.'; return; }
      const cuotas = generarCuotas(total, inicial, n, form.epFrecuencia.value, form.epPrimera.value);
      el.textContent = `${inicial > 0 ? 'Inicial de ' + fmtMoneda(inicial, m) + ' + ' : ''}${n} cuota(s) de ~${fmtMoneda(cuotas[0].monto, m)} · última el ${fmtFecha(cuotas[cuotas.length - 1].fecha)}`;
    }
    $('#addLinea').addEventListener('click', () => { lineas.push({ descripcion: '', cantidad: 1, precio: '' }); pintarLineas(); });
    UI.buscadorCatalogo($('#addProdBuscar'), $('#addProdSug'), item => {
      const m = $('#formFactura').moneda.value;
      let precio = item.precio;
      if (item.moneda && item.moneda !== m) {
        const tasa = typeof Calculadora !== 'undefined' ? Calculadora.tasaActual() : 0;
        if (tasa) {
          precio = Math.round((m === 'DOP' ? precio * tasa : precio / tasa) * 100) / 100;
          toast(`Convertido de ${item.moneda} a ${m} (tasa ${tasa})`);
        }
      }
      lineas.push({ descripcion: item.descripcion, cantidad: 1, precio });
      pintarLineas();
    });
    $('#formFactura').moneda.addEventListener('change', preview);
    $('#formFactura').itbis.addEventListener('change', preview);
    $('#fpSelect').addEventListener('change', e => {
      $('#easypayCampos').hidden = e.target.value !== 'easypay';
      preview();
    });
    ['epInicial', 'epCuotas', 'epFrecuencia', 'epPrimera'].forEach(nm =>
      $('#formFactura')[nm].addEventListener('input', preview));
    const ajustarPlan = () => {
      const form = $('#formFactura');
      const planId = form.epPlan.value;
      $('#epCustomCampos').hidden = planId !== 'custom';
      if (planId !== 'custom') {
        const p = UI.EASYPAY_PLANES[planId];
        form.epCuotas.min = p.min; form.epCuotas.max = p.max;
        form.epCuotas.value = Math.min(p.max, Math.max(p.min, Math.round(Number(form.epCuotas.value) || p.def)));
      } else {
        form.epCuotas.min = 1; form.epCuotas.max = 36;
      }
    };
    $('#formFactura').epPlan.addEventListener('change', () => { ajustarPlan(); preview(); });
    ajustarPlan();
    pintarLineas();

    /* Guardar */
    $('#formFactura').addEventListener('submit', async e => {
      e.preventDefault();
      if (!clienteSel) { toast('Selecciona un cliente de la lista'); inpCli.focus(); return; }
      const fd = new FormData(e.target);
      const lineasOk = lineas
        .map(l => ({ descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad) || 1, precio: Number(l.precio) || 0 }))
        .filter(l => l.descripcion && l.precio > 0);
      if (!lineasOk.length) { toast('Agrega al menos una línea con precio'); return; }
      const { imp, total } = totalDe(lineasOk, fd.get('itbis') === 'si');
      const totalR = Math.round(total * 100) / 100;
      const numeroF = fd.get('numero').trim();

      // Al editar se respeta lo ya abonado y el saldo se recalcula
      const abonadoPrevio = f.id ? Math.round((f.total - f.saldo) * 100) / 100 : 0;
      let saldoNuevo = f.id ? Math.round((totalR - abonadoPrevio) * 100) / 100 : totalR;
      if (saldoNuevo < 0) {
        saldoNuevo = 0;
        toast(`Ojo: el nuevo total (${fmtMoneda(totalR, fd.get('moneda'))}) es menor que lo ya abonado (${fmtMoneda(abonadoPrevio, fd.get('moneda'))})`);
      }

      const nueva = {
        id: f.id,
        orden: Number(fd.get('orden')) || null,
        numero: numeroF,
        ncf: numeroF.startsWith('B') ? numeroF : '',
        clienteId: clienteSel.id,
        clienteNombre: clienteSel.nombre,
        fecha: fd.get('fecha'),
        moneda: fd.get('moneda'),
        lineas: lineasOk,
        impuesto: Math.round(imp * 100) / 100,
        total: totalR,
        saldo: saldoNuevo,
        estado: saldoNuevo <= 0.005 && f.id ? 'pagada' : 'pendiente',
        notas: fd.get('notas').trim(),
        notasInternas: fd.get('notasInternas').trim(),
        costo: Number(fd.get('costo')) || null,
        abonos: f.abonos || [],
      };

      /* Plan EasyPay */
      if (fd.get('formaPago') === 'easypay') {
        const planId = fd.get('epPlan');
        if (planId !== 'custom') {
          // Reglas oficiales: reserva % (mín. RD$7,000) + cuotas mensuales
          // iguales; la tarifa administrativa entra como línea de la factura.
          const baseLineas = lineasOk.filter(l => !l.descripcion.startsWith(FEE_DESC));
          const { imp: impB, total: totB } = totalDe(baseLineas, fd.get('itbis') === 'si');
          const precioBase = Math.round(totB * 100) / 100;
          const cep = UI.calcularEasyPay(precioBase, planId, Number(fd.get('epCuotas')));
          if (!cep) { toast('Agrega líneas con precio para el plan EasyPay'); return; }
          nueva.lineas = cep.fee
            ? [...baseLineas, { descripcion: `${FEE_DESC} (${cep.meses} cuotas × RD$${cep.fee})`, cantidad: cep.meses, precio: cep.fee }]
            : baseLineas;
          nueva.impuesto = Math.round(impB * 100) / 100;
          nueva.total = cep.totalConTarifas;
          let s = f.id ? Math.round((cep.totalConTarifas - abonadoPrevio) * 100) / 100 : cep.totalConTarifas;
          if (s < 0) s = 0;
          nueva.saldo = s;
          nueva.estado = s <= 0.005 && f.id ? 'pagada' : 'pendiente';
          nueva.planPago = {
            tipo: 'easypay', plan: planId, fee: cep.fee, inicial: cep.reserva, frecuencia: 'mensual',
            cuotas: cep.totalConTarifas > cep.reserva
              ? generarCuotas(cep.totalConTarifas, cep.reserva, cep.meses, 'mensual', fd.get('epPrimera'))
              : [],
          };
          // La reserva se registra como primer abono (solo al crear la factura)
          if (esNueva && cep.reserva > 0) {
            nueva.abonos = [{ fecha: nueva.fecha, monto: cep.reserva, metodo: 'EasyPay (reserva)' }];
            nueva.saldo = Math.round((nueva.saldo - cep.reserva) * 100) / 100;
            if (nueva.saldo <= 0.005) { nueva.saldo = 0; nueva.estado = 'pagada'; }
          }
        } else {
          const inicial = Math.min(Number(fd.get('epInicial')) || 0, totalR);
          const n = Math.max(1, Math.round(Number(fd.get('epCuotas')) || 1));
          nueva.planPago = {
            tipo: 'easypay',
            inicial,
            frecuencia: fd.get('epFrecuencia'),
            cuotas: totalR > inicial ? generarCuotas(totalR, inicial, n, fd.get('epFrecuencia'), fd.get('epPrimera')) : [],
          };
          if (esNueva && inicial > 0) {
            nueva.abonos = [{ fecha: nueva.fecha, monto: inicial, metodo: 'EasyPay (inicial)' }];
            nueva.saldo = Math.round((nueva.saldo - inicial) * 100) / 100;
            if (nueva.saldo <= 0.005) { nueva.saldo = 0; nueva.estado = 'pagada'; }
          }
        }
        actualizarProxCobro(nueva);
      } else {
        delete f.planPago;
        delete nueva.planPago;
      }

      const guardada = await DB.facturas.upsert(nueva);
      if (esNueva && nueva.abonos.length) {
        await DB.pagos.upsert({ clienteId: nueva.clienteId, clienteNombre: nueva.clienteNombre,
          fecha: nueva.fecha, monto: nueva.abonos[0].monto, metodo: nueva.abonos[0].metodo, facturaId: guardada.id });
      }
      cerrarModal();
      toast(esNueva ? `Factura ${numeroF} creada` : 'Factura actualizada');
      render();
    });
  }

  /* ── Imprimir ── */
  async function imprimir(f, cliente) {
    const t = f.moneda || 'DOP';
    const abonado = f.total - f.saldo;
    const emp = await UI.getEmpresa();
    const datosEmp = [
      [emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · '),
      emp.direccion,
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
    ].filter(Boolean).join('<br>');
    $('#printArea').innerHTML = `
      <div class="p-head">
        <img src="logo.png" class="p-logo" alt="${esc(emp.nombre)}">
        ${datosEmp ? `<div class="p-empresa">${datosEmp}</div>` : ''}
      </div>
      <div class="p-meta">
        <div><b>${f.estado === 'anulada' ? 'FACTURA ANULADA' : 'FACTURA'} ${f.orden ? '#' + f.orden : ''}</b><br>
        ${f.numero ? `${f.ncf ? 'NCF: ' : 'No.: '}${esc(f.numero)}<br>` : ''}Fecha: ${fmtFecha(f.fecha)}</div>
        <div style="text-align:right"><b>${esc(f.clienteNombre)}</b><br>
        ${cliente && cliente.telefono ? esc(cliente.telefono) + '<br>' : ''}${cliente && cliente.correo ? esc(cliente.correo) : ''}</div>
      </div>
      <table class="p-tabla">
        <tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr>
        ${f.lineas.map(l => `<tr><td>${esc(l.descripcion)}</td><td class="num">${l.cantidad}</td>
          <td class="num">${fmtMoneda(l.precio, t)}</td><td class="num">${fmtMoneda(l.cantidad * l.precio, t)}</td></tr>`).join('')}
        ${f.impuesto ? `<tr><td colspan="3" class="num">ITBIS (18%)</td><td class="num">${fmtMoneda(f.impuesto, t)}</td></tr>` : ''}
      </table>
      <div class="p-total"><span>TOTAL</span><span>${fmtMoneda(f.total, t)}</span></div>
      ${abonado > 0.005 ? `<div class="p-saldo">Abonado: ${fmtMoneda(abonado, t)} · <b>Pendiente: ${fmtMoneda(f.saldo, t)}</b></div>` : ''}
      ${f.notas ? `<div class="p-nota">${esc(f.notas)}</div>` : ''}
      ${emp.garantia ? `<div class="p-garantia">${esc(emp.garantia)}</div>` : ''}
      ${emp.pie ? `<div class="p-pie">${esc(emp.pie)}</div>` : ''}
    `;
    await UI.imprimirArea();
  }

  /* ── Eventos de la vista ── */
  function init() {
    $('#btnNuevaFactura').addEventListener('click', () => formulario());
    $('#buscarFactura').addEventListener('input', e => { filtro = e.target.value.trim(); render(); });
    $('#filtroEstadoFact').addEventListener('change', e => { filtroEstado = e.target.value; render(); });
    $('#listaFacturas').addEventListener('click', e => {
      const item = e.target.closest('.item[data-id]');
      if (item) detalle(item.dataset.id);
    });
  }

  return { init, render, detalle, siguienteNumero, siguienteOrden, formAbono, formulario, cuotasConEstado, generarCuotas, FEE_DESC };
})();
