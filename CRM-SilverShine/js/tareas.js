/* ═══════════════════════════════════════════════════════════
   tareas.js — Módulo de tareas: recordatorios generales con
   fecha, vinculables a un cliente.
   ═══════════════════════════════════════════════════════════ */
const Tareas = (() => {
  const { $, abrirModal, cerrarModal, toast, fmtFecha, esc } = UI;

  const hoyISO = () => UI.fechaISO();

  /* Fecha que manda: la del próximo paso pendiente (si hay pasos), si no la de la tarea */
  function fechaEfectiva(t) {
    const pendientes = (t.pasos || []).filter(p => !p.hecho && p.fecha);
    if (pendientes.length) return pendientes.map(p => p.fecha).sort()[0];
    return t.fecha || null;
  }
  const proximoPaso = t => (t.pasos || []).find(p => !p.hecho) || null;

  /* ── Lista ── */
  async function render() {
    const cont = $('#listaTareas');
    const lista = await DB.tareas.list();
    const hoy = hoyISO();

    const abiertas = lista.filter(t => !t.hecha)
      .sort((a, b) => (fechaEfectiva(a) || '9999').localeCompare(fechaEfectiva(b) || '9999'));
    const hechas = lista.filter(t => t.hecha)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 10);

    const grupos = {
      vencidas: abiertas.filter(t => fechaEfectiva(t) && fechaEfectiva(t) < hoy),
      hoy:      abiertas.filter(t => fechaEfectiva(t) === hoy),
      proximas: abiertas.filter(t => !fechaEfectiva(t) || fechaEfectiva(t) > hoy),
    };

    if (!lista.length) {
      cont.innerHTML = '<div class="empty"><span>✓</span>No hay tareas. Crea una con “+ Nueva tarea”.</div>';
      return;
    }

    const filaPasos = t => {
      if (t.hecha || !(t.pasos || []).length) return '';
      return `<div class="pasos-lista" data-tarea="${t.id}">` + t.pasos.map((p, i) => `
        <div class="paso-row ${p.hecho ? 'hecho' : ''} ${!p.hecho && p.fecha && p.fecha < hoy ? 'vencido' : ''}">
          <button class="check check-sm ${p.hecho ? 'on' : ''}" data-paso="${t.id}|${i}">${p.hecho ? '✓' : ''}</button>
          <span class="paso-titulo">${esc(p.titulo)}</span>
          ${p.fecha ? `<span class="paso-fecha">${fmtFecha(p.fecha)}</span>` : ''}
        </div>`).join('') + '</div>';
    };

    const fila = t => {
      const pasos = t.pasos || [];
      const hechos = pasos.filter(p => p.hecho).length;
      const prox = proximoPaso(t);
      const sub = [
        pasos.length ? `${hechos}/${pasos.length} pasos` : (t.fecha ? fmtFecha(t.fecha) : ''),
        prox && !t.hecha ? `→ ${prox.titulo}` : '',
        t.clienteNombre,
      ].filter(Boolean).join(' · ');
      return `
      <div class="item tarea ${t.hecha ? 'hecha' : ''}" data-id="${t.id}">
        <button class="check ${t.hecha ? 'on' : ''}" data-check="${t.id}" title="Marcar ${t.hecha ? 'pendiente' : 'hecha'}">${t.hecha ? '✓' : ''}</button>
        <div class="item-info">
          <div class="item-name">${esc(t.titulo)}</div>
          <div class="item-sub">${sub}</div>
        </div>
      </div>${filaPasos(t)}`;
    };

    const seccion = (titulo, arr, cls) => !arr.length ? '' :
      `<h3 class="sub-h ${cls}">${titulo} (${arr.length})</h3>` + arr.map(fila).join('');

    cont.innerHTML =
      seccion('🔴 Vencidas', grupos.vencidas, 'rojo') +
      seccion('📌 Hoy', grupos.hoy, '') +
      seccion('📅 Próximas', grupos.proximas, '') +
      seccion('Hechas recientes', hechas, '');

    // Marcar tarea completa
    cont.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const t = await DB.tareas.get(b.dataset.check);
      t.hecha = !t.hecha;
      if (t.hecha && t.pasos) t.pasos.forEach(p => p.hecho = true);
      await DB.tareas.upsert(t);
      render();
    }));
    // Marcar un paso; si era el último, la tarea se completa sola
    cont.querySelectorAll('[data-paso]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const [id, i] = b.dataset.paso.split('|');
      const t = await DB.tareas.get(id);
      t.pasos[Number(i)].hecho = !t.pasos[Number(i)].hecho;
      if (t.pasos.every(p => p.hecho)) {
        t.hecha = true;
        toast(`🎉 "${t.titulo}" completada`);
      } else {
        t.hecha = false;
      }
      await DB.tareas.upsert(t);
      render();
    }));
    cont.querySelectorAll('.tarea').forEach(el =>
      el.addEventListener('click', async () => formulario(await DB.tareas.get(el.dataset.id))));
  }

  /* ── Crear / editar ── */
  /* ── Dictado por voz: "llamar a Yeuri mañana" → tarea con fecha ──
     Entiende hoy/mañana/pasado mañana, "en N días", días de la semana
     y "el 20 (de agosto)". Lo dictado abre el formulario YA LLENO para
     confirmar o corregir antes de guardar. */
  function interpretarDictado(txt) {
    let t = txt.replace(/[.,;]+$/, '').trim();
    const hoy = new Date(hoyISO() + 'T00:00:00');
    const en = n => { const d = new Date(hoy); d.setDate(d.getDate() + n); return UI.fechaISO(d); };
    const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 };
    const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
    const proxDia = nombre => {
      const d = new Date(hoy);
      let delta = (DIAS[nombre.toLowerCase()] - d.getDay() + 7) % 7;
      if (!delta) delta = 7;
      d.setDate(d.getDate() + delta);
      return UI.fechaISO(d);
    };
    const fechaMes = (dia, mes) => {
      const d = new Date(hoy.getFullYear(), MESES[mes.toLowerCase()], Number(dia));
      if (d < hoy) d.setFullYear(d.getFullYear() + 1);
      return UI.fechaISO(d);
    };
    const diaDelMes = dia => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
      if (d < hoy) d.setMonth(d.getMonth() + 1);
      return UI.fechaISO(d);
    };
    let fecha = null;
    const reglas = [
      [/\bpasado\s+ma[ñn]ana\b/i, () => en(2)],
      [/\bma[ñn]ana\b/i, () => en(1)],
      [/\bhoy\b/i, () => en(0)],
      [/\ben\s+(\d{1,2})\s+d[ií]as?\b/i, m => en(Number(m[1]))],
      [/\b(?:el|este|pr[oó]ximo)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i, m => proxDia(m[1])],
      [/\bel\s+(?:d[ií]a\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, m => fechaMes(m[1], m[2])],
      [/\bel\s+(?:d[ií]a\s+)?(\d{1,2})\b/i, m => diaDelMes(Number(m[1]))],
    ];
    for (const [re, fn] of reglas) {
      const m = t.match(re);
      if (m) { fecha = fn(m); t = t.replace(re, '').replace(/\s{2,}/g, ' ').replace(/\s+(para|el)$/i, '').trim(); break; }
    }
    t = t.replace(/^(recu[eé]rdame|recordarme|recordar|tarea|anotar|anota|apuntar|apunta)\s+(que\s+)?/i, '').trim();
    if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
    return { titulo: t, fecha: fecha || hoyISO() };
  }

  function porVoz() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('🎤 Este navegador no dicta directo — usa el micrófono del teclado en el formulario');
      formulario();
      return;
    }
    abrirModal('🎤 Dictar tarea', `
      <p style="text-align:center;font-size:2.4rem;margin:8px 0">🎤</p>
      <p class="muted" style="text-align:center">Te escucho… di la tarea con su fecha.<br>
        Ej: «Llamar a Yeuri mañana» · «Recoger piezas el viernes»</p>
      <p id="vozParcial" style="text-align:center;min-height:24px;margin-top:12px;font-weight:600"></p>
      <button type="button" class="btn-ghost btn-block" id="vozCancelar" style="margin-top:10px">Cancelar</button>
    `);
    const rec = new SR();
    rec.lang = 'es-DO';
    rec.interimResults = true;
    let final = '', cancelado = false;
    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) { if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; }
      const el = $('#vozParcial');
      if (el) el.textContent = (final + ' ' + interim).trim();
    };
    rec.onerror = e => {
      cancelado = true;
      toast(e.error === 'not-allowed'
        ? '🎤 Permite el micrófono en el navegador para poder dictar'
        : '🎤 No se escuchó nada — intenta de nuevo');
      cerrarModal();
    };
    rec.onend = () => {
      if (cancelado || !final.trim()) { if (!cancelado) cerrarModal(); return; }
      const pre = interpretarDictado(final.trim());
      formulario(pre);
    };
    $('#vozCancelar').addEventListener('click', () => { cancelado = true; rec.abort(); cerrarModal(); });
    rec.start();
  }

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
        <label>Pasos (opcional) — cada uno con su fecha límite</label>
        <div id="pasosCont"></div>
        <button type="button" class="btn-ghost btn-sm" id="addPaso" style="margin-bottom:12px">➕ Agregar paso</button>
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

    /* Editor de pasos */
    let pasos = (t.pasos || []).map(p => ({ ...p }));
    function pintarPasos() {
      const cont = $('#pasosCont');
      cont.innerHTML = pasos.map((p, i) => `
        <div class="linea-row paso-edit">
          <input placeholder="Ej: Enviar al taller de grabado" data-i="${i}" data-k="titulo" value="${esc(p.titulo)}">
          <input type="date" data-i="${i}" data-k="fecha" value="${p.fecha || ''}">
          <button type="button" class="btn-x" data-del="${i}">✕</button>
        </div>`).join('');
      cont.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        pasos[inp.dataset.i][inp.dataset.k] = inp.value;
      }));
      cont.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        pasos.splice(Number(b.dataset.del), 1);
        pintarPasos();
      }));
    }
    $('#addPaso').addEventListener('click', () => {
      // sugerir la fecha del paso anterior (o hoy) como punto de partida
      const base = pasos.length ? (pasos[pasos.length - 1].fecha || hoyISO()) : hoyISO();
      pasos.push({ titulo: '', fecha: base, hecho: false });
      pintarPasos();
    });
    pintarPasos();

    $('#formTarea').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const pasosOk = pasos
        .map(p => ({ titulo: String(p.titulo).trim(), fecha: p.fecha || null, hecho: !!p.hecho }))
        .filter(p => p.titulo);
      await DB.tareas.upsert({
        id: t.id,
        titulo: fd.get('titulo').trim(),
        fecha: fd.get('fecha') || null,
        notas: fd.get('notas').trim(),
        clienteId: clienteSel ? clienteSel.id : null,
        clienteNombre: clienteSel ? clienteSel.nombre : '',
        pasos: pasosOk,
        hecha: pasosOk.length ? pasosOk.every(p => p.hecho) : (t.hecha || false),
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

  /* Marcar un paso desde Mi Día (o completar la tarea si no tiene pasos) */
  async function marcarPaso(id, i) {
    const t = await DB.tareas.get(id);
    if (!t) return;
    if (t.pasos && t.pasos[i]) {
      t.pasos[i].hecho = true;
      if (t.pasos.every(p => p.hecho)) { t.hecha = true; toast(`🎉 "${t.titulo}" completada`); }
      else toast(`✓ ${t.pasos[i].titulo}`);
    } else {
      t.hecha = true;
      toast(`🎉 "${t.titulo}" completada`);
    }
    await DB.tareas.upsert(t);
    render();
  }

  function init() {
    $('#btnNuevaTarea').addEventListener('click', () => formulario());
    $('#btnTareaVoz').addEventListener('click', porVoz);
  }

  return { init, render, formulario, fechaEfectiva, proximoPaso, marcarPaso };
})();
