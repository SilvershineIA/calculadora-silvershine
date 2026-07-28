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

  /* ── Plan EasyPay: cuotas programadas ── */
  function generarCuotas(total, inicial, n, frecuencia, primerFecha) {
    const resto = Math.round((total - inicial) * 100) / 100;
    const base = Math.floor(resto / n * 100) / 100;
    const cuotas = [];
    const fecha = new Date(primerFecha + 'T00:00:00');
    let acum = 0;
    for (let i = 0; i < n; i++) {
      const monto = i === n - 1 ? Math.round((resto - acum) * 100) / 100 : base;
      acum = Math.round((acum + monto) * 100) / 100;
      cuotas.push({ fecha: fecha.toISOString().slice(0, 10), monto });
      if (frecuencia === 'semanal') fecha.setDate(fecha.getDate() + 7);
      else if (frecuencia === 'quincenal') fecha.setDate(fecha.getDate() + 15);
      else fecha.setMonth(fecha.getMonth() + 1);
    }
    return cuotas;
  }

  /* Poner proxCobro en la siguiente cuota no cubierta (según lo abonado) */
  function actualizarProxCobro(f) {
    if (!f.planPago || !f.planPago.cuotas) return;
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
    const hoy = new Date().toISOString().slice(0, 10);
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
    $('#factResumen').innerHTML = `
      <div class="stat"><div class="n">${fmtMoneda(porCobrar)}</div><div class="l">Por cobrar</div></div>
      <div class="stat"><div class="n">${pend.length}</div><div class="l">Facturas pendientes</div></div>
    `;

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

      ${f.planPago ? `
        <h3 class="sub-h">📅 Plan EasyPay (${esc(f.planPago.frecuencia)})</h3>
        ${f.planPago.inicial > 0 ? `<div class="abono-row"><span>Inicial</span><b class="verde">${fmtMoneda(f.planPago.inicial, t)} ✓</b></div>` : ''}
        ${cuotasConEstado(f).map(c => `<div class="abono-row">
          <span>${c.vencida ? '🔴' : c.cubierta ? '✅' : '•'} Cuota ${c.num} · ${fmtFecha(c.fecha)}</span>
          <b class="${c.vencida ? 'rojo' : c.cubierta ? 'verde' : ''}">${fmtMoneda(c.monto, t)}</b></div>`).join('')}` : ''}

      ${f.abonos && f.abonos.length ? `
        <h3 class="sub-h">Abonos registrados</h3>
        ${f.abonos.map(a => `<div class="abono-row"><span>${fmtFecha(a.fecha)} · ${esc(a.metodo)}</span><b>${fmtMoneda(a.monto, t)}</b></div>`).join('')}` : ''}

      ${f.estado === 'pendiente' && f.saldo > 0.005 ? `<button class="btn-gold btn-block" id="fAbonar" style="margin:14px 0 6px">💵 Registrar abono</button>` : ''}

      <div class="row" style="margin-top:12px">
        <button class="btn-ghost btn-block" id="fImprimir">🖨 Imprimir</button>
        ${cliente && cliente.telefono ? `<button class="btn-ghost btn-block" id="fWhatsApp">💬 WhatsApp</button>` : ''}
        ${cliente && cliente.correo ? `<button class="btn-ghost btn-block" id="fCorreo">✉️ Correo</button>` : ''}
      </div>
      <div class="row" style="margin-top:10px">
        ${f.estado === 'pendiente' && !(f.abonos || []).length && f.origen !== 'quickbooks' ? `<button class="btn-ghost btn-block" id="fEditar">✏️ Editar</button>` : ''}
        ${f.estado !== 'anulada' ? `<button class="btn-danger btn-block" id="fAnular">Anular</button>` : ''}
      </div>
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#fAbonar', () => formAbono(f));
    on('#fImprimir', () => imprimir(f, cliente));

    /* Mensaje de factura (WhatsApp usa *negritas*; el correo va sin asteriscos) */
    const mensajeFactura = emp => {
      const lineasTxt = f.lineas.map(l =>
        `▪ ${l.descripcion}${l.cantidad > 1 ? ` ×${l.cantidad}` : ''} — ${fmtMoneda(l.cantidad * l.precio, t)}`).join('\n');
      let msg = `Hola ${f.clienteNombre}, le saluda *${emp.nombre}* ✨\n\n` +
        `🧾 *Factura ${f.orden ? '#' + f.orden : ''}*${f.ncf ? ` · NCF ${f.ncf}` : ''}\n` +
        `📅 ${fmtFecha(f.fecha)}\n\n${lineasTxt}\n` +
        (f.impuesto ? `▪ ITBIS — ${fmtMoneda(f.impuesto, t)}\n` : '') +
        `\n💰 *Total: ${fmtMoneda(f.total, t)}*`;
      if (f.saldo > 0.005) {
        msg += `\n🔴 Balance pendiente: *${fmtMoneda(f.saldo, t)}*`;
        if (emp.cuentas) msg += `\n\n*Cuentas para su pago:*\n\n${emp.cuentas}`;
      } else {
        msg += `\n✅ Pagada — ¡gracias por su compra!`;
      }
      msg += `\n\n💎 ${emp.nombre} · ${emp.web}`;
      return msg;
    };
    on('#fWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      const tel = cliente.telefono.replace(/\D/g, '');
      const num = tel.length === 10 ? '1' + tel : tel;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(mensajeFactura(emp))}`, '_blank');
    });
    on('#fCorreo', async () => {
      const emp = await UI.getEmpresa();
      const asunto = `Factura ${f.orden ? '#' + f.orden : f.numero} — ${emp.nombre}`;
      location.href = `mailto:${cliente.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensajeFactura(emp).replace(/\*/g, ''))}`;
    });
    on('#fEditar', () => formulario(f));
    on('#fAnular', async () => {
      if (!confirm(`¿Anular la factura ${f.numero}? Se conserva en el historial como anulada.`)) return;
      f.estado = 'anulada'; f.saldo = 0;
      await DB.facturas.upsert(f);
      cerrarModal(); toast('Factura anulada'); render();
    });
  }

  /* ── Registrar abono ── */
  function formAbono(f) {
    const t = f.moneda || 'DOP';
    abrirModal(`Abono a ${f.numero || 'factura'}`, `
      <p class="muted" style="margin-bottom:14px">${esc(f.clienteNombre)} · pendiente: <b class="rojo">${fmtMoneda(f.saldo, t)}</b></p>
      <form id="formAbono">
        <div class="row">
          <div><label>Monto *</label><input name="monto" type="number" step="0.01" min="0.01" max="${f.saldo}" required value="${f.saldo}"></div>
          <div><label>Fecha</label><input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="row"><div>
          <label>Método de pago</label>
          <select name="metodo">${METODOS.map(m => `<option>${m}</option>`).join('')}</select>
        </div></div>
        <button type="submit" class="btn-gold btn-block">Registrar abono</button>
      </form>
    `);
    $('#formAbono').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const monto = Math.min(Number(fd.get('monto')), f.saldo);
      if (!(monto > 0)) return;
      f.abonos = f.abonos || [];
      f.abonos.push({ fecha: fd.get('fecha'), monto, metodo: fd.get('metodo') });
      f.saldo = Math.round((f.saldo - monto) * 100) / 100;
      if (f.saldo <= 0.005) { f.saldo = 0; f.estado = 'pagada'; delete f.proxCobro; }
      else actualizarProxCobro(f);      // el plan EasyPay avanza a la siguiente cuota
      await DB.facturas.upsert(f);
      await DB.pagos.upsert({ clienteId: f.clienteId, clienteNombre: f.clienteNombre,
        fecha: fd.get('fecha'), monto, metodo: fd.get('metodo'), facturaId: f.id });
      cerrarModal();
      toast(f.estado === 'pagada' ? '¡Factura saldada! 🎉' : 'Abono registrado');
      render();
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
          <div><label>Fecha</label><input name="fecha" type="date" value="${f.fecha || new Date().toISOString().slice(0, 10)}"></div>
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
            <div><label>Inicial</label><input name="epInicial" type="number" min="0" step="0.01" value="${f.planPago ? f.planPago.inicial : 0}"></div>
            <div><label>Cuotas</label><input name="epCuotas" type="number" min="1" max="36" step="1" value="${f.planPago ? f.planPago.cuotas.length : 4}"></div>
          </div>
          <div class="row">
            <div><label>Frecuencia</label>
              <select name="epFrecuencia">
                <option value="quincenal" ${!f.planPago || f.planPago.frecuencia === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                <option value="semanal" ${f.planPago && f.planPago.frecuencia === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="mensual" ${f.planPago && f.planPago.frecuencia === 'mensual' ? 'selected' : ''}>Mensual</option>
              </select></div>
            <div><label>Primer cobro</label><input name="epPrimera" type="date" value="${
              f.planPago && f.planPago.cuotas[0] ? f.planPago.cuotas[0].fecha : new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)}"></div>
          </div>
          <p class="muted" id="epPreview" style="margin-top:4px"></p>
        </div>

        <label style="margin-top:4px">Líneas</label>
        <div id="lineasCont"></div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="btn-ghost btn-sm" id="addLinea">+ Línea libre</button>
          ${productos.length ? `<select id="addProducto" style="flex:1"><option value="">+ Del catálogo…</option>${
            productos.map(p => `<option value="${p.id}">${esc(p.nombre)} — ${fmtMoneda(p.precio, p.moneda)}</option>`).join('')}</select>` : ''}
        </div>

        <div class="fact-preview" id="factPreview"></div>

        <div class="row"><div>
          <label>Nota (visible en la factura)</label>
          <input name="notas" value="${esc(f.notas || '')}">
        </div></div>
        <button type="submit" class="btn-gold btn-block">${esNueva ? 'Crear factura' : 'Guardar cambios'}</button>
      </form>
    `);

    /* Selector de cliente */
    const inpCli = $('#cliBuscar'), sug = $('#cliSugerencias');
    inpCli.addEventListener('input', async () => {
      clienteSel = null;
      const q = inpCli.value.trim().toLowerCase();
      if (q.length < 2) { sug.hidden = true; return; }
      const todos = await DB.clientes.list();
      const res = todos.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 6);
      sug.innerHTML = res.map(c => `<div class="sug" data-id="${c.id}">${esc(c.nombre)}<span class="muted"> ${esc(c.telefono || '')}</span></div>`).join('') ||
        '<div class="sug muted">Sin resultados — créalo primero en Clientes</div>';
      sug.hidden = false;
      sug.querySelectorAll('.sug[data-id]').forEach(el => el.addEventListener('click', async () => {
        clienteSel = await DB.clientes.get(el.dataset.id);
        inpCli.value = clienteSel.nombre;
        sug.hidden = true;
      }));
    });

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
      const inicial = Number(form.epInicial.value) || 0;
      const n = Math.max(1, Math.round(Number(form.epCuotas.value) || 1));
      if (total <= inicial) { el.textContent = 'La inicial cubre el total — no harían falta cuotas.'; return; }
      const cuotas = generarCuotas(total, inicial, n, form.epFrecuencia.value, form.epPrimera.value);
      el.textContent = `${inicial > 0 ? 'Inicial de ' + fmtMoneda(inicial, m) + ' + ' : ''}${n} cuota(s) de ~${fmtMoneda(cuotas[0].monto, m)} · última el ${fmtFecha(cuotas[cuotas.length - 1].fecha)}`;
    }
    $('#addLinea').addEventListener('click', () => { lineas.push({ descripcion: '', cantidad: 1, precio: '' }); pintarLineas(); });
    const selProd = $('#addProducto');
    if (selProd) selProd.addEventListener('change', () => {
      const p = productos.find(x => x.id === selProd.value);
      if (p) { lineas.push({ descripcion: p.nombre, cantidad: 1, precio: p.precio }); pintarLineas(); }
      selProd.value = '';
    });
    $('#formFactura').moneda.addEventListener('change', preview);
    $('#formFactura').itbis.addEventListener('change', preview);
    $('#fpSelect').addEventListener('change', e => {
      $('#easypayCampos').hidden = e.target.value !== 'easypay';
      preview();
    });
    ['epInicial', 'epCuotas', 'epFrecuencia', 'epPrimera'].forEach(nm =>
      $('#formFactura')[nm].addEventListener('input', preview));
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
        saldo: f.id ? Math.round((totalR - (f.total - f.saldo)) * 100) / 100 : totalR,
        estado: f.estado || 'pendiente',
        notas: fd.get('notas').trim(),
        abonos: f.abonos || [],
      };

      /* Plan EasyPay */
      if (fd.get('formaPago') === 'easypay') {
        const inicial = Math.min(Number(fd.get('epInicial')) || 0, totalR);
        const n = Math.max(1, Math.round(Number(fd.get('epCuotas')) || 1));
        nueva.planPago = {
          tipo: 'easypay',
          inicial,
          frecuencia: fd.get('epFrecuencia'),
          cuotas: totalR > inicial ? generarCuotas(totalR, inicial, n, fd.get('epFrecuencia'), fd.get('epPrimera')) : [],
        };
        // La inicial se registra como primer abono (solo al crear la factura)
        if (esNueva && inicial > 0) {
          nueva.abonos = [{ fecha: nueva.fecha, monto: inicial, metodo: 'EasyPay (inicial)' }];
          nueva.saldo = Math.round((nueva.saldo - inicial) * 100) / 100;
          if (nueva.saldo <= 0.005) { nueva.saldo = 0; nueva.estado = 'pagada'; }
        }
        actualizarProxCobro(nueva);
      } else {
        delete f.planPago;
        delete nueva.planPago;
      }

      const guardada = await DB.facturas.upsert(nueva);
      if (esNueva && nueva.abonos.length) {
        await DB.pagos.upsert({ clienteId: nueva.clienteId, clienteNombre: nueva.clienteNombre,
          fecha: nueva.fecha, monto: nueva.abonos[0].monto, metodo: 'EasyPay (inicial)', facturaId: guardada.id });
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
      emp.direccion,
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
      emp.rnc && 'RNC: ' + emp.rnc,
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

  return { init, render, detalle, siguienteNumero, formAbono, formulario, cuotasConEstado };
})();
