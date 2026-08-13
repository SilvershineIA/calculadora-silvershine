/* ═══════════════════════════════════════════════════════════
   cotizaciones.js — Módulo de cotizaciones: seguimiento,
   conversión a factura, impresión y envío.
   ═══════════════════════════════════════════════════════════ */
const Cotizaciones = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  let filtro = '', filtroEstado = '';

  // El import de QuickBooks trae "pendiente" (open); aquí equivale a "enviada"
  const estadoDe = c => c.estado === 'pendiente' ? 'enviada' : c.estado;
  const ABIERTAS = ['borrador', 'enviada'];

  const badge = c => {
    const e = estadoDe(c);
    const cls = { borrador: 'b-anu', enviada: 'b-pend', aceptada: 'b-pag', rechazada: 'b-anu', vencida: 'b-anu' }[e] || 'b-pend';
    return `<span class="badge ${cls}">${e}</span>`;
  };

  /* Aceptada pero sin factura = el lead más caliente: hay que perseguirla */
  const esLeadCaliente = c => estadoDe(c) === 'aceptada' && !c.facturaId;

  /* ¿Está pospuesta a propósito? ("dale un toque en 15 días" desde Mi Día) */
  const pospuesta = c => c.proximoToque && c.proximoToque > UI.fechaISO();

  /* Segunda etiqueta: ¿hubo gestión (creación o seguimiento) reciente?
     Abiertas: 15 días de ventana · aceptadas sin facturar: 7 (más calientes).
     Si está pospuesta, la etiqueta muestra la fecha del próximo toque. */
  const badgeSeguimiento = c => {
    if (!ABIERTAS.includes(estadoDe(c)) && !esLeadCaliente(c)) return '';
    if (pospuesta(c)) return `<span class="badge b-anu">⏰ toque el ${fmtFecha(c.proximoToque)}</span>`;
    const dias = esLeadCaliente(c) ? 7 : 15;
    const ultima = [c.fecha, ...(c.seguimientos || []).map(s => s.fecha)].filter(Boolean).sort().pop();
    const corte = UI.fechaISO(new Date(Date.now() - dias * 864e5));
    return ultima && ultima >= corte
      ? '<span class="badge b-pag">🤝 al día</span>'
      : '<span class="badge b-roja">🤝 sin seguimiento</span>';
  };

  /* Mensaje de seguimiento (compartido por el detalle y por Mi Día).
     Abiertas: saludo suave con la pregunta que reactiva. Aceptadas sin
     facturar (lead caliente): cerrar con el 70/30. */
  function mensajeSeguimientoDe(c, emp) {
    const t = c.moneda || 'DOP';
    return esLeadCaliente(c)
      ? `Hola ${c.clienteNombre} 👋 Le saluda *${UI.quienSaluda(emp)}* ✨\n\n` +
        `¡Qué alegría que le encantó su pieza de la cotización *COT-${c.numero}*! 😍\n` +
        `💍 ${c.lineas[0] ? c.lineas[0].descripcion : 'Su pieza'}\n\n` +
        `Cuando guste comenzamos: con el *70% (${fmtMoneda((c.total || 0) * 0.7, t)})* iniciamos la confección y el 30% restante se paga a la entrega.${
          c.easypay ? ' También puede tomarla con su plan EasyPay si lo prefiere.' : ''}\n\n` +
        `Estamos a la orden para lo que necesite 💎\n${emp.nombre} · ${emp.web}`
      : `Hola ${c.clienteNombre} 👋 Le saluda *${UI.quienSaluda(emp)}* ✨\n\n` +
        `Hace unos días le compartimos la cotización *COT-${c.numero}* de:\n` +
        `💍 ${c.lineas[0] ? c.lineas[0].descripcion : 'su pieza'}\n\n` +
        `¿Qué le pareció? 😊 ¿Le gustó la pieza, o le gustaría modificar algo — el peso, el material o el presupuesto? Con gusto la ajustamos hasta que quede perfecta para usted.\n\n` +
        `Quedamos atentos, sin ningún compromiso 💎\n${emp.nombre} · ${emp.web}`;
  }

  /* Seguimiento en 1 toque desde Mi Día: envía el mensaje correcto
     (suave o de cierre), lo registra y sale */
  async function seguimientoRapido(id) {
    const c = await DB.cotizaciones.get(id);
    if (!c) return false;
    const cliente = c.clienteId ? await DB.clientes.get(c.clienteId) : null;
    if (!UI.tieneWhatsApp(cliente)) { detalle(id); return false; }
    const emp = await UI.getEmpresa();
    UI.abrirWhatsApp(cliente, mensajeSeguimientoDe(c, emp));
    c.seguimientos = [...(c.seguimientos || []), { fecha: UI.fechaISO(), via: 'WhatsApp' }];
    await DB.cotizaciones.upsert(c);
    toast('🤝 Seguimiento enviado y registrado');
    return true;
  }

  async function siguienteNumero() {
    const lista = await DB.cotizaciones.list();
    let max = 1000;
    for (const c of lista) {
      const m = /^(\d+)$/.exec(String(c.numero || '').trim());
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return String(max + 1);
  }

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaCotizaciones');
    let lista = await DB.cotizaciones.list();

    // Abiertas con más de 90 días pasan a vencidas solas
    // (si el usuario cambió el estado a mano, los 90 días corren desde ese día)
    const corte = UI.fechaISO(new Date(Date.now() - 90 * 864e5));
    for (const c of lista) {
      const base = c.estadoManual || c.fecha;
      if (ABIERTAS.includes(estadoDe(c)) && base && base < corte) {
        c.estado = 'vencida';
        await DB.cotizaciones.upsert(c);
      }
    }

    const abiertas = lista.filter(c => ABIERTAS.includes(estadoDe(c)));
    const monto = abiertas.reduce((s, c) => s + (c.total || 0), 0);
    $('#cotResumen').innerHTML =
      UI.statTile(abiertas.length, 'Abiertas') +
      UI.statTile(UI.fmtDinero(monto), 'Ventas en camino');

    /* ── Panel de conversión y seguimiento ──
       El cierre VERDADERO es pasar a factura (facturaId) — "aceptada" a
       secas es palabra del cliente, aún sin cerrar. Conversión = facturadas
       ÷ cerradas (facturada + rechazada + vencida); las aceptadas sin
       factura quedan aparte como "por facturar". La efectividad del
       seguimiento compara la conversión de cerradas CON vs SIN seguimiento. */
    const todasCot = lista;
    const esFacturada = c => !!c.facturaId;
    const esCerrada = c => esFacturada(c) || ['rechazada', 'vencida'].includes(estadoDe(c));
    const tasaDe = arr => {
      const cer = arr.filter(esCerrada);
      if (!cer.length) return null;
      return Math.round(cer.filter(esFacturada).length / cer.length * 100);
    };
    const hace90 = UI.fechaISO(new Date(Date.now() - 90 * 864e5));
    const ultimas90 = todasCot.filter(c => (c.fecha || '') >= hace90);
    const cerradas = todasCot.filter(esCerrada);
    const conSeg = cerradas.filter(c => (c.seguimientos || []).length);
    const sinSeg = cerradas.filter(c => !(c.seguimientos || []).length);
    const tasaGrupo = arr => arr.length
      ? Math.round(arr.filter(esFacturada).length / arr.length * 100) : null;
    // Tiempo promedio de cotización → factura
    const facturasTodas = await DB.facturas.list();
    const tiempos = todasCot
      .filter(esFacturada)
      .map(c => {
        const f = facturasTodas.find(x => x.id === c.facturaId);
        return f && f.fecha && c.fecha ? Math.round((new Date(f.fecha) - new Date(c.fecha)) / 864e5) : null;
      })
      .filter(v => v !== null && v >= 0);
    const tMedio = tiempos.length ? Math.round(tiempos.reduce((s, v) => s + v, 0) / tiempos.length) : null;
    const cotizado90 = ultimas90.reduce((s, c) => s + (c.total || 0), 0);
    const facturado90 = ultimas90.filter(esFacturada).reduce((s, c) => s + (c.total || 0), 0);
    const pct = v => v === null ? '—' : v + '%';
    const porFacturarTodas = todasCot.filter(c => estadoDe(c) === 'aceptada' && !c.facturaId);
    $('#cotConversion').innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h2>📊 Conversión y seguimiento <span class="muted" style="text-transform:none;letter-spacing:0;font-size:.8rem">· cierre = pasó a factura</span></h2>
        <div class="stat-grid">
          ${UI.statTile(pct(tasaDe(todasCot)), 'Conversión histórica')}
          ${UI.statTile(pct(tasaDe(ultimas90)), 'Conversión 90 días')}
          ${UI.statTile(pct(tasaGrupo(conSeg)), 'Con seguimiento 🤝')}
          ${UI.statTile(pct(tasaGrupo(sinSeg)), 'Sin seguimiento')}
        </div>
        <p class="muted" style="margin-top:10px;line-height:1.8">
          ${tMedio !== null ? `⏱ De cotización a factura: <b>${tMedio} día${tMedio === 1 ? '' : 's'}</b> en promedio. ` : ''}
          💰 Últimos 90 días: facturado <b>${UI.fmtDinero(facturado90)}</b> de ${UI.fmtDinero(cotizado90)} cotizados${
            cotizado90 > 0 ? ` (${Math.round(facturado90 / cotizado90 * 100)}% del valor)` : ''}.<br>
          ${cerradas.filter(esFacturada).length} facturadas · ${porFacturarTodas.length ? `<b class="rojo">${porFacturarTodas.length} aceptadas SIN facturar</b>` : '0 aceptadas sin facturar'} · ${
            cerradas.filter(c => !esFacturada(c) && estadoDe(c) === 'rechazada').length} rechazadas · ${
            cerradas.filter(c => !esFacturada(c) && estadoDe(c) === 'vencida').length} vencidas · ${abiertas.length} abiertas en juego.
        </p>
      </div>`;

    if (filtroEstado) lista = lista.filter(c => estadoDe(c) === filtroEstado);
    else if (!filtro) lista = lista.filter(c => !['vencida', 'rechazada'].includes(estadoDe(c)) && !c.facturaId);   // vencidas, rechazadas y facturadas ocultas salvo búsqueda o filtro
    if (filtro) {
      const f = filtro.toLowerCase();
      lista = lista.filter(x =>
        String(x.numero || '').toLowerCase().includes(f) ||
        (x.clienteNombre || '').toLowerCase().includes(f));
    }
    lista.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    if (!lista.length) {
      cont.innerHTML = `<div class="empty"><span>📋</span>${
        filtro || filtroEstado ? 'Ninguna cotización coincide.' : 'No hay cotizaciones todavía.'
      }</div>`;
      return;
    }

    const fila = c => `
      <div class="item" data-id="${c.id}">
        <div class="item-info">
          <div class="item-name">${esc(c.clienteNombre)} ${badge(c)}${badgeSeguimiento(c)}</div>
          <div class="item-sub">COT-${esc(String(c.numero || 's/n'))} · ${fmtFecha(c.fecha)} · ${fmtMoneda(c.total, c.moneda)}${
            c.vence && ABIERTAS.includes(estadoDe(c)) ? ` · vence ${fmtFecha(c.vence)}` : ''}${
            (c.seguimientos || []).length ? ` · 🤝 ${fmtFecha(c.seguimientos[c.seguimientos.length - 1].fecha)}` : ''}</div>
        </div>
        <span class="item-arrow">›</span>
      </div>`;

    if (filtro || filtroEstado) {
      cont.innerHTML = lista.slice(0, 100).map(fila).join('');
      return;
    }

    /* ── Vista "Activas": jerarquía por urgencia ──
       🔴 vence en ≤2 días o 15+ días sin gestión · 🟠 vence en ≤7 días o
       7+ días sin gestión · 🟢 al día; dentro de cada grupo, mayor monto
       primero. Las aceptadas van al final como referencia. */
    const hoyMs = Date.now();
    const urgencia = c => {
      if (pospuesta(c)) return 2;   // "toque el X": tranquila hasta esa fecha
      const ultima = [c.fecha, ...(c.seguimientos || []).map(s => s.fecha)].filter(Boolean).sort().pop();
      const diasSin = ultima ? Math.floor((hoyMs - new Date(ultima + 'T00:00:00')) / 864e5) : 999;
      const diasVence = c.vence ? Math.ceil((new Date(c.vence + 'T00:00:00') - hoyMs) / 864e5) : null;
      if ((diasVence !== null && diasVence <= 2) || diasSin >= 15) return 0;
      if ((diasVence !== null && diasVence <= 7) || diasSin >= 7) return 1;
      return 2;
    };
    const grupos = [[], [], []];
    lista.filter(c => ABIERTAS.includes(estadoDe(c))).forEach(c => grupos[urgencia(c)].push(c));
    grupos.forEach(g => g.sort((a, b) => (b.total || 0) - (a.total || 0)));
    // Aceptadas de palabra pero sin factura = el verdadero pendiente de cierre
    // (las ya facturadas no aparecen: su vida sigue en Facturas)
    const porFacturar = lista.filter(c => estadoDe(c) === 'aceptada' && !c.facturaId)
      .sort((a, b) => (b.total || 0) - (a.total || 0));
    const seccion = (titulo, arr, cls) => !arr.length ? '' :
      `<h3 class="sub-h ${cls}">${titulo} (${arr.length})</h3>` + arr.map(fila).join('');
    cont.innerHTML =
      seccion('🧾 Aceptadas por facturar — ¡el cierre de verdad!', porFacturar, 'rojo') +
      seccion('🔴 Urgentes — vencen ya o 15+ días sin gestión', grupos[0], 'rojo') +
      seccion('🟠 Necesitan atención', grupos[1], '') +
      seccion('🟢 Al día', grupos[2], '') ||
      '<div class="empty"><span>📋</span>Sin cotizaciones activas — las facturadas viven en Facturas.</div>';
  }

  /* ── Detalle ── */
  async function detalle(id) {
    const c = await DB.cotizaciones.get(id);
    if (!c) return;
    const cliente = c.clienteId ? await DB.clientes.get(c.clienteId) : null;
    const t = c.moneda || 'DOP';
    const abierta = ABIERTAS.includes(estadoDe(c));

    abrirModal(`Cotización COT-${c.numero || 's/n'}`, `
      <div class="fact-head">
        <div><b>${esc(c.clienteNombre)}</b> ${badge(c)}${badgeSeguimiento(c)}<br>
        <span class="muted">${fmtFecha(c.fecha)}${c.vence ? ' · vence ' + fmtFecha(c.vence) : ''}</span></div>
      </div>
      <table class="fact-lineas">
        ${c.lineas.map(l => `<tr>
          <td>${esc(l.descripcion)}${l.cantidad > 1 ? ` <span class="muted">×${l.cantidad}</span>` : ''}</td>
          <td class="num">${fmtMoneda(l.cantidad * l.precio, t)}</td></tr>`).join('')}
        <tr class="fact-total"><td>Total</td><td class="num">${fmtMoneda(c.total, t)}</td></tr>
      </table>
      ${(() => {
        const ep = c.easypay && t === 'DOP' ? UI.calcularEasyPay(c.total, c.easypay.plan, c.easypay.meses) : null;
        return ep ? `<p class="muted" style="margin-top:8px">💳 ${esc(ep.nombre)}: reserva ${fmtMoneda(ep.reserva, t)} + ${ep.meses} × ${fmtMoneda(ep.cuota, t)}/mes</p>` : '';
      })()}
      ${c.facturaId ? `<p class="muted" style="margin-top:8px">✅ Convertida en factura.</p>` : ''}

      ${abierta ? `<button class="btn-gold btn-block" id="cConvertir" style="margin:14px 0 6px">🧾 Convertir en factura</button>` : ''}
      ${(abierta || esLeadCaliente(c)) ? `<button class="btn-ghost btn-block" id="cVincular" style="margin-bottom:6px">🔗 Ya se facturó — vincular la factura</button>` : ''}
      <h3 class="sub-h" style="margin-top:14px">📤 Enviar cotización</h3>
      <div class="row">
        <button class="btn-ghost btn-block" id="cImprimir">🖨 Imprimir</button>
        ${UI.tieneWhatsApp(cliente) ? `<button class="btn-ghost btn-block" id="cWhatsApp">💬 WhatsApp</button>` : ''}
        ${cliente && cliente.correo ? `<button class="btn-ghost btn-block" id="cCorreo">✉️ Correo</button>` : ''}
      </div>
      ${(abierta || esLeadCaliente(c)) && cliente && (UI.tieneWhatsApp(cliente) || cliente.correo) ? `
      <h3 class="sub-h" style="margin-top:14px">🤝 Seguimiento ${esLeadCaliente(c) ? '(¡lead caliente — a cerrar!)' : '(mensaje suave)'}${
        (c.seguimientos || []).length
          ? ` <span class="muted" style="text-transform:none;letter-spacing:0">· último: ${fmtFecha(c.seguimientos[c.seguimientos.length - 1].fecha)} por ${esc(c.seguimientos[c.seguimientos.length - 1].via)}</span>`
          : ''}</h3>
      <div class="row">
        ${UI.tieneWhatsApp(cliente) ? `<button class="btn-ghost btn-block" id="cSegWA">💬 WhatsApp</button>` : ''}
        ${cliente.correo ? `<button class="btn-ghost btn-block" id="cSegCorreo">✉️ Correo</button>` : ''}
      </div>` : ''}
      <div class="row" style="margin-top:10px;align-items:flex-end">
        <div style="flex:1"><label>Estado</label>
          <select id="cEstado">
            ${['borrador', 'enviada', 'aceptada', 'rechazada', 'vencida'].map(e =>
              `<option value="${e}" ${estadoDe(c) === e ? 'selected' : ''}>${e.charAt(0).toUpperCase() + e.slice(1)}</option>`).join('')}
          </select></div>
        <button class="btn-ghost btn-block" id="cEditar" style="flex:1">✏️ Editar</button>
      </div>
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };

    on('#cConvertir', async () => {
      const epConv = c.easypay && t === 'DOP' ? UI.calcularEasyPay(c.total, c.easypay.plan, c.easypay.meses) : null;
      if (!confirm(`¿Convertir la cotización COT-${c.numero} en factura?${epConv ? ` Incluirá el plan ${epConv.nombre}.` : ''} Se creará con el próximo NCF.`)) return;
      const numero = await Facturas.siguienteNumero();
      const orden = await Facturas.siguienteOrden();
      const hoyIso = UI.fechaISO();
      const lineasF = c.lineas.map(l => ({ ...l }));
      if (epConv && epConv.fee) {
        lineasF.push({ descripcion: `${Facturas.FEE_DESC} (${epConv.meses} cuotas × RD$${epConv.fee})`, cantidad: epConv.meses, precio: epConv.fee });
      }
      const totalF = epConv ? epConv.totalConTarifas : c.total;
      let planPago = null, proxCobro = null;
      if (epConv) {
        // La reserva queda como primera cuota (hoy); luego las mensuales
        const primeraMensual = (() => {
          const d = new Date(); const dia = d.getDate();
          d.setDate(1); d.setMonth(d.getMonth() + 1);
          d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
          return UI.fechaISO(d);
        })();
        planPago = {
          tipo: 'easypay', plan: epConv.plan, fee: epConv.fee, inicial: 0, frecuencia: 'mensual',
          cuotas: [{ fecha: hoyIso, monto: epConv.reserva },
                   ...Facturas.generarCuotas(totalF, epConv.reserva, epConv.meses, 'mensual', primeraMensual)],
        };
        proxCobro = { fecha: hoyIso, monto: epConv.reserva };
      }
      const fact = await DB.facturas.upsert({
        numero, ncf: numero, orden,
        clienteId: c.clienteId, clienteNombre: c.clienteNombre,
        fecha: hoyIso,
        moneda: t, lineas: lineasF,
        impuesto: 0, total: totalF, saldo: totalF,
        estado: 'pendiente', notas: `Según cotización COT-${c.numero}`, abonos: [],
        ...(planPago ? { planPago, proxCobro } : {}),
      });
      c.estado = 'aceptada'; c.facturaId = fact.id;
      await DB.cotizaciones.upsert(c);
      cerrarModal();
      toast(`Factura #${orden} · ${numero} creada desde la cotización`);
      if (Confecciones.esDeConfeccion(fact)) Confecciones.pactar(fact, () => Facturas.detalle(fact.id));
      else Facturas.detalle(fact.id);
    });

    /* La factura ya existe (se hizo a mano): elegirla y quedar vinculada */
    on('#cVincular', async () => {
      const facts = (await DB.facturas.list())
        .filter(f => f.clienteId === c.clienteId && f.estado !== 'anulada')
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 8);
      const reclamadas = new Set((await DB.cotizaciones.list()).map(x => x.facturaId).filter(Boolean));
      abrirModal(`Vincular COT-${c.numero} a su factura`, `
        <p class="muted" style="margin-bottom:12px">Elige la factura que nació de esta cotización — quedará marcada como cerrada y contará en la conversión:</p>
        ${facts.map(f => `
          <div class="item vinc-f" data-fid="${f.id}" style="cursor:pointer">
            <div class="item-info">
              <div class="item-name">${esc(f.orden ? '#' + f.orden : (f.numero || 's/n'))}${reclamadas.has(f.id) ? ' <span class="muted">(ya vinculada a otra)</span>' : ''}</div>
              <div class="item-sub">${fmtFecha(f.fecha)} · ${fmtMoneda(f.total, f.moneda)}</div>
            </div><span class="item-arrow">›</span>
          </div>`).join('') || '<p class="muted">Este cliente no tiene facturas todavía.</p>'}
        <button class="btn-ghost btn-block" id="vVolver" style="margin-top:12px">← Volver a la cotización</button>
      `);
      UI.$$('.vinc-f').forEach(el => el.addEventListener('click', async () => {
        c.facturaId = el.dataset.fid;
        c.estado = 'aceptada';
        await DB.cotizaciones.upsert(c);
        toast(`🔗 COT-${c.numero} vinculada — ya cuenta como cerrada`);
        render();
        detalle(c.id);
      }));
      $('#vVolver').addEventListener('click', () => detalle(c.id));
    });

    on('#cImprimir', () => imprimir(c, cliente));
    on('#cWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      const fechaLarga = new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' });
      const lineasTxt = c.lineas.map((l, i) =>
        `${i === 0 ? '💍' : '💎'} ${l.cantidad > 1 ? l.cantidad + ' × ' : ''}${l.descripcion}`).join('\n');
      let precioTxt = fmtMoneda(c.total, t);
      const tasa = typeof Calculadora !== 'undefined' ? Calculadora.tasaActual() : 0;
      if (t === 'DOP' && tasa > 0) {
        const usd = (c.total / tasa).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        precioTxt += ` (≈ $${usd} USD)`;
      }
      const msg =
        `✨ *${emp.nombre} — Cotización COT-${c.numero}*\n📅 ${fechaLarga}\n\n` +
        `Hola ${c.clienteNombre} 👋 Le saluda *${UI.quienSaluda(emp)}* ✨\n` +
        `Gracias por tu interés. Aquí tienes tu cotización:\n\n` +
        `${lineasTxt}\n` +
        `${c.peso ? `⚖️ Peso aprox.: ${c.peso} g\n` : ''}\n` +
        `💰 *Precio: ${precioTxt}*\n` +
        `📌 *Forma de pago:* 70% para iniciar su pieza y 30% a la entrega.\n\n` +
        (() => {
          const ep = c.easypay && t === 'DOP' ? UI.calcularEasyPay(c.total, c.easypay.plan, c.easypay.meses) : null;
          if (!ep) return '';
          const hoy = new Date();
          const cuotasTxt = Array.from({ length: ep.meses }, (_, i) => {
            const d = new Date(hoy.getFullYear(), hoy.getMonth() + i + 1, 1);
            const mes = d.toLocaleDateString('es-DO', d.getFullYear() !== hoy.getFullYear()
              ? { month: 'long', year: 'numeric' } : { month: 'long' });
            return `▪ Cuota ${i + 1} · ${mes}: ${fmtMoneda(ep.cuota, t)}`;
          }).join('\n');
          return `💳 *Págalo con ${ep.nombre} — sin intereses*\n` +
            `▪ Reserva hoy: *${fmtMoneda(ep.reserva, t)}*\n` +
            `${cuotasTxt}\n` +
            `💵 Total del plan: *${fmtMoneda(ep.totalConTarifas, t)}*` +
            `${ep.fee ? ` (incluye RD$${ep.fee} de tarifa administrativa por cuota)` : ''}\n` +
            `📦 Su pieza se entrega al saldar el plan por completo.\n\n`;
        })() +
        `Si lo prefiere, podemos ajustar el peso de la pieza para llevarla a su presupuesto — solo díganos 😊\n` +
        `⚠️ Tome en cuenta: reducir el peso puede restarle integridad estructural a la pieza y podría invalidar la garantía de por vida.\n\n` +
        `${c.vence ? `Cotización válida hasta el ${fmtFecha(c.vence)}. ` : ''}Precio sujeto a cambio según el precio internacional del oro.\n\n` +
        `📄 ¿Prefiere su cotización en PDF por correo? Con gusto se la enviamos — solo díganos.\n\n` +
        `${emp.direccion ? '📍 ' + emp.direccion + '\n' : ''}📞 ${emp.telefono} · ${emp.web}`;
      UI.abrirWhatsApp(cliente, msg);
    });
    on('#cCorreo', async () => {
      const emp = await UI.getEmpresa();
      const asunto = `Cotización COT-${c.numero} — ${emp.nombre}`;
      const cuerpo = `Hola ${c.clienteNombre},\n\nLe saluda ${UI.quienSaluda(emp)}. Gracias por su interés — le adjuntamos su cotización COT-${c.numero}` +
        `${c.vence ? `, válida hasta el ${fmtFecha(c.vence)}` : ''}.\n\n` +
        `Si tiene alguna duda o le gustaría ajustar algo de la pieza, estamos a la orden para ayudarle con gusto.\n\n` +
        `${emp.nombre} · ${emp.web}\n${emp.direccion || ''}\nTel. ${emp.telefono}`;
      toast('Generando el PDF de la cotización…');
      const modo = await PDFDoc.enviarPorCorreo('cotizacion', c, cliente, cuerpo, asunto);
      if (modo === 'descargado') toast('📄 PDF descargado — adjúntalo al correo que se abrió');
      if (modo === 'compartido' && cliente.correo) toast(`✉️ ${cliente.correo} copiado — pégalo en "Para:"`);
    });
    /* Seguimiento suave: saludo sin presión, se registra con fecha y vía */
    const mensajeSeguimiento = emp => mensajeSeguimientoDe(c, emp);

    const registrarSeguimiento = async via => {
      c.seguimientos = [...(c.seguimientos || []), { fecha: UI.fechaISO(), via }];
      await DB.cotizaciones.upsert(c);
      toast(`🤝 Seguimiento por ${via} registrado`);
      render();
    };

    on('#cSegWA', async () => {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp(cliente, mensajeSeguimiento(emp));
      await registrarSeguimiento('WhatsApp');
      detalle(c.id);
    });
    on('#cSegCorreo', async () => {
      const emp = await UI.getEmpresa();
      const asunto = `¿Alguna duda con su cotización? — ${emp.nombre}`;
      location.href = `mailto:${cliente.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensajeSeguimiento(emp).replace(/\*/g, ''))}`;
      await registrarSeguimiento('correo');
      detalle(c.id);
    });

    on('#cEditar', () => formulario(c));
    $('#cEstado').addEventListener('change', async e => {
      c.estado = e.target.value;
      c.estadoManual = UI.fechaISO();
      await DB.cotizaciones.upsert(c);
      toast(`Estado cambiado a ${e.target.value}`);
      render();
      detalle(c.id);   // refresca el modal (botones según el nuevo estado)
    });
  }

  /* ── Crear / editar ── */
  async function formulario(c) {
    const esNueva = !c || !c.id;
    c = c || {};
    const numero = c.numero || await siguienteNumero();
    const productos = await DB.productos.list();
    let lineas = c.lineas ? c.lineas.map(l => ({ ...l })) : [{ descripcion: '', cantidad: 1, precio: '' }];
    let clienteSel = c.clienteId ? await DB.clientes.get(c.clienteId) : null;

    const en5dias = UI.fechaISO(new Date(Date.now() + 5 * 864e5));

    abrirModal(esNueva ? 'Nueva cotización' : `Editar COT-${c.numero}`, `
      <form id="formCot">
        <div class="row"><div>
          <label>Cliente *</label>
          <input id="cotCliBuscar" autocomplete="off" placeholder="Escribe para buscar…" value="${esc(clienteSel ? clienteSel.nombre : '')}">
          <div id="cotCliSug" class="sugerencias" hidden></div>
        </div></div>
        <div class="row">
          <div><label>Número</label><input name="numero" value="${esc(String(numero))}"></div>
          <div><label>Fecha</label><input name="fecha" type="date" value="${c.fecha || UI.fechaISO()}"></div>
        </div>
        <div class="row">
          <div><label>Válida hasta</label><input name="vence" type="date" value="${c.vence || en5dias}"></div>
          <div><label>Moneda</label>
            <select name="moneda">
              <option value="DOP" ${c.moneda !== 'USD' ? 'selected' : ''}>RD$ (DOP)</option>
              <option value="USD" ${c.moneda === 'USD' ? 'selected' : ''}>US$ (USD)</option>
            </select></div>
          <div><label>Peso aprox. (g)</label><input name="peso" type="number" step="0.01" min="0" value="${c.peso ?? ''}" placeholder="opcional"></div>
        </div>
        <div class="row">
          <div><label>Plan EasyPay (opcional — va en el mensaje)</label>
            <select name="cepPlan">
              <option value="">Sin plan EasyPay</option>
              <option value="4m" ${c.easypay && c.easypay.plan === '4m' ? 'selected' : ''}>4 meses — 25% reserva · sin cargos</option>
              <option value="6m" ${c.easypay && c.easypay.plan === '6m' ? 'selected' : ''}>6 meses — 20% + RD$300/cuota</option>
              <option value="612m" ${c.easypay && c.easypay.plan === '612m' ? 'selected' : ''}>6 a 12 meses — 15% + RD$500/cuota</option>
            </select></div>
          <div><label>Meses</label><input name="cepMeses" type="number" min="2" max="12" step="1" value="${c.easypay ? c.easypay.meses : 4}"></div>
        </div>
        <label>Líneas</label>
        <div id="cotLineasCont"></div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="btn-ghost btn-sm" id="cotAddLinea">+ Línea libre</button>
          <div style="flex:1;position:relative">
            <input id="cotAddProdBuscar" placeholder="🛍 Del catálogo…" autocomplete="off">
            <div id="cotAddProdSug" class="sugerencias" hidden></div>
          </div>
        </div>
        <div class="fact-preview" id="cotPreview"></div>
        <button type="submit" class="btn-gold btn-block">${esNueva ? 'Crear cotización' : 'Guardar cambios'}</button>
      </form>
    `);

    UI.buscadorCliente($('#cotCliBuscar'), $('#cotCliSug'), c => { clienteSel = c; });

    function pintar() {
      const cont = $('#cotLineasCont');
      cont.innerHTML = lineas.map((l, i) => `
        <div class="linea-row">
          <input placeholder="Descripción" data-i="${i}" data-k="descripcion" value="${esc(l.descripcion)}">
          <input type="number" min="1" step="1" data-i="${i}" data-k="cantidad" value="${l.cantidad}">
          <input type="number" min="0" step="0.01" placeholder="Precio" data-i="${i}" data-k="precio" value="${l.precio}">
          <button type="button" class="btn-x" data-del="${i}">✕</button>
        </div>`).join('');
      cont.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        lineas[inp.dataset.i][inp.dataset.k] = inp.value; preview();
      }));
      cont.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        lineas.splice(Number(b.dataset.del), 1);
        if (!lineas.length) lineas.push({ descripcion: '', cantidad: 1, precio: '' });
        pintar();
      }));
      preview();
    }
    function preview() {
      const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
      $('#cotPreview').innerHTML = `Total: <b class="dorado">${fmtMoneda(total, $('#formCot').moneda.value)}</b>`;
    }
    $('#cotAddLinea').addEventListener('click', () => { lineas.push({ descripcion: '', cantidad: 1, precio: '' }); pintar(); });
    UI.buscadorCatalogo($('#cotAddProdBuscar'), $('#cotAddProdSug'), item => {
      const m = $('#formCot').moneda.value;
      let precio = item.precio;
      if (item.moneda && item.moneda !== m) {
        const tasa = typeof Calculadora !== 'undefined' ? Calculadora.tasaActual() : 0;
        if (tasa) {
          precio = Math.round((m === 'DOP' ? precio * tasa : precio / tasa) * 100) / 100;
          toast(`Convertido de ${item.moneda} a ${m} (tasa ${tasa})`);
        }
      }
      lineas.push({ descripcion: item.descripcion, cantidad: 1, precio });
      pintar();
    });
    $('#formCot').moneda.addEventListener('change', preview);
    pintar();

    $('#formCot').addEventListener('submit', async e => {
      e.preventDefault();
      if (!clienteSel) { toast('Selecciona un cliente de la lista'); return; }
      const fd = new FormData(e.target);
      const lineasOk = lineas
        .map(l => ({ ...l, descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad) || 1, precio: Number(l.precio) || 0 }))
        .filter(l => l.descripcion && l.precio > 0);
      if (!lineasOk.length) { toast('Agrega al menos una línea con precio'); return; }
      const total = lineasOk.reduce((s, l) => s + l.cantidad * l.precio, 0);
      await DB.cotizaciones.upsert({
        id: c.id,
        numero: fd.get('numero').trim(),
        clienteId: clienteSel.id,
        clienteNombre: clienteSel.nombre,
        fecha: fd.get('fecha'),
        vence: fd.get('vence'),
        moneda: fd.get('moneda'),
        peso: Number(fd.get('peso')) || null,
        easypay: fd.get('cepPlan')
          ? { plan: fd.get('cepPlan'), meses: Math.round(Number(fd.get('cepMeses')) || 4) }
          : null,
        lineas: lineasOk,
        total: Math.round(total * 100) / 100,
        estado: c.estado && c.estado !== 'pendiente' ? c.estado : 'enviada',
      });
      cerrarModal();
      toast(esNueva ? `Cotización COT-${fd.get('numero')} creada` : 'Cotización actualizada');
      render();
    });
  }

  /* ── Imprimir ── */
  async function imprimir(c, cliente) {
    const t = c.moneda || 'DOP';
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
        <div><b>COTIZACIÓN</b> COT-${esc(String(c.numero || ''))}<br>
        Fecha: ${fmtFecha(c.fecha)}${c.vence ? `<br>Válida hasta: ${fmtFecha(c.vence)}` : ''}</div>
        <div style="text-align:right"><b>${esc(c.clienteNombre)}</b><br>
        ${cliente && cliente.telefono ? esc(cliente.telefono) + '<br>' : ''}${cliente && cliente.correo ? esc(cliente.correo) : ''}</div>
      </div>
      <table class="p-tabla">
        <tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr>
        ${c.lineas.map(l => `<tr><td>${esc(l.descripcion)}</td><td class="num">${l.cantidad}</td>
          <td class="num">${fmtMoneda(l.precio, t)}</td><td class="num">${fmtMoneda(l.cantidad * l.precio, t)}</td></tr>`).join('')}
      </table>
      <div class="p-total"><span>TOTAL</span><span>${fmtMoneda(c.total, t)}</span></div>
      <div class="p-nota">Esta cotización no es una factura. Precios sujetos a cambio después de la fecha de validez.</div>
      ${emp.pie ? `<div class="p-pie">${esc(emp.pie)}</div>` : ''}
    `;
    await UI.imprimirArea();
  }

  function init() {
    $('#btnNuevaCot').addEventListener('click', () => formulario());
    $('#buscarCot').addEventListener('input', e => { filtro = e.target.value.trim(); render(); });
    $('#filtroEstadoCot').addEventListener('change', e => { filtroEstado = e.target.value; render(); });
    $('#listaCotizaciones').addEventListener('click', e => {
      const item = e.target.closest('.item[data-id]');
      if (item) detalle(item.dataset.id);
    });
  }

  return { init, render, detalle, formulario, seguimientoRapido };
})();
