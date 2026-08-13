/* ═══════════════════════════════════════════════════════════
   inventario.js — Inventario físico: cantidades y costos.
   Entradas y salidas con motivo, historial por pieza y valor
   total del inventario al costo.
   ═══════════════════════════════════════════════════════════ */
const Inventario = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, esc } = UI;

  let filtro = '', categoria = '';
  const hoyISO = () => UI.fechaISO();

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaInventario');
    let lista = await DB.inventario.list();

    // Resumen
    const unidades = lista.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
    const valor = lista.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.costo) || 0), 0);
    const agotados = lista.filter(i => (Number(i.cantidad) || 0) <= 0).length;
    $('#invResumen').innerHTML =
      UI.statTile(lista.length, 'Artículos') +
      UI.statTile(unidades, 'Unidades') +
      UI.statTile(UI.fmtDinero(valor), 'Valor al costo') +
      UI.statTile(agotados, 'Agotados', agotados ? 'rojo' : '');

    // Filtro de categorías
    const cats = [...new Set(lista.map(i => i.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const sel = $('#filtroCatInv');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = cats.includes(actual) ? actual : '';
    categoria = sel.value;

    if (filtro) {
      const f = filtro.toLowerCase();
      lista = lista.filter(i => (i.nombre || '').toLowerCase().includes(f) || (i.notas || '').toLowerCase().includes(f));
    }
    if (categoria) lista = lista.filter(i => i.categoria === categoria);
    lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    if (!lista.length) {
      cont.innerHTML = `<div class="empty"><span>📦</span>${
        filtro || categoria ? 'Nada coincide.' : 'El inventario está vacío.<br>Agrega tus piezas con “+ Nuevo artículo”.'
      }</div>`;
      return;
    }

    cont.innerHTML = lista.map(i => {
      const cant = Number(i.cantidad) || 0;
      const costo = Number(i.costo) || 0;
      return `
      <div class="item" data-id="${i.id}">
        <div class="inv-cant ${cant <= 0 ? 'agotado' : ''}">${cant}</div>
        <div class="item-info">
          <div class="item-name">${esc(i.nombre)}</div>
          <div class="item-sub">${esc(i.categoria || '')}${i.categoria ? ' · ' : ''}costo ${fmtMoneda(costo, i.moneda)} c/u · valor ${fmtMoneda(cant * costo, i.moneda)}</div>
        </div>
        <span class="item-arrow">›</span>
      </div>`;
    }).join('');
  }

  /* ── Detalle: movimiento rápido + historial ── */
  async function detalle(id) {
    const i = await DB.inventario.get(id);
    if (!i) return;
    const cant = Number(i.cantidad) || 0;
    const hist = (i.historial || []).slice(-8).reverse();

    abrirModal(i.nombre, `
      <div class="stat-grid" style="margin-bottom:14px">
        ${UI.statTile(cant, 'En existencia', cant <= 0 ? 'rojo' : '')}
        ${UI.statTile(fmtMoneda(Number(i.costo) || 0, i.moneda), 'Costo c/u')}
        ${UI.statTile(UI.fmtDinero(cant * (Number(i.costo) || 0), i.moneda), 'Valor')}
      </div>
      ${i.notas ? `<p class="muted" style="margin-bottom:12px">📝 ${esc(i.notas)}</p>` : ''}

      <h3 class="sub-h">Movimiento</h3>
      <form id="formMov">
        <div class="row">
          <div><label>Tipo</label>
            <select name="tipo">
              <option value="entrada">⬆ Entrada (fabricado/comprado)</option>
              <option value="salida">⬇ Salida (vendido/usado)</option>
            </select></div>
          <div><label>Cantidad</label><input name="cantidad" type="number" min="1" step="1" value="1" required></div>
        </div>
        <div class="row"><div>
          <label>Motivo (opcional)</label>
          <input name="motivo" placeholder="Ej: venta #1840, producción, ajuste…">
        </div></div>
        <button type="submit" class="btn-gold btn-block">Registrar movimiento</button>
      </form>

      ${hist.length ? `<h3 class="sub-h" style="margin-top:14px">Últimos movimientos</h3>` +
        hist.map(h => `<div class="abono-row">
          <span>${h.delta > 0 ? '⬆' : '⬇'} ${fmtFecha(h.fecha)}${h.motivo ? ' · ' + esc(h.motivo) : ''}</span>
          <b class="${h.delta > 0 ? 'verde' : 'rojo'}">${h.delta > 0 ? '+' : ''}${h.delta}</b></div>`).join('') : ''}

      <div class="row" style="margin-top:14px">
        <button class="btn-ghost btn-block" id="iEditar">✏️ Editar</button>
        <button class="btn-danger btn-block" id="iEliminar">Eliminar</button>
      </div>
    `);

    $('#formMov').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const n = Math.max(1, Math.round(Number(fd.get('cantidad')) || 1));
      const delta = fd.get('tipo') === 'salida' ? -n : n;
      const nuevaCant = (Number(i.cantidad) || 0) + delta;
      if (nuevaCant < 0) { toast(`Solo hay ${i.cantidad} en existencia`); return; }
      i.cantidad = nuevaCant;
      i.historial = [...(i.historial || []), { fecha: hoyISO(), delta, motivo: fd.get('motivo').trim() }].slice(-30);
      await DB.inventario.upsert(i);
      toast(delta > 0 ? `⬆ +${n} · quedan ${nuevaCant}` : `⬇ −${n} · quedan ${nuevaCant}`);
      render();
      detalle(i.id);
    });
    $('#iEditar').addEventListener('click', () => formulario(i));
    $('#iEliminar').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${i.nombre}" del inventario?`)) return;
      await DB.inventario.remove(i.id);
      cerrarModal(); toast('Artículo eliminado'); render();
    });
  }

  /* ── Crear / editar ── */
  function formulario(i = {}) {
    const esNuevo = !i.id;
    abrirModal(esNuevo ? 'Nuevo artículo' : 'Editar artículo', `
      <form id="formInv">
        <div class="row"><div>
          <label>Nombre *</label>
          <input name="nombre" required value="${esc(i.nombre || '')}" autocomplete="off" placeholder="Anillo Esencia Radiante 14K talla 7">
        </div></div>
        <div class="row"><div>
          <label>Categoría</label>
          <input name="categoria" value="${esc(i.categoria || '')}" list="catsInv" placeholder="Anillos, Cadenas, Materia prima…">
          <datalist id="catsInv"></datalist>
        </div></div>
        <div class="row">
          <div><label>Cantidad</label><input name="cantidad" type="number" min="0" step="1" value="${i.cantidad ?? 1}"></div>
          <div><label>Costo unitario</label><input name="costo" type="number" min="0" step="0.01" value="${i.costo ?? ''}"></div>
          <div><label>Moneda</label>
            <select name="moneda">
              <option value="DOP" ${i.moneda !== 'USD' ? 'selected' : ''}>RD$</option>
              <option value="USD" ${i.moneda === 'USD' ? 'selected' : ''}>US$</option>
            </select></div>
        </div>
        <div class="row"><div>
          <label>Notas</label>
          <textarea name="notas">${esc(i.notas || '')}</textarea>
        </div></div>
        <button type="submit" class="btn-gold btn-block">Guardar</button>
      </form>
    `);

    DB.inventario.list().then(lista => {
      const cats = [...new Set(lista.map(x => x.categoria).filter(Boolean))];
      $('#catsInv').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    });

    $('#formInv').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const cantidadNueva = Math.max(0, Math.round(Number(fd.get('cantidad')) || 0));
      const historial = i.historial || [];
      if (!esNuevo && cantidadNueva !== (Number(i.cantidad) || 0)) {
        historial.push({ fecha: hoyISO(), delta: cantidadNueva - (Number(i.cantidad) || 0), motivo: 'Ajuste manual' });
      }
      const guardado = await DB.inventario.upsert({
        id: i.id,
        nombre: fd.get('nombre').trim(),
        categoria: fd.get('categoria').trim(),
        cantidad: cantidadNueva,
        costo: Number(fd.get('costo')) || 0,
        moneda: fd.get('moneda'),
        notas: fd.get('notas').trim(),
        historial: historial.slice(-30),
      });
      toast(esNuevo ? 'Artículo agregado' : 'Artículo actualizado');
      render();
      detalle(guardado.id);
    });
  }

  function init() {
    $('#btnNuevoInv').addEventListener('click', () => formulario());
    $('#buscarInv').addEventListener('input', e => { filtro = e.target.value.trim(); render(); });
    $('#filtroCatInv').addEventListener('change', e => { categoria = e.target.value; render(); });
    $('#listaInventario').addEventListener('click', e => {
      const item = e.target.closest('.item[data-id]');
      if (item) detalle(item.dataset.id);
    });
  }

  return { init, render };
})();
