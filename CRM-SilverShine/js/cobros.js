/* ═══════════════════════════════════════════════════════════
   cobros.js — Módulo de cobros: facturas pendientes por
   urgencia, plan de próximo cobro y recordatorios.
   ═══════════════════════════════════════════════════════════ */
const Cobros = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  const hoyISO = () => UI.fechaISO();
  let modo = 'pendientes';    // 'pendientes' (por cobrar) · 'recibidos' (con su cuenta)
  let rangoRec = 'mes';       // filtro de fecha de los recibidos

  /* Urgencia de un cobro:
     - Con próximo cobro programado: vencido si la fecha ya pasó.
     - Sin programar: vencido si la factura tiene más de 30 días. */
  function clasificar(f) {
    const hoy = hoyISO();
    const en7 = UI.fechaISO(new Date(Date.now() + 7 * 864e5));
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

  /* ── Etapa de cobro (secuencia escalonada del informe) ──
     El tono del recordatorio lo decide el atraso, no el usuario:
     previo (aún no vence) → hoy → firme (1-6d) → urgente (7-13d,
     mejor llamar) → escalada (14+d, proponer acuerdo de pago). */
  function etapaDe(f) {
    const ref = (f.proxCobro && f.proxCobro.fecha) || f.fecha;
    const dias = Math.round((new Date(hoyISO() + 'T00:00:00') - new Date(ref + 'T00:00:00')) / 864e5);
    if (dias < 0)   return { id: 'previo',   dias, ref, nombre: `😊 Previo — vence ${fmtFecha(ref)}` };
    if (dias === 0) return { id: 'hoy',      dias, ref, nombre: '📅 Vence hoy' };
    if (dias < 7)   return { id: 'firme',    dias, ref, nombre: `🟠 Firme — ${dias} día${dias === 1 ? '' : 's'} de atraso` };
    if (dias < 14)  return { id: 'urgente',  dias, ref, nombre: `🔴 Urgente — ${dias} días (mejor llamar)` };
    return { id: 'escalada', dias, ref, nombre: `⚠️ Escalada — ${dias} días (proponer acuerdo)` };
  }

  /* Mensaje de recordatorio: el tono escala solo según la etapa */
  const mensajeRecordatorio = (f, emp) => {
    const t = f.moneda || 'DOP';
    const e = etapaDe(f);
    const queCosa = f.planPago ? 'cuota EasyPay' : 'abono acordado';
    const monto = f.proxCobro && f.proxCobro.monto ? fmtMoneda(f.proxCobro.monto, t) : fmtMoneda(f.saldo, t);
    const refLinea = `🧾 Factura ${f.orden ? '#' + f.orden : (f.numero || '')} · balance pendiente *${fmtMoneda(f.saldo, t)}*`;
    const saludo = `Hola ${f.clienteNombre}, le saluda *${UI.quienSaluda(emp)}* ✨\n\n`;
    const cuentas = emp.cuentas ? `\n\n*Cuentas para su pago:*\n\n${emp.cuentas}` : '';
    const pie = `\n\nTambién puede pagar con tarjeta o EasyPay en la tienda. ¡Gracias!\n💎 ${emp.nombre} · ${emp.web}`;

    const cuerpos = {
      previo:  `Le recordamos con cariño que su ${queCosa} de *${monto}* vence el *${fmtFecha(e.ref)}* 😊\n${refLinea}`,
      hoy:     `Hoy vence su ${queCosa} de *${monto}*.\n${refLinea}`,
      firme:   `Su ${queCosa} de *${monto}* quedó pendiente desde el ${fmtFecha(e.ref)} — ¿le llegó nuestro recordatorio?\n${refLinea}\n\nSi ya realizó el pago, haga caso omiso de este mensaje 🙏`,
      urgente: `Su cuenta presenta *${e.dias} días de atraso* en su ${queCosa} de *${monto}*.\n${refLinea}\n\nNos gustaría ayudarle a ponerse al día — si tiene algún inconveniente, escríbanos con confianza y buscamos juntos una solución.`,
      escalada:`Su cuenta acumula *${e.dias} días de atraso*.\n${refLinea}\n\nQueremos ayudarle a regularizarla: podemos acordar un *plan de pago a su medida* — respóndanos este mensaje o pase por la tienda y lo cuadramos en minutos. Mantener su cuenta al día conserva activa su garantía y sus beneficios EasyPay.`,
    };
    return saludo + cuerpos[e.id] + cuentas + pie;
  };

  /* Recordatorio en 1 toque desde Mi Día: envía, lo anota y sale */
  async function recordatorioRapido(facturaId) {
    const f = await DB.facturas.get(facturaId);
    if (!f) return false;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    if (!UI.tieneWhatsApp(cliente)) { detalle(facturaId); return false; }
    const emp = await UI.getEmpresa();
    UI.abrirWhatsApp(cliente, mensajeRecordatorio(f, emp));
    /* NO se anota nada solo por abrir el mensaje: el usuario decide
       cuándo quedó enviado (⋯ → "Ya le escribí") — la fila no se mueve */
    toast('💬 Recordatorio listo — cuando lo envíes, márcalo con ⋯');
    return true;
  }

  /* ── Lista ── */
  async function render() {
    $('#cobrosTabs').innerHTML = `
      <button class="chip-tab ${modo === 'pendientes' ? 'on' : ''}" data-modo="pendientes">💰 Por cobrar</button>
      <button class="chip-tab ${modo === 'easypay' ? 'on' : ''}" data-modo="easypay">📅 EasyPay</button>
      <button class="chip-tab ${modo === 'recibidos' ? 'on' : ''}" data-modo="recibidos">💵 Recibidos · por cuenta</button>`;
    UI.$$('#cobrosTabs .chip-tab').forEach(b => b.addEventListener('click', () => {
      modo = b.dataset.modo;
      render();
    }));
    if (modo === 'recibidos') return renderRecibidos();
    if (modo === 'easypay') return renderEasyPay();

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

    /* Antigüedad de la deuda: dónde está el dinero en la calle.
       Una deuda de 90+ días no se gestiona igual que una de 10. */
    const hoyMs = new Date(hoyISO() + 'T00:00:00').getTime();
    const edadDe = f => Math.floor((hoyMs - new Date((f.fecha || hoyISO()) + 'T00:00:00').getTime()) / 864e5);
    const tramo = { a: 0, b: 0, c: 0, d: 0 };
    for (const f of lista) {
      const e = edadDe(f);
      if (e <= 30) tramo.a += f.saldo;
      else if (e <= 60) tramo.b += f.saldo;
      else if (e <= 90) tramo.c += f.saldo;
      else tramo.d += f.saldo;
    }
    $('#cobrosAgingTitulo').textContent = 'Antigüedad de la deuda';
    $('#cobrosAging').innerHTML =
      UI.statTile(UI.fmtDinero(tramo.a), '0–30 días') +
      UI.statTile(UI.fmtDinero(tramo.b), '31–60 días') +
      UI.statTile(UI.fmtDinero(tramo.c), '61–90 días', tramo.c > 0 ? 'rojo' : '') +
      UI.statTile(UI.fmtDinero(tramo.d), 'Más de 90 días', tramo.d > 0 ? 'rojo' : '');

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

  /* ── EasyPay: SOLO los planes, tipo tablero de pastillas ──
     Cada plan es una fila estilo Monday (mismo componente tb-* de
     Mi Día) agrupada por urgencia; tocarla abre el desglose completo
     cuota por cuota con su status, lo pagado y lo que falta. */
  const PLAN_NOMBRE = p =>
    (p.plan && UI.EASYPAY_PLANES[p.plan] && UI.EASYPAY_PLANES[p.plan].nombre) || 'Plan personalizado';

  /* Radiografía del plan: cuotas con estado + cuánto FALTA de cada una
     (una cuota pagada a medias muestra solo el resto), cuál toca y el
     atraso en días de la que toca. */
  function radiografiaPlan(f) {
    const p = f.planPago;
    const cuotas = p.cuotas && p.cuotas.length ? Facturas.cuotasConEstado(f) : [];
    const pagado = Math.round(((f.total || 0) - (f.saldo || 0)) * 100) / 100;
    let antes = Number(p.inicial) || 0;
    for (const c of cuotas) {
      const despues = Math.round((antes + c.monto) * 100) / 100;
      c.falta = Math.max(0, Math.round((despues - Math.max(pagado, antes)) * 100) / 100);
      antes = despues;
    }
    const prox = cuotas.find(c => !c.cubierta) || null;
    const dias = prox
      ? Math.round((new Date(hoyISO() + 'T00:00:00') - new Date(prox.fecha + 'T00:00:00')) / 864e5)
      : null;
    return {
      cuotas, prox, dias, pagado,
      cubiertas: cuotas.filter(c => c.cubierta).length,
      vencidas: cuotas.filter(c => c.vencida).length,
    };
  }

  /* Pastilla de estado del plan (colores del tablero) */
  function pastillaPlan(r) {
    if (!r.cuotas.length) return { t: '🗓 Cuotas por programar', c: 'var(--tb-gris)' };
    if (!r.prox) return { t: '✅ Cuotas al día', c: 'var(--tb-verde)' };
    if (r.dias > 0) return { t: `🔴 Atrasado ${r.dias} d${r.vencidas > 1 ? ' · ' + r.vencidas + ' cuotas' : ''}`, c: 'var(--tb-rojo)' };
    if (r.dias === 0) return { t: '📅 Cuota HOY', c: 'var(--tb-naranja)' };
    if (r.dias >= -7) return { t: `🟠 Cuota en ${-r.dias} d`, c: 'var(--tb-ambar)' };
    return { t: '🟢 Al día', c: 'var(--tb-verde)' };
  }

  async function renderEasyPay() {
    const cont = $('#listaCobros');
    const todas = (await DB.facturas.list()).filter(f => f.planPago && f.estado !== 'anulada');
    const activos = todas.filter(f => f.estado === 'pendiente' && f.saldo > 0);
    const saldados = todas.filter(f => !(f.estado === 'pendiente' && f.saldo > 0))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 15);

    const info = new Map();
    for (const f of [...activos, ...saldados]) info.set(f.id, radiografiaPlan(f));

    const porCobrar = activos.reduce((s, f) => s + f.saldo, 0);
    const totalPlanes = activos.reduce((s, f) => s + (f.total || 0), 0);
    const cobrado = totalPlanes - porCobrar;
    const cuotasVencidas = activos.reduce((s, f) => s + info.get(f.id).vencidas, 0);

    $('#cobrosResumen').innerHTML =
      UI.statTile(activos.length, 'Planes activos') +
      UI.statTile(cuotasVencidas, 'Cuotas vencidas', cuotasVencidas > 0 ? 'rojo' : 'verde') +
      UI.statTile(UI.fmtDinero(porCobrar), 'Por cobrar EasyPay') +
      UI.statTile(totalPlanes > 0 ? Math.round(cobrado / totalPlanes * 100) + '%' : '—', 'Cobrado de los planes activos');

    /* Calendario de cuotas: cuándo DEBE entrar el dinero */
    const hoy = hoyISO();
    const en7 = UI.fechaISO(new Date(Date.now() + 7 * 864e5));
    const en30 = UI.fechaISO(new Date(Date.now() + 30 * 864e5));
    const cal = { atras: 0, semana: 0, mes: 0, luego: 0 };
    for (const f of activos) {
      const r = info.get(f.id);
      if (!r.cuotas.length) { cal.luego += f.saldo; continue; }
      for (const c of r.cuotas) {
        if (!c.falta) continue;
        if (c.fecha < hoy) cal.atras += c.falta;
        else if (c.fecha <= en7) cal.semana += c.falta;
        else if (c.fecha <= en30) cal.mes += c.falta;
        else cal.luego += c.falta;
      }
    }
    $('#cobrosAgingTitulo').textContent = '📆 Cuándo debe entrar el dinero';
    $('#cobrosAging').innerHTML =
      UI.statTile(UI.fmtDinero(cal.atras), 'Atrasado', cal.atras > 0 ? 'rojo' : '') +
      UI.statTile(UI.fmtDinero(cal.semana), 'Próximos 7 días') +
      UI.statTile(UI.fmtDinero(cal.mes), 'Resto del mes') +
      UI.statTile(UI.fmtDinero(cal.luego), 'Más adelante');

    if (!todas.length) {
      cont.innerHTML = '<div class="empty"><span>📅</span>No hay facturas con plan EasyPay todavía — se crean al facturar con forma de pago EasyPay.</div>';
      return;
    }

    /* Fila estilo tablero: info · pastilla · monto · próxima cuota · acción */
    const filaEp = (f, saldado) => {
      const r = info.get(f.id);
      const pill = saldado ? { t: '✅ Saldado', c: 'var(--tb-verde)' } : pastillaPlan(r);
      const t = f.moneda || 'DOP';
      const prog = r.cuotas.length
        ? `Cuota ${Math.min(r.cubiertas + 1, r.cuotas.length)}/${r.cuotas.length}`
        : 'sin cuotas programadas';
      const cuando = saldado
        ? `completado · ${r.cubiertas}/${r.cuotas.length || '—'} cuotas`
        : r.prox
          ? `${prog} · cobrar <b>${fmtFecha(r.prox.fecha)}</b> (${fmtMoneda(r.prox.falta || r.prox.monto, t)})`
          : prog;
      return `
      <div class="tb-fila ep-fila" data-id="${f.id}">
        <div class="tb-info"><b>👤 ${esc(f.clienteNombre)}</b><span>${esc(PLAN_NOMBRE(f.planPago))} · ${esc(f.numero || 's/n')}${f.orden ? ' · #' + esc(String(f.orden)) : ''}</span></div>
        <div class="tb-pillc"><span class="tb-pill" style="background:${pill.c}">${pill.t}</span></div>
        <div class="tb-monto"><b class="${!saldado && r.dias > 0 ? 'rojo' : ''}">${saldado ? fmtMoneda(f.total, t) : fmtMoneda(f.saldo, t)}</b></div>
        <div class="tb-fecha ${!saldado && r.dias > 0 ? 'rojo' : ''}"><span>${cuando}</span></div>
        <div class="tb-acc">${saldado ? '<span class="verde" style="font-size:1.1rem">✓</span>'
          : `<button type="button" class="btn-gold btn-sm ep-wa" data-wa="${f.id}" title="Recordatorio por WhatsApp">💬</button>`}</div>
      </div>`;
    };

    const grupoEp = (titulo, color, arr, saldado = false, plegado = false) => !arr.length ? '' : `
      <section class="tb-grupo ${plegado ? 'plegado' : ''}" style="--tbc:${color}">
        <div class="tb-cab" tabindex="0"><span class="tb-caret">▼</span><b style="color:${color}">${titulo}</b><span class="tb-n">${arr.length}${
          saldado ? '' : ` · ${UI.fmtDinero(arr.reduce((s, f) => s + f.saldo, 0))}`}</span></div>
        <div class="tb-cuerpo">
          <div class="tb-encab"><div>Cliente / plan</div><div>Estado</div><div>Debe</div><div>Próxima cuota</div><div style="text-align:right">Acción</div></div>
          ${arr.map(f => filaEp(f, saldado)).join('')}
          <div class="tb-pie">
            <div>${arr.length} ${arr.length === 1 ? 'plan' : 'planes'}</div>
            <div><span class="tb-bat">${arr.map(f => { const r = info.get(f.id); const pc = saldado ? 100 : (f.total > 0 ? (f.total - f.saldo) / f.total * 100 : 0); return `<i style="background:${pc >= 99.9 ? 'var(--tb-verde)' : r.dias > 0 ? 'var(--tb-rojo)' : 'var(--tb-azul)'};width:${(100 / arr.length).toFixed(2)}%"></i>`; }).join('')}</span></div>
            <div class="tb-monto">${saldado ? '' : UI.fmtDinero(arr.reduce((s, f) => s + f.saldo, 0))}</div>
            <div></div><div></div>
          </div>
        </div>
      </section>`;

    const porDias = (a, b) => (info.get(b.id).dias ?? -999) - (info.get(a.id).dias ?? -999);
    const con = filtro => activos.filter(filtro).sort(porDias);
    const vencidos = con(f => { const r = info.get(f.id); return r.prox && r.dias > 0; });
    const semana = con(f => { const r = info.get(f.id); return r.prox && r.dias <= 0 && r.dias >= -7; });
    const alDia = con(f => { const r = info.get(f.id); return r.cuotas.length && (!r.prox || r.dias < -7); });
    const sinCuotas = con(f => !info.get(f.id).cuotas.length);

    cont.innerHTML =
      grupoEp('🔴 Cuota vencida — cobrar YA', 'var(--tb-rojo)', vencidos) +
      grupoEp('🟠 Cuota hoy o esta semana', 'var(--tb-naranja)', semana) +
      grupoEp('🗓 Cuotas por programar', 'var(--tb-ambar)', sinCuotas) +
      grupoEp('🟢 Al día — cuota más adelante', 'var(--tb-verde)', alDia) +
      grupoEp('✅ Planes saldados (últimos 15)', 'var(--tb-gris)', saldados, true, true);

    cont.querySelectorAll('.tb-cab').forEach(c =>
      c.addEventListener('click', () => c.closest('.tb-grupo').classList.toggle('plegado')));
    cont.querySelectorAll('.ep-fila').forEach(el =>
      el.addEventListener('click', () => desgloseEasy(el.dataset.id)));
    cont.querySelectorAll('.ep-wa').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); recordatorioRapido(b.dataset.wa); }));
  }

  /* ── Desglose completo de un plan EasyPay ── */
  async function desgloseEasy(id) {
    const f = await DB.facturas.get(id);
    if (!f || !f.planPago) return detalle(id);
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const t = f.moneda || 'DOP';
    const p = f.planPago;
    const r = radiografiaPlan(f);
    const saldado = !(f.estado === 'pendiente' && f.saldo > 0);
    const pct = f.total > 0 ? Math.min(100, Math.round(r.pagado / f.total * 100)) : 0;
    const pill = saldado ? { t: '✅ Saldado', c: 'var(--tb-verde)' } : pastillaPlan(r);
    const hoy = hoyISO();

    const nav = [
      cliente && { t: '👤 Cliente', on: () => Clientes.ficha(cliente.id) },
      { t: `🧾 Factura ${f.orden ? '#' + f.orden : f.numero || ''}`, on: () => Facturas.detalle(f.id) },
      { t: '💰 Gestión del cobro', on: () => detalle(f.id) },
    ].filter(Boolean);

    const cuotaFila = c => {
      const icono = c.cubierta ? '✅' : c.vencida ? '🔴' : (c.fecha === hoy ? '📅' : '⏳');
      const atraso = c.vencida
        ? Math.round((new Date(hoy + 'T00:00:00') - new Date(c.fecha + 'T00:00:00')) / 864e5) : 0;
      const marca = (!c.cubierta && r.prox && c.num === r.prox.num) ? ' <b class="dorado">← le toca</b>' : '';
      const parcial = (!c.cubierta && c.falta < c.monto - 0.005)
        ? ` <span class="muted">(abonada — faltan ${fmtMoneda(c.falta, t)})</span>` : '';
      return `<div class="abono-row">
        <span>${icono} Cuota ${c.num} · ${fmtFecha(c.fecha)}${marca}${atraso > 0 ? ` · <span class="rojo">${atraso} d de atraso</span>` : ''}</span>
        <b class="${c.cubierta ? 'verde' : c.vencida ? 'rojo' : ''}">${fmtMoneda(c.monto, t)}${parcial}</b>
      </div>`;
    };

    const abonos = (f.abonos || []).map(a => `<div class="abono-row">
        <span>${fmtFecha(a.fecha)} · ${esc(a.metodo || 'Pago')}${a.cuentaNombre ? ' · 🏦 ' + esc(a.cuentaNombre) : ''}</span>
        <b class="verde">+${fmtMoneda(a.monto, t)}</b>
      </div>`).join('') || '<p class="muted">Sin pagos registrados todavía.</p>';

    abrirModal(`📅 EasyPay — ${f.clienteNombre}`, `
      ${UI.navChips(nav)}
      ${saldado
        ? `<div class="deuda-banner" style="background:#E8F3E9;color:var(--green)">✅ Plan saldado — pagó <b>${fmtMoneda(f.total, t)}</b> completo</div>`
        : `<div class="deuda-banner">Debe <b>${fmtMoneda(f.saldo, t)}</b> de ${fmtMoneda(f.total, t)}</div>`}
      <div style="margin:10px 0 4px"><span class="tb-bat" style="max-width:none;width:100%;height:16px">
        <i style="background:var(--tb-verde);width:${pct}%"></i><i style="background:var(--border);width:${100 - pct}%"></i>
      </span></div>
      <p class="muted" style="margin-bottom:12px">Cobrado <b>${fmtMoneda(r.pagado, t)}</b> de ${fmtMoneda(f.total, t)} (<b>${pct}%</b>) ·
        <span class="tb-pill" style="background:${pill.c};display:inline-flex;width:auto;padding:2px 10px;height:auto">${pill.t}</span></p>

      <p class="muted" style="margin-bottom:12px">
        <b>${esc(PLAN_NOMBRE(p))}</b> · frecuencia ${esc(p.frecuencia || 'mensual')} · factura ${esc(f.numero || 's/n')} del ${fmtFecha(f.fecha)}<br>
        Reserva inicial: <b>${fmtMoneda(Number(p.inicial) || 0, t)}</b>${p.fee ? ` · tarifa RD$${p.fee}/cuota (incluida en las cuotas)` : ''}${
        r.prox && !saldado ? `<br>Próximo pago: <b>${fmtFecha(r.prox.fecha)}</b> por <b>${fmtMoneda(r.prox.falta || r.prox.monto, t)}</b>${
          r.dias > 0 ? ` — <span class="rojo"><b>${r.dias} días de atraso</b></span>` : r.dias === 0 ? ' — <b>HOY</b>' : ` (en ${-r.dias} días)`}` : ''}</p>

      <h3 class="sub-h">🗓 Cuotas del plan ${r.cuotas.length ? `(${r.cubiertas}/${r.cuotas.length} pagadas)` : ''}</h3>
      ${r.cuotas.length ? r.cuotas.map(cuotaFila).join('')
        : '<p class="muted">Este plan no tiene cuotas programadas — prográmalas desde 💰 Gestión del cobro.</p>'}

      <h3 class="sub-h" style="margin-top:14px">💵 Pagos recibidos</h3>
      ${abonos}

      ${saldado ? '' : `
      <button class="btn-gold btn-block" id="epAbonar" style="margin-top:14px">💵 Registrar pago de cuota</button>
      <div class="row" style="margin-top:10px">
        ${UI.tieneWhatsApp(cliente) ? '<button class="btn-ghost btn-block" id="epWhatsApp">💬 Recordar por WhatsApp</button>' : ''}
        <button class="btn-ghost btn-block" id="epGestion">📋 Gestión del cobro</button>
      </div>`}
    `);

    UI.navWire(nav);
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#epAbonar', () => Facturas.formAbono(f));
    on('#epGestion', () => detalle(f.id));
    on('#epWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      UI.abrirWhatsApp(cliente, mensajeRecordatorio(f, emp));
      f.ultimoRecordatorio = hoyISO();          // botón del detalle: sí registra
      await DB.facturas.upsert(f);
    });
  }

  /* ── Recibidos: todos los cobros con su cuenta bancaria ──
     Fuente: los abonos de las facturas (desde v94 guardan la cuenta
     elegida) + los pagos históricos de QuickBooks (sin cuenta). Los
     US$ se convierten con la tasa viva para los totales. */
  async function renderRecibidos() {
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = (m, mon) => (mon === 'USD' && tasa ? m * tasa : m) || 0;
    const facturas = (await DB.facturas.list()).filter(f => f.estado !== 'anulada');

    const movs = [];
    for (const f of facturas) {
      for (const a of (f.abonos || [])) {
        movs.push({ fecha: a.fecha, cliente: f.clienteNombre, ref: f.orden ? '#' + f.orden : (f.numero || ''),
          metodo: a.metodo || 'Pago', cuenta: a.cuentaNombre || null, monto: a.monto, moneda: f.moneda || 'DOP', fid: f.id });
      }
    }
    for (const p of (await DB.pagos.list()).filter(x => !x.facturaId && x.fecha)) {
      movs.push({ fecha: p.fecha, cliente: p.clienteNombre || '', ref: '',
        metodo: (p.metodo || 'Pago') + ' · QuickBooks', cuenta: null, monto: p.monto, moneda: 'DOP', fid: null });
    }

    const enR = movs.filter(m => UI.enRango(m.fecha, rangoRec))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const totalRD = enR.reduce((s, m) => s + conv(m.monto, m.moneda), 0);

    // Desglose por cuenta bancaria
    const porCuenta = new Map();
    for (const m of enR) {
      const k = m.cuenta || 'Sin cuenta asignada';
      porCuenta.set(k, (porCuenta.get(k) || 0) + conv(m.monto, m.moneda));
    }
    const cuentasOrden = [...porCuenta.entries()].sort((a, b) => b[1] - a[1]);
    const reales = cuentasOrden.filter(([n]) => n !== 'Sin cuenta asignada');
    const mayor = reales[0];

    $('#cobrosResumen').innerHTML =
      UI.statTile(UI.fmtDinero(totalRD), 'Recibido', 'verde') +
      UI.statTile(enR.length, 'Cobros') +
      UI.statTile(mayor ? UI.fmtDinero(mayor[1]) : '—', mayor ? `Mayor: ${mayor[0]}` : 'Mayor cuenta') +
      UI.statTile(reales.length, 'Cuentas usadas');

    $('#cobrosAgingTitulo').textContent = '🏦 Por cuenta bancaria';
    $('#cobrosAging').innerHTML = cuentasOrden.length
      ? cuentasOrden.map(([nombre, monto]) => UI.statTile(UI.fmtDinero(monto), nombre)).join('')
      : UI.statTile('—', 'Sin cobros en el rango');

    const cont = $('#listaCobros');
    cont.innerHTML = UI.chipsRango(rangoRec) + (enR.slice(0, 60).map((m, i) => `
      <div class="item rec-fila" data-fid="${m.fid || ''}" style="${m.fid ? 'cursor:pointer' : ''}">
        <div class="item-info">
          <div class="item-name">${esc(m.cliente)}${m.ref ? ` <span class="muted">${esc(m.ref)}</span>` : ''}</div>
          <div class="item-sub">${fmtFecha(m.fecha)} · ${esc(m.metodo)} · ${
            m.cuenta ? `🏦 <b>${esc(m.cuenta)}</b>` : '<span class="muted">sin cuenta asignada</span>'}</div>
        </div>
        <b class="verde">${fmtMoneda(m.monto, m.moneda)}</b>
      </div>`).join('') || '<div class="empty"><span>💵</span>Sin cobros en este rango.</div>') +
      (enR.length > 60 ? `<p class="muted" style="text-align:center;padding:10px">Mostrando 60 de ${enR.length} — el reporte 📤 de Finanzas los trae todos.</p>` : '');

    UI.$$('#listaCobros .chip-rango').forEach(b => b.addEventListener('click', () => {
      rangoRec = b.dataset.rango;
      render();
    }));
    UI.$$('#listaCobros .rec-fila[data-fid]').forEach(el => {
      if (el.dataset.fid) el.addEventListener('click', () => Facturas.detalle(el.dataset.fid));
    });
  }

  /* ── Detalle de cobro ── */
  async function detalle(id) {
    const f = await DB.facturas.get(id);
    if (!f) return;
    const cliente = f.clienteId ? await DB.clientes.get(f.clienteId) : null;
    const t = f.moneda || 'DOP';

    /* Navegación cruzada a los módulos enlazados */
    const nav = [
      cliente && { t: '👤 Cliente', on: () => Clientes.ficha(cliente.id) },
      { t: `🧾 Factura ${f.orden ? '#' + f.orden : f.numero || ''}`, on: () => Facturas.detalle(f.id) },
      f.confeccion && { t: '🧵 Confección', on: () => Confecciones.detalle(f.id) },
    ].filter(Boolean);

    abrirModal(`Cobro — ${f.clienteNombre}`, `
      ${UI.navChips(nav)}
      <div class="deuda-banner">Debe <b>${fmtMoneda(f.saldo, t)}</b> de ${fmtMoneda(f.total, t)} · ${esc(f.numero || 's/n')}</div>
      <p class="muted" style="margin-bottom:12px">Factura del ${fmtFecha(f.fecha)}.
        ${f.planPago ? '📅 <b>Plan EasyPay</b> (' + esc(f.planPago.frecuencia) + '). ' : ''}
        ${f.proxCobro && f.proxCobro.fecha ? `Próximo cobro: <b>${fmtFecha(f.proxCobro.fecha)}</b>${f.proxCobro.monto ? ' por ' + fmtMoneda(f.proxCobro.monto, t) : ''}.` : 'Sin próximo cobro programado.'}<br>
        Etapa de cobro: <b>${etapaDe(f).nombre}</b> — el mensaje de WhatsApp usa este tono automáticamente.</p>

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
    UI.navWire(nav);
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

  return { render, detalle, desgloseEasy, clasificar, pendientes, recordatorioRapido };
})();
