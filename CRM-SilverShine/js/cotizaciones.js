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

    const abiertas = lista.filter(c => ABIERTAS.includes(estadoDe(c)));
    const monto = abiertas.reduce((s, c) => s + (c.total || 0), 0);
    $('#cotResumen').innerHTML = `
      <div class="stat"><div class="n">${abiertas.length}</div><div class="l">Abiertas</div></div>
      <div class="stat"><div class="n">${fmtMoneda(monto)}</div><div class="l">Ventas en camino</div></div>
    `;

    if (filtroEstado) lista = lista.filter(c => estadoDe(c) === filtroEstado);
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

    cont.innerHTML = lista.slice(0, 100).map(c => `
      <div class="item" data-id="${c.id}">
        <div class="item-info">
          <div class="item-name">${esc(c.clienteNombre)} ${badge(c)}</div>
          <div class="item-sub">COT-${esc(String(c.numero || 's/n'))} · ${fmtFecha(c.fecha)} · ${fmtMoneda(c.total, c.moneda)}${
            c.vence && ABIERTAS.includes(estadoDe(c)) ? ` · vence ${fmtFecha(c.vence)}` : ''}</div>
        </div>
        <span class="item-arrow">›</span>
      </div>`).join('');
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
        <div><b>${esc(c.clienteNombre)}</b> ${badge(c)}<br>
        <span class="muted">${fmtFecha(c.fecha)}${c.vence ? ' · vence ' + fmtFecha(c.vence) : ''}</span></div>
      </div>
      <table class="fact-lineas">
        ${c.lineas.map(l => `<tr>
          <td>${esc(l.descripcion)}${l.cantidad > 1 ? ` <span class="muted">×${l.cantidad}</span>` : ''}</td>
          <td class="num">${fmtMoneda(l.cantidad * l.precio, t)}</td></tr>`).join('')}
        <tr class="fact-total"><td>Total</td><td class="num">${fmtMoneda(c.total, t)}</td></tr>
      </table>
      ${c.facturaId ? `<p class="muted" style="margin-top:8px">✅ Convertida en factura.</p>` : ''}

      ${abierta ? `<button class="btn-gold btn-block" id="cConvertir" style="margin:14px 0 6px">🧾 Convertir en factura</button>` : ''}
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost btn-block" id="cImprimir">🖨 Imprimir</button>
        ${cliente && cliente.telefono ? `<button class="btn-ghost btn-block" id="cWhatsApp">💬 WhatsApp</button>` : ''}
      </div>
      ${abierta ? `
      <div class="row" style="margin-top:10px">
        <button class="btn-ghost btn-block" id="cEditar">✏️ Editar</button>
        <button class="btn-danger btn-block" id="cRechazar">Marcar rechazada</button>
      </div>` : ''}
    `);

    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };

    on('#cConvertir', async () => {
      if (!confirm(`¿Convertir la cotización COT-${c.numero} en factura? Se creará con el próximo NCF.`)) return;
      const numero = await Facturas.siguienteNumero();
      const fact = await DB.facturas.upsert({
        numero, ncf: numero,
        clienteId: c.clienteId, clienteNombre: c.clienteNombre,
        fecha: new Date().toISOString().slice(0, 10),
        moneda: t, lineas: c.lineas.map(l => ({ ...l })),
        impuesto: 0, total: c.total, saldo: c.total,
        estado: 'pendiente', notas: `Según cotización COT-${c.numero}`, abonos: [],
      });
      c.estado = 'aceptada'; c.facturaId = fact.id;
      await DB.cotizaciones.upsert(c);
      cerrarModal();
      toast(`Factura ${numero} creada desde la cotización`);
      Facturas.detalle(fact.id);
    });

    on('#cImprimir', () => imprimir(c, cliente));
    on('#cWhatsApp', async () => {
      const emp = await UI.getEmpresa();
      const tel = cliente.telefono.replace(/\D/g, '');
      const num = tel.length === 10 ? '1' + tel : tel;
      const msg = `Hola ${c.clienteNombre}, le saluda *${emp.nombre}* ✨\n\n` +
        `Le compartimos su cotización *COT-${c.numero}*:\n\n` +
        c.lineas.map(l => `▪ ${l.descripcion}${l.cantidad > 1 ? ` ×${l.cantidad}` : ''} — ${fmtMoneda(l.cantidad * l.precio, t)}`).join('\n') +
        `\n\n💰 *Total: ${fmtMoneda(c.total, t)}*` +
        (c.vence ? `\n📅 Válida hasta el ${fmtFecha(c.vence)}` : '') +
        `\n\nTómese su tiempo para revisarla con calma. Si tiene alguna duda o le gustaría ajustar algo de la pieza, estamos a la orden para ayudarle con gusto. 💎`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    });
    on('#cEditar', () => formulario(c));
    on('#cRechazar', async () => {
      c.estado = 'rechazada';
      await DB.cotizaciones.upsert(c);
      cerrarModal(); toast('Cotización marcada como rechazada'); render();
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

    const en14dias = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

    abrirModal(esNueva ? 'Nueva cotización' : `Editar COT-${c.numero}`, `
      <form id="formCot">
        <div class="row"><div>
          <label>Cliente *</label>
          <input id="cotCliBuscar" autocomplete="off" placeholder="Escribe para buscar…" value="${esc(clienteSel ? clienteSel.nombre : '')}">
          <div id="cotCliSug" class="sugerencias" hidden></div>
        </div></div>
        <div class="row">
          <div><label>Número</label><input name="numero" value="${esc(String(numero))}"></div>
          <div><label>Fecha</label><input name="fecha" type="date" value="${c.fecha || new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="row">
          <div><label>Válida hasta</label><input name="vence" type="date" value="${c.vence || en14dias}"></div>
          <div><label>Moneda</label>
            <select name="moneda">
              <option value="DOP" ${c.moneda !== 'USD' ? 'selected' : ''}>RD$ (DOP)</option>
              <option value="USD" ${c.moneda === 'USD' ? 'selected' : ''}>US$ (USD)</option>
            </select></div>
        </div>
        <label>Líneas</label>
        <div id="cotLineasCont"></div>
        <div class="row" style="margin-top:6px">
          <button type="button" class="btn-ghost btn-sm" id="cotAddLinea">+ Línea libre</button>
          ${productos.length ? `<select id="cotAddProducto" style="flex:1"><option value="">+ Del catálogo…</option>${
            productos.map(p => `<option value="${p.id}">${esc(p.nombre)} — ${fmtMoneda(p.precio, p.moneda)}</option>`).join('')}</select>` : ''}
        </div>
        <div class="fact-preview" id="cotPreview"></div>
        <button type="submit" class="btn-gold btn-block">${esNueva ? 'Crear cotización' : 'Guardar cambios'}</button>
      </form>
    `);

    const inpCli = $('#cotCliBuscar'), sug = $('#cotCliSug');
    inpCli.addEventListener('input', async () => {
      clienteSel = null;
      const q = inpCli.value.trim().toLowerCase();
      if (q.length < 2) { sug.hidden = true; return; }
      const todos = await DB.clientes.list();
      const res = todos.filter(x => x.nombre.toLowerCase().includes(q)).slice(0, 6);
      sug.innerHTML = res.map(x => `<div class="sug" data-id="${x.id}">${esc(x.nombre)}</div>`).join('') ||
        '<div class="sug muted">Sin resultados</div>';
      sug.hidden = false;
      sug.querySelectorAll('.sug[data-id]').forEach(el => el.addEventListener('click', async () => {
        clienteSel = await DB.clientes.get(el.dataset.id);
        inpCli.value = clienteSel.nombre;
        sug.hidden = true;
      }));
    });

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
    const selProd = $('#cotAddProducto');
    if (selProd) selProd.addEventListener('change', () => {
      const p = productos.find(x => x.id === selProd.value);
      if (p) { lineas.push({ descripcion: p.nombre, cantidad: 1, precio: p.precio }); pintar(); }
      selProd.value = '';
    });
    $('#formCot').moneda.addEventListener('change', preview);
    pintar();

    $('#formCot').addEventListener('submit', async e => {
      e.preventDefault();
      if (!clienteSel) { toast('Selecciona un cliente de la lista'); return; }
      const fd = new FormData(e.target);
      const lineasOk = lineas
        .map(l => ({ descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad) || 1, precio: Number(l.precio) || 0 }))
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

  return { init, render, detalle, formulario };
})();
