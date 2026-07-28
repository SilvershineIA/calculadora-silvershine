/* ═══════════════════════════════════════════════════════════
   catalogo.js — Módulo de catálogo: productos con foto,
   categoría y precio (DOP/USD).
   ═══════════════════════════════════════════════════════════ */
const Catalogo = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtMoneda, esc, comprimirFoto } = UI;

  let filtro = '';
  let categoria = '';

  async function render() {
    const cont = $('#listaProductos');
    let lista = await DB.productos.list();

    // Poblar el filtro de categorías con las existentes
    const cats = [...new Set(lista.map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    const sel = $('#filtroCategoria');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = cats.includes(actual) ? actual : '';
    categoria = sel.value;

    if (filtro) {
      const f = filtro.toLowerCase();
      lista = lista.filter(p =>
        (p.nombre || '').toLowerCase().includes(f) ||
        (p.descripcion || '').toLowerCase().includes(f));
    }
    if (categoria) lista = lista.filter(p => p.categoria === categoria);
    lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

    if (!lista.length) {
      cont.innerHTML = `<div class="empty" style="grid-column:1/-1"><span>💍</span>${
        filtro || categoria ? 'Ningún producto coincide.' : 'El catálogo está vacío.<br>Agrega tus piezas frecuentes con “+ Nuevo producto”.'
      }</div>`;
      return;
    }

    cont.innerHTML = lista.map(p => `
      <div class="prod" data-id="${p.id}">
        ${p.foto
          ? `<img class="prod-foto" src="${p.foto}" alt="${esc(p.nombre)}">`
          : `<div class="prod-foto placeholder">💍</div>`}
        <div class="prod-body">
          <div class="prod-name">${esc(p.nombre)}</div>
          ${p.categoria ? `<div class="prod-cat">${esc(p.categoria)}</div>` : ''}
          <div class="prod-precio">${fmtMoneda(p.precio, p.moneda)}</div>
        </div>
      </div>`).join('');

    cont.querySelectorAll('.prod').forEach(el =>
      el.addEventListener('click', async () => formulario(await DB.productos.get(el.dataset.id))));
  }

  /* ── Formulario crear / editar ── */
  function formulario(p) {
    const esNuevo = !p || !p.id;
    p = p || {};
    let foto = p.foto || null;

    abrirModal(esNuevo ? 'Nuevo producto' : 'Editar producto', `
      <form id="formProducto">
        <div class="foto-drop" id="fotoDrop">
          ${foto ? `<img src="${foto}" alt="">` : ''}
          <span>${foto ? 'Cambiar foto' : '📷 Agregar foto (opcional)'}</span>
          <input type="file" id="fotoInput" accept="image/*" hidden>
        </div>
        <div class="row"><div>
          <label>Nombre *</label>
          <input name="nombre" required value="${esc(p.nombre || '')}" autocomplete="off" placeholder="Anillo oro 14k con zircón">
        </div></div>
        <div class="row"><div>
          <label>Categoría</label>
          <input name="categoria" value="${esc(p.categoria || '')}" list="listaCats" placeholder="Anillos, Cadenas, Reparaciones…">
          <datalist id="listaCats"></datalist>
        </div></div>
        <div class="row">
          <div><label>Precio *</label><input name="precio" type="number" step="0.01" min="0" required value="${p.precio ?? ''}"></div>
          <div><label>Moneda</label>
            <select name="moneda">
              <option value="DOP" ${p.moneda !== 'USD' ? 'selected' : ''}>RD$ (DOP)</option>
              <option value="USD" ${p.moneda === 'USD' ? 'selected' : ''}>US$ (USD)</option>
            </select>
          </div>
        </div>
        <div class="row"><div>
          <label>Descripción</label>
          <textarea name="descripcion">${esc(p.descripcion || '')}</textarea>
        </div></div>
        <button type="submit" class="btn-gold btn-block">Guardar</button>
        ${esNuevo ? '' : '<button type="button" class="btn-danger btn-block" id="pEliminar" style="margin-top:10px">Eliminar producto</button>'}
      </form>
    `);

    // Sugerir categorías existentes
    DB.productos.list().then(lista => {
      const cats = [...new Set(lista.map(x => x.categoria).filter(Boolean))];
      $('#listaCats').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    });

    // Foto
    const drop = $('#fotoDrop');
    const inputFoto = $('#fotoInput');
    drop.addEventListener('click', () => inputFoto.click());
    inputFoto.addEventListener('change', async () => {
      const file = inputFoto.files[0];
      if (!file) return;
      try {
        foto = await comprimirFoto(file);
        drop.innerHTML = `<img src="${foto}" alt=""><span>Cambiar foto</span>`;
        drop.appendChild(inputFoto);
      } catch {
        toast('No se pudo cargar la imagen');
      }
    });

    $('#formProducto').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await DB.productos.upsert({
        id: p.id,
        nombre:      fd.get('nombre').trim(),
        categoria:   fd.get('categoria').trim(),
        precio:      Number(fd.get('precio')),
        moneda:      fd.get('moneda'),
        descripcion: fd.get('descripcion').trim(),
        foto,
      });
      cerrarModal();
      toast(esNuevo ? 'Producto creado' : 'Producto actualizado');
      render();
    });

    const btnEliminar = $('#pEliminar');
    if (btnEliminar) btnEliminar.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${p.nombre}" del catálogo?`)) return;
      await DB.productos.remove(p.id);
      cerrarModal();
      toast('Producto eliminado');
      render();
    });
  }

  /* ── Eventos de la vista ── */
  function init() {
    $('#btnNuevoProducto').addEventListener('click', () => formulario());
    $('#buscarProducto').addEventListener('input', e => {
      filtro = e.target.value.trim();
      render();
    });
    $('#filtroCategoria').addEventListener('change', e => {
      categoria = e.target.value;
      render();
    });
  }

  return { init, render };
})();
