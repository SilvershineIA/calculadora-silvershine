/* ═══════════════════════════════════════════════════════════
   tareas.js — Módulo de tareas: recordatorios generales con
   fecha, vinculables a un cliente.
   ═══════════════════════════════════════════════════════════ */
const Tareas = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;

  const hoyISO = () => new Date().toISOString().slice(0, 10);

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaTareas');
    const lista = await DB.tareas.list();
    const hoy = hoyISO();

    const abiertas = lista.filter(t => !t.hecha)
      .sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
    const hechas = lista.filter(t => t.hecha)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 10);

    const grupos = {
      vencidas: abiertas.filter(t => t.fecha && t.fecha < hoy),
      hoy:      abiertas.filter(t => t.fecha === hoy),
      proximas: abiertas.filter(t => !t.fecha || t.fecha > hoy),
    };

    if (!lista.length) {
      cont.innerHTML = '<div class="empty"><span>✓</span>No hay tareas. Crea una con “+ Nueva tarea”.</div>';
      return;
    }

    const fila = t => `
      <div class="item tarea ${t.hecha ? 'hecha' : ''}" data-id="${t.id}">
        <button class="check ${t.hecha ? 'on' : ''}" data-check="${t.id}" title="Marcar ${t.hecha ? 'pendiente' : 'hecha'}">${t.hecha ? '✓' : ''}</button>
        <div class="item-info">
          <div class="item-name">${esc(t.titulo)}</div>
          <div class="item-sub">${[t.fecha ? fmtFecha(t.fecha) : '', t.clienteNombre].filter(Boolean).join(' · ')}</div>
        </div>
      </div>`;

    const seccion = (titulo, arr, cls) => !arr.length ? '' :
      `<h3 class="sub-h ${cls}">${titulo} (${arr.length})</h3>` + arr.map(fila).join('');

    cont.innerHTML =
      seccion('🔴 Vencidas', grupos.vencidas, 'rojo') +
      seccion('📌 Hoy', grupos.hoy, '') +
      seccion('📅 Próximas', grupos.proximas, '') +
      seccion('Hechas recientes', hechas, '');

    cont.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const t = await DB.tareas.get(b.dataset.check);
      t.hecha = !t.hecha;
      await DB.tareas.upsert(t);
      render();
    }));
    cont.querySelectorAll('.tarea').forEach(el =>
      el.addEventListener('click', async () => formulario(await DB.tareas.get(el.dataset.id))));
  }

  /* ── Crear / editar ── */
  async function formulario(t) {
    const esNueva = !t || !t.id;
    t = t || {};
    let clienteSel = t.clienteId ? await DB.clientes.get(t.clienteId) : null;

    abrirModal(esNueva ? 'Nueva tarea' : 'Editar tarea', `
      <form id="formTarea">
        <div class="row"><div>
          <label>Tarea *</label>
          <input name="titulo" required value="${esc(t.titulo || '')}" placeholder="Recoger pieza donde el joyero" autocomplete="off">
        </div></div>
        <div class="row"><div>
          <label>Fecha</label>
          <input name="fecha" type="date" value="${t.fecha || hoyISO()}">
        </div></div>
        <div class="row"><div>
          <label>Cliente (opcional)</label>
          <input id="tarCliBuscar" autocomplete="off" placeholder="Escribe para buscar…" value="${esc(clienteSel ? clienteSel.nombre : '')}">
          <div id="tarCliSug" class="sugerencias" hidden></div>
        </div></div>
        <div class="row"><div>
          <label>Notas</label>
          <textarea name="notas">${esc(t.notas || '')}</textarea>
        </div></div>
        <button type="submit" class="btn-gold btn-block">Guardar</button>
        ${esNueva ? '' : '<button type="button" class="btn-danger btn-block" id="tEliminar" style="margin-top:10px">Eliminar tarea</button>'}
      </form>
    `);

    UI.buscadorCliente($('#tarCliBuscar'), $('#tarCliSug'), c => { clienteSel = c; });

    $('#formTarea').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await DB.tareas.upsert({
        id: t.id,
        titulo: fd.get('titulo').trim(),
        fecha: fd.get('fecha') || null,
        notas: fd.get('notas').trim(),
        clienteId: clienteSel ? clienteSel.id : null,
        clienteNombre: clienteSel ? clienteSel.nombre : '',
        hecha: t.hecha || false,
      });
      cerrarModal();
      toast(esNueva ? 'Tarea creada' : 'Tarea actualizada');
      render();
    });

    const btnDel = $('#tEliminar');
    if (btnDel) btnDel.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta tarea?')) return;
      await DB.tareas.remove(t.id);
      cerrarModal(); toast('Tarea eliminada'); render();
    });
  }

  function init() {
    $('#btnNuevaTarea').addEventListener('click', () => formulario());
  }

  return { init, render, formulario };
})();
