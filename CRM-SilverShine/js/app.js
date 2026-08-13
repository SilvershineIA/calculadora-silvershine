/* ═══════════════════════════════════════════════════════════
   app.js — Navegación, panel y ajustes.
   ═══════════════════════════════════════════════════════════ */
(() => {
  const { $, $$, toast } = UI;

  /* ── Navegación entre vistas ── */
  const vistas = {
    clientes:     () => Clientes.render(),
    catalogo:     () => Catalogo.render(),
    calculadora:  () => Calculadora.abrir(),
    facturas:     () => Facturas.render(),
    cotizaciones: () => Cotizaciones.render(),
    confecciones: () => Confecciones.render(),
    cobros:       () => Cobros.render(),
    finanzas:     () => Finanzas.render(),
    cuadre:       () => Caja.render(),
    inventario:   () => Inventario.render(),
    tareas:       () => Tareas.render(),
    panel:        () => renderPanel(),
    ajustes:      () => { pintarEstadoNube(); cargarFormEmpresa(); },
  };

  let vistaActual = 'panel';
  function irA(nombre) {
    vistaActual = nombre;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === nombre));
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === nombre));
    if (vistas[nombre]) vistas[nombre]();
    window.scrollTo({ top: 0 });
  }

  $$('.nav-btn').forEach(b => b.addEventListener('click', () => irA(b.dataset.view)));

  /* ── Re-sincronizar al VOLVER a la app, no solo al abrirla ──
     La PWA queda residente en el teléfono: sin esto, un cambio hecho en
     la PC (p. ej. el Cuadre) no se veía hasta cerrar y reabrir. Al
     regresar el foco: vaciar pendientes + bajar lo último + repintar la
     vista. Con calma: máx. 1 vez por minuto y nunca con un modal abierto
     (para no pisar un formulario a mitad de escritura). */
  /* ── Auto-actualización: la PWA instalada no busca versiones nuevas
     sola si queda abierta. Aquí se consulta sw.js fresco de la red; si
     trae una versión mayor a la cargada, se purga el caché y se recarga
     (solo sin modal abierto, para no interrumpir un formulario). ── */
  async function buscarActualizacion() {
    try {
      if (!navigator.onLine || !$('#modalBg').hidden) return;
      const txt = await (await fetch('sw.js', { cache: 'no-store' })).text();
      const nueva = /sscrm-v(\d+)/.exec(txt);
      const actual = /v=(\d+)/.exec(($('link[rel="stylesheet"]') || {}).href || '');
      if (!nueva || !actual || Number(nueva[1]) <= Number(actual[1])) return;
      toast(`⬆ Actualizando a la versión ${nueva[1]}…`);
      if (navigator.serviceWorker) {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
      }
      for (const k of await caches.keys()) await caches.delete(k);
      setTimeout(() => location.reload(), 900);
    } catch { /* sin internet o red caída: se intenta luego */ }
  }
  setTimeout(buscarActualizacion, 4000);

  let ultimaSyncFoco = 0;
  async function sincronizarAlVolver() {
    if (document.hidden) return;
    if (Date.now() - ultimaSyncFoco < 60000) return;
    if (!$('#modalBg').hidden) return;
    ultimaSyncFoco = Date.now();
    buscarActualizacion();
    if (!Sync.conectado()) return;
    const ok = await Sync.alAbrir();
    if (ok && $('#modalBg').hidden) {
      if (vistas[vistaActual]) vistas[vistaActual]();
      pintarEstadoNube();
    }
  }
  document.addEventListener('visibilitychange', sincronizarAlVolver);
  window.addEventListener('focus', sincronizarAlVolver);

  /* ── Mi Día: la cola única de acciones ──
     Regla de los grandes CRM: el sistema decide qué toca hoy y el dueño
     solo ejecuta. Mezcla leads calientes, cobros que tocan, cotizaciones
     que piden seguimiento y pasos de taller — cada uno con su botón de
     1 toque. Un ítem cuenta como despachado solo cuando la acción quedó
     registrada (seguimiento de hoy, recordatorio anotado, abono, paso). */
  async function renderPanel() {
    const hoy = UI.fechaISO();
    const facturas = await DB.facturas.list();
    const cots = await DB.cotizaciones.list();
    const tareas = await DB.tareas.list();
    const estadoCot = c => c.estado === 'pendiente' ? 'enviada' : c.estado;
    // Montos internos siempre en RD$ (los US$ convertidos con la tasa viva)
    // para que "Valor en juego" y el orden por monto no mezclen monedas
    const tasa = typeof Calculadora !== 'undefined' ? (Calculadora.tasaActual() || 0) : 0;
    const conv = (m, mon) => (mon === 'USD' && tasa ? m * tasa : m) || 0;
    const items = [];

    const posp = c => c.proximoToque && c.proximoToque > hoy;   // "toque el X" desde el menú ⋯

    // 1) Leads calientes: aceptadas sin factura — lo más valioso del día
    for (const c of cots.filter(c => estadoCot(c) === 'aceptada' && !c.facturaId && !posp(c))) {
      items.push({
        grupo: 0, monto: conv(c.total || 0, c.moneda || 'DOP'),
        hecho: (c.seguimientos || []).some(s => s.fecha === hoy),
        icono: '🧾', titulo: c.clienteNombre,
        sub: `Lead caliente · COT-${UI.esc(String(c.numero || ''))} · cerrar con el 70% (${UI.fmtDinero((c.total || 0) * 0.7, c.moneda)})`,
        accion: 'lead', id: c.id, btn: '💬',
      });
    }

    // 2) Cobros que tocan: vencidos, de hoy, y el recordatorio previo
    //    (la secuencia escalonada arranca 3 días ANTES del vencimiento)
    for (const f of facturas.filter(f => f.estado === 'pendiente' && f.saldo > 0)) {
      const fecha = f.proxCobro && f.proxCobro.fecha;
      if (!fecha) continue;
      const dias = Math.round((new Date(hoy + 'T00:00:00') - new Date(fecha + 'T00:00:00')) / 864e5);
      if (dias < -3) continue;   // todavía falta — entra a la cola 3 días antes
      items.push({
        grupo: 1, monto: conv(f.proxCobro.monto || f.saldo, f.moneda || 'DOP'),
        hecho: f.ultimoRecordatorio === hoy || (f.abonos || []).some(a => a.fecha === hoy),
        icono: '💰', titulo: f.clienteNombre,
        sub: `${dias > 0 ? `Cobro vencido hace ${dias} día${dias === 1 ? '' : 's'}`
          : dias === 0 ? 'Cobro de HOY'
          : `Vence en ${-dias} día${dias === -1 ? '' : 's'} — aviso amistoso`} · ${
          UI.fmtDinero(f.proxCobro.monto || f.saldo, f.moneda)}${dias >= 7 ? ' · 📞 mejor llamar' : ''}`,
        accion: 'cobro', id: f.id, btn: '💬', rojo: dias > 0,
      });
    }

    // 3) Cotizaciones abiertas que piden seguimiento (7+ días sin gestión o por vencer)
    for (const c of cots.filter(c => ['enviada', 'borrador'].includes(estadoCot(c)) && !posp(c))) {
      const ultima = [c.fecha, ...(c.seguimientos || []).map(s => s.fecha)].filter(Boolean).sort().pop();
      const diasSin = ultima ? Math.round((new Date(hoy + 'T00:00:00') - new Date(ultima + 'T00:00:00')) / 864e5) : 99;
      const porVencer = c.vence && c.vence >= hoy && c.vence <= UI.fechaISO(new Date(Date.now() + 2 * 864e5));
      if (diasSin < 7 && !porVencer) continue;
      items.push({
        grupo: 2, monto: conv(c.total || 0, c.moneda || 'DOP'),
        hecho: (c.seguimientos || []).some(s => s.fecha === hoy),
        icono: '📋', titulo: c.clienteNombre,
        sub: `COT-${UI.esc(String(c.numero || ''))} · ${UI.fmtDinero(c.total, c.moneda)} · ${
          porVencer ? '⏳ por vencer' : `${diasSin} días sin seguimiento`}`,
        accion: 'cot', id: c.id, btn: '💬', rojo: diasSin >= 15,
      });
    }

    // 4) Tareas y pasos de taller que vencen hoy (o ya se pasaron)
    for (const t of tareas.filter(t => !t.hecha)) {
      const fe = Tareas.fechaEfectiva(t);
      if (!fe || fe > hoy) continue;
      const i = (t.pasos || []).findIndex(p => !p.hecho);
      const paso = i >= 0 ? t.pasos[i] : null;
      items.push({
        grupo: 3, monto: 0, hecho: false,
        icono: '🛠', titulo: t.titulo,
        sub: `${paso ? UI.esc(paso.titulo) + ' · ' : ''}${UI.fmtFecha(fe)}${t.clienteNombre ? ' · ' + UI.esc(t.clienteNombre) : ''}`,
        accion: 'tarea', id: t.id, paso: i, btn: '✓', rojo: fe < hoy,
      });
    }

    // 5) Respaldo mensual: si no hay copia en 30 días, entra a la cola
    const resp = await DB.config.get('respaldo');
    const diasResp = resp && resp.ultimo
      ? Math.round((new Date(hoy + 'T00:00:00') - new Date(resp.ultimo + 'T00:00:00')) / 864e5) : 999;
    if (diasResp >= 30) {
      items.push({
        grupo: 4, monto: 0, hecho: false,
        icono: '🗄', titulo: 'Respaldo mensual del CRM',
        sub: resp && resp.ultimo
          ? `Última copia hace ${diasResp} días — toca 💾 y se descarga`
          : 'Nunca se ha descargado una copia de seguridad — toca 💾',
        accion: 'respaldo', id: 'respaldo', btn: '💾', rojo: diasResp >= 45,
      });
    }

    // Pendientes arriba (leads → cobros → cotizaciones → taller, mayor monto
    // primero); las despachadas de hoy quedan al final con su ✓
    items.sort((a, b) => (a.hecho - b.hecho) || (a.grupo - b.grupo) || (b.monto - a.monto));
    const hechas = items.filter(x => x.hecho).length;
    const enJuego = items.filter(x => !x.hecho).reduce((s, x) => s + x.monto, 0);

    $('#diaStats').innerHTML =
      UI.statTile(`${hechas}/${items.length}`, 'Despachadas hoy', items.length && hechas === items.length ? 'verde' : '') +
      UI.statTile(items.filter(x => !x.hecho && x.grupo === 0).length, 'Leads calientes') +
      UI.statTile(items.filter(x => !x.hecho && x.grupo === 1).length, 'Cobros que tocan') +
      UI.statTile(UI.fmtDinero(enJuego), 'Valor en juego');

    const cont = $('#colaDia');
    cont.innerHTML = items.length ? items.map((x, i) => `
      <div class="item dia-item ${x.hecho ? 'dia-hecho' : ''}" data-i="${i}">
        <div class="item-info">
          <div class="item-name">${x.icono} ${UI.esc(x.titulo)}</div>
          <div class="item-sub ${x.rojo && !x.hecho ? 'rojo' : ''}">${x.sub}${
            x.hecho && x.accion !== 'tarea' ? ' · 📨 enviado hoy — cuando responda, toca ⋯' : ''}</div>
        </div>
        ${x.hecho
          ? `<div style="display:flex;gap:6px;align-items:center;flex:0 0 auto">
              <span class="verde" style="font-size:1.15rem">✓</span>${
              ['lead', 'cot', 'cobro'].includes(x.accion) ? `<button class="btn-ghost btn-sm dia-mas" data-mas="${i}" title="¿Qué respondió?">⋯</button>` : ''}
            </div>`
          : `<div style="display:flex;gap:6px;flex:0 0 auto">
              <button class="btn-gold btn-sm dia-btn" data-acc="${i}" title="Acción en 1 toque">${x.btn}</button>${
              ['lead', 'cot', 'cobro'].includes(x.accion) ? `<button class="btn-ghost btn-sm dia-mas" data-mas="${i}" title="¿Qué pasó con este?">⋯</button>` : ''}
            </div>`}
      </div>`).join('')
      : '<div class="empty"><span>🌤</span>Nada en la cola — el día está despachado.</div>';

    cont.querySelectorAll('.dia-btn').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const x = items[Number(b.dataset.acc)];
      if (x.accion === 'lead' || x.accion === 'cot') await Cotizaciones.seguimientoRapido(x.id);
      else if (x.accion === 'cobro') await Cobros.recordatorioRapido(x.id);
      else if (x.accion === 'tarea') await Tareas.marcarPaso(x.id, x.paso);
      else if (x.accion === 'respaldo') await descargarRespaldo();
      renderPanel();
    }));
    cont.querySelectorAll('.dia-mas').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      opcionesDia(items[Number(b.dataset.mas)]);
    }));
    cont.querySelectorAll('.dia-item').forEach(el => el.addEventListener('click', () => {
      const x = items[Number(el.dataset.i)];
      if (x.accion === 'lead' || x.accion === 'cot') Cotizaciones.detalle(x.id);
      else if (x.accion === 'cobro') Cobros.detalle(x.id);
      else DB.tareas.get(x.id).then(t => t && Tareas.formulario(t));
    }));
  }

  /* ── Mi Día: menú "¿qué pasó?" — registrar el resultado y reprogramar ──
     Cotizaciones/leads: respondió, está pensándolo, o un toque en X días
     (proximoToque las saca de la cola y de la urgencia hasta esa fecha).
     Cobros: registrar abono, promesa de pago (reprograma el próximo
     cobro) o recordar mañana. */
  async function opcionesDia(x) {
    const hoy = UI.fechaISO();
    const en = d => UI.fechaISO(new Date(Date.now() + d * 864e5));

    if (x.accion === 'lead' || x.accion === 'cot') {
      const c = await DB.cotizaciones.get(x.id);
      if (!c) return;
      UI.abrirModal(`${x.titulo} — ¿qué respondió?`, `
        <button class="btn-gold btn-block" data-op="respondio" style="margin-bottom:8px">✅ Le interesa — la conversación sigue conmigo</button>
        <button class="btn-ghost btn-block" data-op="modificar" style="margin-bottom:8px">✏️ Quiere modificar algo — ajustar la cotización</button>
        <button class="btn-ghost btn-block" data-op="pensando" style="margin-bottom:8px">🤔 Está pensándolo — darle espacio (7 días)</button>
        <h3 class="sub-h" style="margin-top:12px">⏰ Sin respuesta — recordármelo en…</h3>
        <div class="row">
          <button class="btn-ghost btn-block" data-op="t3">3 días</button>
          <button class="btn-ghost btn-block" data-op="t7">7 días</button>
          <button class="btn-ghost btn-block" data-op="t15">15 días</button>
          <button class="btn-ghost btn-block" data-op="t30">30 días</button>
        </div>
        <button class="btn-danger btn-block" data-op="rechazo" style="margin-top:12px">❌ No le interesó — marcar rechazada</button>
        <button class="btn-ghost btn-block" data-op="ver" style="margin-top:8px">📋 Ver la cotización completa</button>
      `);
      const acc = async (via, dias, msj) => {
        if (via) c.seguimientos = [...(c.seguimientos || []), { fecha: hoy, via }];
        if (dias) c.proximoToque = en(dias);
        await DB.cotizaciones.upsert(c);
        UI.cerrarModal(); UI.toast(msj); renderPanel();
      };
      const OPS = {
        respondio: () => acc('respondió', 7, '✅ Anotado — la cola te la devuelve en 7 días si hace falta'),
        pensando:  () => acc('dándole espacio', 7, '🤔 Espacio dado — vuelve a la cola en 7 días'),
        t3:  () => acc(null, 3, '⏰ Toque programado en 3 días'),
        t7:  () => acc(null, 7, '⏰ Toque programado en 7 días'),
        t15: () => acc(null, 15, '⏰ Toque programado en 15 días'),
        t30: () => acc(null, 30, '⏰ Toque programado en 30 días'),
        modificar: async () => {
          c.seguimientos = [...(c.seguimientos || []), { fecha: hoy, via: 'quiere modificar' }];
          await DB.cotizaciones.upsert(c);
          Cotizaciones.formulario(c);   // abre la edición directo
        },
        rechazo: async () => {
          if (!confirm(`¿Marcar rechazada la COT-${c.numero} de ${c.clienteNombre}? Sale de la cola y del visor (queda en el filtro "Rechazadas").`)) return;
          c.estado = 'rechazada';
          c.estadoManual = hoy;
          delete c.proximoToque;
          await DB.cotizaciones.upsert(c);
          UI.cerrarModal(); UI.toast('❌ Rechazada — anotada en la conversión'); renderPanel();
        },
        ver: () => Cotizaciones.detalle(c.id),
      };
      UI.$$('#modalBody [data-op]').forEach(b => b.addEventListener('click', () => OPS[b.dataset.op]()));
      return;
    }

    if (x.accion === 'cobro') {
      const f = await DB.facturas.get(x.id);
      if (!f) return;
      UI.abrirModal(`${x.titulo} — ¿qué pasó?`, `
        <button class="btn-gold btn-block" data-op="abono" style="margin-bottom:8px">💵 Pagó — registrar el abono</button>
        <h3 class="sub-h" style="margin-top:12px">🤝 Prometió pagar el…</h3>
        <div class="row">
          <div style="flex:1"><input type="date" id="opFechaPromesa" value="${en(3)}"></div>
          <button class="btn-gold btn-block" data-op="promesa" style="flex:1">Guardar promesa</button>
        </div>
        <button class="btn-ghost btn-block" data-op="manana" style="margin-top:12px">⏰ Recordármelo mañana</button>
        <button class="btn-ghost btn-block" data-op="ver" style="margin-top:8px">💰 Ver el cobro completo</button>
      `);
      const reprogramar = async (fecha, msj) => {
        f.proxCobro = { fecha, monto: (f.proxCobro && f.proxCobro.monto) || null };
        await DB.facturas.upsert(f);
        UI.cerrarModal(); UI.toast(msj); renderPanel();
      };
      const OPS = {
        abono: () => Facturas.formAbono(f),
        promesa: () => {
          const fecha = UI.$('#opFechaPromesa').value;
          if (!fecha) { UI.toast('Elige la fecha prometida'); return; }
          reprogramar(fecha, `🤝 Promesa anotada — la cola lo reclama el ${UI.fmtFecha(fecha)}`);
        },
        manana: () => reprogramar(en(1), '⏰ Te lo recuerdo mañana'),
        ver: () => Cobros.detalle(f.id),
      };
      UI.$$('#modalBody [data-op]').forEach(b => b.addEventListener('click', () => OPS[b.dataset.op]()));
    }
  }

  /* ── Ajustes: respaldo ── */
  /* Descargar respaldo completo y anotar la fecha (sincronizada):
     Mi Día lo recuerda solo cuando pasa un mes sin copia */
  async function descargarRespaldo() {
    const data = await DB.exportar();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-crm-silvershine-${UI.fechaISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    await DB.config.upsert({ id: 'respaldo', ultimo: UI.fechaISO() });
    toast('🗄 Respaldo descargado — guárdalo en un lugar seguro (correo, Drive…)');
  }
  $('#btnExportar').addEventListener('click', descargarRespaldo);

  $('#btnImportar').addEventListener('click', () => $('#fileImportar').click());
  $('#fileImportar').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Importar un respaldo REEMPLAZA los datos actuales de este dispositivo. ¿Continuar?')) {
      e.target.value = '';
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const n = await DB.importar(data);
      toast(`Respaldo importado (${n} registros)`);
      if (Sync.conectado()) { pintarEstadoNube('Subiendo a la nube…'); await Sync.subirTodo(); pintarEstadoNube(); }
      irA('panel');
    } catch {
      toast('El archivo no es un respaldo válido');
    }
    e.target.value = '';
  });

  /* ── Empresa y factura ── */
  async function cargarFormEmpresa() {
    const emp = await UI.getEmpresa();
    const f = $('#formEmpresa');
    for (const campo of ['nombre', 'vendedor', 'razon', 'rnc', 'direccion', 'telefono', 'correo', 'web', 'garantia', 'pie', 'cuentas']) {
      f[campo].value = emp[campo] || '';
    }
  }
  $('#formEmpresa').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const emp = { id: 'empresa' };
    for (const campo of ['nombre', 'vendedor', 'razon', 'rnc', 'direccion', 'telefono', 'correo', 'web', 'garantia', 'pie', 'cuentas']) {
      emp[campo] = String(fd.get(campo) || '').trim();
    }
    await DB.config.upsert(emp);
    toast('Datos de empresa guardados');
  });

  /* ── Migración única: asignar orden #1825…#1839 a las facturas
        posteriores al corte de Shopify (#1824, 16 jul 2026) ── */
  async function migrarOrdenes() {
    // Idempotente: verifica el rango histórico completo y corrige lo que falte.
    // Solo toca facturas importadas de QuickBooks entre el corte de Shopify
    // (#1824, 16 jul) y el fin de la importación (27 jul); nunca las nuevas.
    const facts = await DB.facturas.list();
    const objetivo = facts
      .filter(f => f.origen === 'quickbooks' && f.estado !== 'anulada' &&
                   (f.fecha || '') > '2026-07-16' && (f.fecha || '') <= '2026-07-27')
      .sort((a, b) => ((a.fecha || '') + (a.numero || '')).localeCompare((b.fecha || '') + (b.numero || '')));
    let n = 1825, corregidas = 0;
    for (const f of objetivo) {
      if (f.orden !== n) { f.orden = n; await DB.facturas.upsert(f); corregidas++; }
      n++;
    }
    if (corregidas) console.info(`Órdenes corregidas: ${corregidas} (hasta #${n - 1})`);
  }

  /* ── Nube (Supabase) ── */
  function pintarEstadoNube(msj) {
    const el = $('#nubeEstado');
    const info = Sync.info();
    if (msj) { el.innerHTML = `⏳ ${msj}`; return; }
    if (Sync.conectado()) {
      const pend = Sync.pendientes();
      el.innerHTML = `🟢 Conectado como <b>${info.email}</b>` +
        (pend ? ` · ${pend} cambio(s) esperando internet` : ' · todo sincronizado');
      $('#btnDesconectar').hidden = false;
      $('#zonaReparar').hidden = false;
      $('#formNube').querySelectorAll('input').forEach(i => i.disabled = true);
    } else {
      $('#zonaReparar').hidden = true;
      el.innerHTML = info
        ? '🟠 Sesión cerrada — vuelve a poner tu clave y presiona Conectar.'
        : '⚪ Sin conectar. Los datos solo viven en este dispositivo.';
      $('#btnDesconectar').hidden = !info;
      $('#formNube').querySelectorAll('input').forEach(i => i.disabled = false);
      if (info) { $('#formNube').url.value = info.url; $('#formNube').email.value = info.email; }
    }
  }
  Sync.setEstadoUI(pintarEstadoNube);

  $('#formNube').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = fd.get('url').trim().replace(/\/+$/, '');
    const anonKey = fd.get('anonKey').trim();
    const email = fd.get('email').trim();
    const password = fd.get('password');
    if (!url || !anonKey || !email || !password) { toast('Completa los cuatro campos'); return; }
    try {
      pintarEstadoNube('Conectando…');
      await Sync.login(url, anonKey, email, password);
      const nubeConDatos = await Sync.nubeTieneDatos();
      const localConDatos = (await DB.clientes.list()).length > 0;
      if (!nubeConDatos && localConDatos) {
        pintarEstadoNube('Primera subida de datos…');
        await Sync.subirTodo();
        toast('☁️ Datos subidos a la nube');
      } else if (nubeConDatos) {
        if (!localConDatos || confirm(
          'La nube Y este dispositivo tienen datos distintos.\n\n' +
          '· ACEPTAR: usar los de la NUBE (borra lo que ves en esta app).\n' +
          '· CANCELAR: conservar los de ESTE dispositivo (luego usa "Reparar nube" en Ajustes para subirlos).')) {
          await Sync.bajarTodo();
          toast('☁️ Datos descargados de la nube');
        } else if (localConDatos && confirm('¿Subir AHORA los datos de este dispositivo a la nube? (Reemplaza lo que hay allá — recomendado para que no se pierdan al reabrir la app.)')) {
          pintarEstadoNube('Reparando la nube…');
          await Sync.repararNube();
          toast('☁️ Nube reparada con los datos de este dispositivo');
        }
      }
      e.target.password.value = '';
      pintarEstadoNube();
      renderPanel();
    } catch (err) {
      pintarEstadoNube();
      $('#nubeEstado').innerHTML = `🔴 ${err.message}`;
    }
  });

  /* Enlace mágico: conexión pre-llenada para otro dispositivo (sin la clave) */
  const PUB_URL = 'https://silvershineia.github.io/calculadora-silvershine/CRM-SilverShine/';
  $('#btnEnlaceMovil').addEventListener('click', () => {
    const c = Sync.cfgPublica();
    if (!c) return;
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(c))));
    const enlace = PUB_URL + '#cfg=' + payload;
    UI.abrirModal('Conectar el celular', `
      <p class="muted" style="margin-bottom:10px">1. Copia este enlace y envíatelo por WhatsApp o correo.<br>
      2. Ábrelo en el celular: la conexión ya irá puesta.<br>
      3. Escribe tu clave de usuario y presiona Conectar.<br>
      <b>Tu clave nunca viaja en el enlace.</b></p>
      <textarea id="enlaceMovil" readonly style="height:120px;font-size:.78rem;word-break:break-all">${enlace}</textarea>
      <button type="button" class="btn-gold btn-block" id="copiarEnlace" style="margin-top:10px">📋 Copiar enlace</button>
    `);
    $('#copiarEnlace').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(enlace); }
      catch { $('#enlaceMovil').select(); document.execCommand('copy'); }
      toast('Enlace copiado — pégalo en WhatsApp');
    });
  });

  $('#btnDescargarNube').addEventListener('click', async () => {
    try {
      pintarEstadoNube('Descargando…');
      await Sync.bajarTodo();
      pintarEstadoNube();
      toast('☁️ Datos descargados de la nube');
      renderPanel();
      irA('panel');
    } catch (err) {
      pintarEstadoNube();
      $('#nubeEstado').innerHTML = `🔴 ${err.message}`;
    }
  });

  $('#btnRepararNube').addEventListener('click', async () => {
    const clientes = (await DB.clientes.list()).length;
    const facturas = (await DB.facturas.list()).length;
    if (!clientes && !facturas) {
      toast('Este dispositivo está vacío: no puede reparar la nube. Usa "Descargar todo de la nube".');
      return;
    }
    if (!confirm(`Esto BORRA todo lo que hay en la nube y sube lo de este dispositivo (${clientes} clientes, ${facturas} facturas).\n\n¿Continuar?`)) return;
    try {
      pintarEstadoNube('Reparando la nube…');
      await Sync.repararNube();
      pintarEstadoNube();
      toast('☁️ Nube reparada');
      renderPanel();
    } catch (err) {
      pintarEstadoNube();
      $('#nubeEstado').innerHTML = `🔴 ${err.message}`;
    }
  });

  $('#btnDesconectar').addEventListener('click', () => {
    if (!confirm('¿Desconectar de la nube? Los datos locales se conservan; solo se detiene la sincronización.')) return;
    Sync.desconectar();
    pintarEstadoNube();
    toast('Desconectado de la nube');
  });

  /* ── Cargar histórico de QuickBooks ── */
  $('#btnCargarQB').addEventListener('click', async () => {
    if (!confirm('Esto carga el histórico de QuickBooks y REEMPLAZA los clientes, facturas, pagos y cotizaciones actuales de este dispositivo. ¿Continuar?')) return;
    try {
      const n = await DB.cargarQuickBooks();
      toast(`Cargado: ${n.clientes} clientes, ${n.facturas} facturas, ${n.pagos} pagos, ${n.cotizaciones} cotizaciones`);
      if (Sync.conectado()) { pintarEstadoNube('Subiendo a la nube…'); await Sync.subirTodo(); pintarEstadoNube(); }
      irA('panel');
    } catch (err) {
      toast('No se pudo cargar: ' + err.message);
    }
  });

  /* ── Versión visible: se lee del ?v= del propio HTML cargado, así
        siempre refleja lo que este dispositivo está viendo de verdad ── */
  {
    const m = (($('link[rel="stylesheet"]') || {}).href || '').match(/v=(\d+)/);
    if (m) $('.topbar-title').insertAdjacentHTML('beforeend', `<span class="topbar-ver">v${m[1]}</span>`);
  }

  /* ── Arranque ──
     Cada init va protegido: si un módulo falla (p. ej. un HTML viejo en
     caché con JS nuevo durante una actualización), el resto de la app
     sigue funcionando en vez de quedarse en blanco. */
  for (const M of [Clientes, Catalogo, Calculadora, Facturas, Cotizaciones, Confecciones, Finanzas, Inventario, Tareas]) {
    try { M.init(); } catch (e) { console.error('Init falló:', e); }
  }
  renderPanel();
  pintarEstadoNube();

  // ¿Llegamos con un enlace mágico? (#cfg=...) → pre-llenar la conexión
  const mCfg = location.hash.match(/^#cfg=(.+)$/);
  if (mCfg && !Sync.conectado()) {
    try {
      const c = JSON.parse(decodeURIComponent(escape(atob(mCfg[1]))));
      const f = $('#formNube');
      f.url.value = c.url || '';
      f.anonKey.value = c.anonKey || '';
      f.email.value = c.email || '';
      history.replaceState(null, '', location.pathname + location.search);
      irA('ajustes');
      setTimeout(() => {
        toast('Conexión lista: escribe tu clave y presiona Conectar');
        f.password.focus();
      }, 300);
    } catch { /* enlace inválido: se ignora */ }
  }

  // Si quedó guardada una versión anterior del texto de garantía, actualizarla
  async function actualizarGarantiaVieja() {
    const emp = await DB.config.get('empresa');
    if (!emp || !emp.garantia) return;
    const esVersionVieja =
      emp.garantia.includes('garantía de fabricación de 6 meses') ||
      (emp.garantia.includes('90 días') && !emp.garantia.includes('limpieza')) ||
      (emp.garantia.includes('por vida') && !emp.garantia.includes('vermeil'));
    let cambio = false;
    if (esVersionVieja) { emp.garantia = UI.EMPRESA_DEFECTO.garantia; cambio = true; }
    if (!emp.direccion) { emp.direccion = UI.EMPRESA_DEFECTO.direccion; cambio = true; }
    if (!emp.razon) { emp.razon = UI.EMPRESA_DEFECTO.razon; cambio = true; }
    if (!emp.rnc) { emp.rnc = UI.EMPRESA_DEFECTO.rnc; cambio = true; }
    if (emp.pie && emp.pie.includes('@silvershine.rd')) { emp.pie = UI.EMPRESA_DEFECTO.pie; cambio = true; }
    if (cambio) await DB.config.upsert(emp);
  }

  /* ── Migración única: facturas duplicadas del export de QuickBooks
        (31 jul 2026). QB traía la factura interna (sin NCF o "#17xx") Y
        la re-emitida con NCF — mismo cliente, mismo monto, días de
        diferencia. Se anula la versión sin NCF (todas saldo 0, sin
        abonos: la deuda no cambia). Detectadas al inflarse las ventas
        de marzo. ── */
  async function limpiarDuplicadasQB() {
    /* Sin bandera de "ya corrió": verifica los datos reales en cada arranque
       y repara lo que falte (un bug de la cola de sync llegó a perder estos
       cambios en la nube). Es idempotente: solo toca lo que está mal. */
    if (!(await DB.facturas.list()).length) return;   // sin datos aún
    const DUPLICADAS = [                   // [facturaId sin NCF, NCF gemela]
      ['fac-qb-00086', 'B0200001898'],     // Ramón Moisés Ruiz 5,050
      ['fac-qb-00089', 'B0200001896'],     // Eddy Guzman 75,810
      ['fac-qb-00104', 'B0200001879'],     // Wilgrady Ferreira 39,800
      ['fac-qb-00105', 'B0200001877'],     // Yendy Valenzuela 35,000
      ['fac-qb-00115', 'B0200001880'],     // Albert Rodriguez 4,300
      ['fac-qb-00120', 'B0200001870'],     // Miguel Severino 90,000
      ['fac-qb-00122', 'B020001865'],      // Elisel David Salcie 50,000
      ['fac-qb-00145', 'B0200001845'],     // Daniel Hernández 9,900
      ['fac-qb-00160', 'B02000001834'],    // Johanderson Quezada 64,000
      ['fac-qb-00175', 'B0200001817'],     // Reimy Columna 30,500
      ['fac-qb-00187', 'B0200001809'],     // Neftalí Omar 4,800
      ['fac-qb-00199', 'B0200001796'],     // Milton Escalante 38,500
      ['fac-qb-00205', 'B0200001791'],     // Milka Mejía 86,895
      ['fac-qb-00229', 'B0200001775'],     // Endry Piñeyro 56,000
      ['fac-qb-00232', 'B0200001773'],     // Felix Matos 76,000
      ['fac-qb-00282', 'B0200001725'],     // Victor Rosario 6,300
      ['fac-qb-00307', 'B0200001703'],     // Geury Pacheco 29,000
      ['fac-qb-00316', 'B0200001694'],     // José Elías López 9,300
      ['fac-qb-00357', 'B0200001660'],     // Alexis Jose Diaz 44,000
      ['fac-qb-00362', 'B0200001656'],     // Miguel Iván Frias 77,000.14 (gemela con ¢14 de diferencia)
      ['fac-qb-00468', 'B0200001557'],     // Neury 7,500
      ['fac-qb-00470', 'B0200001555'],     // Jacier Cabral 83,500 (la válida es de 82,500 — confirmado por el usuario 1 ago)
      ['fac-qb-00485', 'B0200001538'],     // Ydalmis Jazmin 6,000
      ['fac-qb-00496', 'B0200001533'],     // Emmanuel Martinez 8,400
    ];
    /* Facturas internas SIN NCF que se re-facturaron con comprobante (a veces
       con el monto ajustado). QuickBooks no las cuenta como ventas; con ellas
       anuladas el CRM cuadra con QuickBooks mes por mes al centavo
       (confirmado por el usuario contra los balances de QB, 31 jul 2026). */
    const INTERNAS_SIN_NCF = [               // [facturaId, NCF de la re-emisión]
      ['fac-qb-00396', 'B0200001626'],       // Brahian Gómez 8,000
      ['fac-qb-00393', 'B0200001629'],       // Edison Matos 9,000
      ['fac-qb-00377', 'B0200001642'],       // Steven Nuñez 8,100
      ['fac-qb-00361', 'B0200001657'],       // Javier Mendez 9,500
      ['fac-qb-00343', 'B0200001671'],       // Abel Ferrer 8,925
      ['fac-qb-00339', 'B0200001677'],       // Nestor Nouel 9,440
      ['fac-qb-00328', 'B0200001686'],       // José Eduardo Gil 9,425
      ['fac-qb-00283', 'B0200001724'],       // Yaisy Solís 3,500
      ['fac-qb-00273', 'B0200001734'],       // Carlos Reyes 6,000
      ['fac-qb-00260', 'B0200001745'],       // Cesar Israel Feliz 4,500
      ['fac-qb-00245', 'B0200001756'],       // Juan Ramon Paulino 33,000
      ['fac-qb-00244', 'B0200001763'],       // Marisol Salazar 8,100
      ['fac-qb-00240', 'B0200001766'],       // Carlos Mansel 8,670
      ['fac-qb-00222', 'B0200001780'],       // Kevyn Perez Cordero 36,500
      ['fac-qb-00223', 'B0200001779'],       // Ezequiel Pérez Mota 8,925
      ['fac-qb-00213', 'B0200001785'],       // Flerida Dominguez 3,800
      ['fac-qb-00214', 'B0200001786'],       // Joel Diaz Suero 8,100
      ['fac-qb-00190', 'B0200001807'],       // Jose Alberto Martinez 84,880
      ['fac-qb-00158', 'B0100001836'],       // Kémil Cuesta #1691 7,500
      ['fac-qb-00139', 'B0200001857'],       // Shanti Peña #1700 8,500
      ['fac-qb-00092', ''],                  // Emmanuel Martinez #1738 500
    ];
    let anuladas = 0;
    const anular = async (fid, nota) => {
      const f = await DB.facturas.get(fid);
      if (!f || f.estado === 'anulada') return;
      if (f.saldo > 0 || (f.abonos || []).length) return;   // por seguridad: solo saldadas sin abonos
      f.estado = 'anulada';
      f.notas = [f.notas, nota].filter(Boolean).join('\n');
      await DB.facturas.upsert(f);
      anuladas++;
    };
    for (const [fid, ncf] of DUPLICADAS) {
      await anular(fid, `Duplicado del export de QuickBooks — la válida es ${ncf}. Anulada en la limpieza del 31 jul 2026.`);
    }
    for (const [fid, ncf] of INTERNAS_SIN_NCF) {
      await anular(fid, `Factura interna sin NCF${ncf ? ` re-facturada como ${ncf}` : ''} — QuickBooks no la cuenta como venta. Anulada en el cuadre del 31 jul 2026.`);
    }
    if (anuladas) toast(`🧹 ${anuladas} facturas anuladas para cuadrar con QuickBooks`);
  }

  /* ── Reparar enlaces cotización→factura perdidos (auto-reparable):
        al convertir, la factura guarda "Según cotización COT-n"; si la
        cotización quedó sin facturaId (corte de sync a mitad del guardado),
        aquí se re-enlaza y se marca aceptada para que salga del visor. ── */
  async function repararEnlacesCotizacion() {
    const cots = await DB.cotizaciones.list();
    const sueltas = cots.filter(c => !c.facturaId);
    if (!sueltas.length) return;
    const facts = (await DB.facturas.list()).filter(f => f.estado !== 'anulada');
    const reclamadas = new Set(cots.map(x => x.facturaId).filter(Boolean));
    const enlazar = async (c, f, como) => {
      c.facturaId = f.id;
      c.estado = 'aceptada';
      reclamadas.add(f.id);
      await DB.cotizaciones.upsert(c);
      toast(`🔗 Cotización COT-${c.numero} enlazada a su factura${como ? ` (${como})` : ''}`);
    };
    // Pase 1: la factura dice de cuál cotización nació (botón Convertir).
    // Regex laxo a propósito: solo busca "COT-n" — las notas escritas por
    // versiones con el encoding dañado dicen "SegÃºn cotizaciÃ³n" y el
    // texto exacto no matchearía.
    for (const f of facts) {
      if (reclamadas.has(f.id)) continue;
      const m = /COT-([^\s.,;]+)/.exec(f.notas || '');
      if (!m) continue;
      const c = sueltas.find(x => String(x.numero).trim() === m[1].trim() && x.clienteId === f.clienteId && !x.facturaId);
      if (c) await enlazar(c, f, '');
    }
    // Pase 2: factura hecha A MANO tras la cotización — mismo cliente,
    // mismo monto exacto y fecha entre la cotización y 60 días después
    const dias = iso => Math.round(new Date(iso + 'T00:00:00') / 864e5);
    for (const c of sueltas) {
      if (c.facturaId || !c.clienteId || !(c.total > 0)) continue;
      if (!['pendiente', 'enviada', 'borrador', 'aceptada'].includes(c.estado)) continue;
      const f = facts.find(f => !reclamadas.has(f.id) && f.clienteId === c.clienteId &&
        Math.abs((f.total || 0) - c.total) < 0.01 && (f.moneda || 'DOP') === (c.moneda || 'DOP') &&
        f.fecha && c.fecha && dias(f.fecha) >= dias(c.fecha) && dias(f.fecha) - dias(c.fecha) <= 60);
      if (f) await enlazar(c, f, 'mismo cliente y monto');
    }
  }

  /* ── Ajustes del 31 jul (auto-reparable): costos confirmados por el
        usuario. OJO: aquí ANTES se anulaba la B0200001940 de Samuel —
        el usuario aclaró después que NO era duplicada; esa parte se
        eliminó y restaurarSamuel1940 revierte lo ya anulado. ── */
  async function ajustesConfirmados31Jul() {
    if (!(await DB.facturas.list()).length) return;   // sin datos aún
    const real = await DB.facturas.get('fac-qb-00044');           // Samuel B0200001941
    if (real && !(real.costo > 0)) { real.costo = 22200; await DB.facturas.upsert(real); }
    const j = await DB.facturas.get('fac-qb-00473');              // Jacier B0200001555
    if (j && !(j.costo > 0)) { j.costo = 4000; await DB.facturas.upsert(j); }
  }

  /* ── Restauración de la B0200001940 de Samuel (auto-reparable): si está
        anulada POR LA MIGRACIÓN VIEJA (se reconoce por su nota), se
        restaura con su balance. Una anulación manual del usuario (sin esa
        nota) se respeta y no se toca. ── */
  async function restaurarSamuel1940() {
    const f = await DB.facturas.get('fac-qb-00045');
    if (!f) return;
    if (f.estado === 'anulada' && String(f.notas || '').includes('Duplicado confirmado por el usuario')) {
      f.estado = f.saldo > 0.005 ? 'pendiente' : 'pagada';
      f.notas = String(f.notas || '').split('\n').filter(l => !l.includes('Duplicado confirmado por el usuario')).join('\n');
      await DB.facturas.upsert(f);
      toast('↩ Factura B0200001940 de Samuel Tejeda restaurada');
    }
  }

  /* ── Migración única: costos de producción 2026 entregados por el
        usuario (31 jul 2026, lista "Órdenes/Confecciones en China").
        Solo pone el costo si la factura aún no tiene; corre una vez
        (bandera en config, sincronizada entre dispositivos). ── */
  async function migrarCostos2026() {
    /* Sin bandera: repara costos faltantes en cada arranque (nunca pisa
       un costo ya puesto, así que una corrección manual queda intacta). */
    if (!(await DB.facturas.list()).length) return;   // sin datos aún
    const COSTOS = [                       // [facturaId, costo]
      ['fac-qb-00397', 18500],             // Saul Ogando Blanco ("Raul" en la lista)
      ['fac-qb-00403', 23500],             // Alissa Batista
      ['fac-qb-00356', 30000],             // Alfonso Fernandez
      ['fac-qb-00341', 34000],             // Samson Ashley
      ['fac-qb-00336', 25000],             // Julio César Núñez Mota
      ['fac-qb-00291', 34000],             // Fernando A. Bordas
      ['fac-qb-00182', 27218],             // Claudio Javier Adams
      ['fac-qb-00174', 25048],             // Martin Arias
      ['fac-qb-00359', 36000],             // Alexis Jose Diaz
      ['fac-qb-00113', 22000],             // Yendy Valenzuela
      ['fac-qb-00116', 25000],             // Eric Joel Paredes
      ['fac-qb-00121', 54002],             // Miguel Severino
      ['fac-qb-00111', 24800],             // Wilgrady Ferreira Morel
      ['fac-qb-00082', 3000],              // Jesus Miguel Toribio
      ['fac-qb-00090', 30000],             // Eddy Guzman
      ['fac-qb-00073', 23280],             // Rafael Diplán Suazo
      ['fac-qb-00070', 39480],             // Jonathan Perez
      ['fac-qb-00056', 13320],             // Randy Lebrón Michel
      ['fac-qb-00045', 22200],             // Samuel Tejeda
      ['fac-qb-00041', 24840],             // Oliver Ramírez
      ['fac-qb-00048', 15636],             // Jerson de oleo Perez
      ['fac-qb-00030', 46860],             // Ruth Celeste Feliz
      ['fac-qb-00028', 25000],             // Jean Carlos Osoria
      ['fac-qb-00027', 26280],             // Angel Renville
      ['fac-qb-00021', 32580],             // Elianna Fiallo
      ['fac-qb-00018', 67980],             // Raymond Garcia
      ['fac-qb-00017', 32400],             // Ernesto Agustin Garcia
      ['fac-qb-00016', 58920],             // Josue Berroa
      ['fac-qb-00012', 7680],              // Misael Sosa
      ['fac-qb-00004', 20820],             // Junior Vega
      ['fac-qb-00042', 39600],             // Fabrina Feliz Velazquez
      ['fac-qb-00001', 32400],             // Yitty Jiron ("Yitti Jeron" en la lista)
    ];
    let puestos = 0;
    for (const [fid, costo] of COSTOS) {
      const f = await DB.facturas.get(fid);
      if (!f || f.costo > 0) continue;
      f.costo = costo;
      await DB.facturas.upsert(f);
      puestos++;
    }
    if (puestos) toast(`📈 Costos 2026 aplicados a ${puestos} facturas`);
  }

  /* ── Migración única: clientes con plan EasyPay confirmados por el
        usuario (28 jul 2026). Sus facturas pendientes pasan al módulo
        EasyPay con las cuotas por programar. Idempotente. ── */
  async function migrarPlanesEasyPay() {
    const PLANES = [                                  // [clienteId, numero de factura]
      ['cli-qb-01383', 'B0200001955'],                // Ruth Celeste Feliz
      ['cli-qb-01129', 'B0200001656'],                // Miguel Iván Frias Jiménez
      ['cli-qb-00011', 'B0200001931'],                // Adan Alexis Gómez Bocio
      ['cli-qb-01039', 'B0200001843'],                // Marcos Guerrero
      ['cli-qb-01145', 'B0200001796'],                // Milton Escalante
      ['cli-qb-01203', 'B0200001946'],                // Nidia Carolina Núñez Martínez
      ['cli-qb-00415', 'B020001865'],                 // Elisel David Salcie Arias
      ['cli-qb-01359', 'B0200001498'],                // Ronnel Rodríguez Bido
    ];
    const facts = await DB.facturas.list();
    const hoy = new Date();
    let marcadas = 0;
    for (const [cid, numero] of PLANES) {
      const f = facts.find(x => x.clienteId === cid && x.numero === numero);
      if (!f || f.estado !== 'pendiente' || !(f.saldo > 0)) continue;
      if (f.planPago && f.planPago.cuotas && f.planPago.cuotas.length) continue;   // ya tiene plan con cuotas

      // Pagos mensuales: el día de pago es el día de la factura.
      // La cuota se estima del ritmo real: pagado ÷ meses transcurridos.
      const fechaF = new Date(f.fecha + 'T00:00:00');
      const pagado = Math.round((f.total - f.saldo) * 100) / 100;
      const mesesTrans = Math.max(1, Math.round((hoy - fechaF) / (30.44 * 864e5)));
      const ritmo = pagado / mesesTrans;
      const n = ritmo > 0 ? Math.min(12, Math.max(1, Math.round(f.saldo / ritmo))) : 3;

      // Aniversario mensual conservando el día de la factura
      // (sin el desborde de JS: 30 ene + 1 mes NO es 2 mar, es el último día de feb)
      const dia = fechaF.getDate();
      const aniversario = k => {
        const d = new Date(fechaF.getFullYear(), fechaF.getMonth() + k, 1);
        const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(dia, ultimo));
        return d;
      };
      let k = 1;
      while (aniversario(k) <= hoy) k++;

      const base = Math.floor(f.saldo / n * 100) / 100;
      const cuotas = [];
      let acum = 0;
      for (let i = 0; i < n; i++) {
        const monto = i === n - 1 ? Math.round((f.saldo - acum) * 100) / 100 : base;
        acum = Math.round((acum + monto) * 100) / 100;
        cuotas.push({ fecha: UI.fechaISO(aniversario(k + i)), monto });
      }
      f.planPago = { tipo: 'easypay', inicial: pagado, frecuencia: 'mensual', cuotas };
      f.proxCobro = { fecha: cuotas[0].fecha, monto: cuotas[0].monto };
      await DB.facturas.upsert(f);
      marcadas++;
    }
    if (marcadas) console.info(`Planes EasyPay mensuales generados: ${marcadas}`);
  }

  // Si el catálogo está vacío, cargar el de Shopify automáticamente
  async function cargarCatalogoSiVacio() {
    if ((await DB.productos.list()).length) return;
    try {
      const n = await DB.cargarCatalogoShopify();
      if (n) {
        toast(`🛍 Catálogo de Shopify cargado (${n} diseños)`);
        if (Sync.conectado()) await Sync.subirTodo();
      }
    } catch { /* sin archivo o sin red: se queda vacío */ }
  }

  $('#btnCargarCatalogo').addEventListener('click', async () => {
    if (!confirm('Esto REEMPLAZA el catálogo actual con los productos publicados en silvershine.com.do. ¿Continuar?')) return;
    try {
      const n = await DB.cargarCatalogoShopify();
      await seedProductoConfeccion();   // la recarga reemplaza el catálogo: reponer el producto
      toast(`🛍 Catálogo recargado: ${n} diseños`);
      if (Sync.conectado()) { pintarEstadoNube('Subiendo catálogo…'); await Sync.subirTodo(); pintarEstadoNube(); }
      irA('catalogo');
    } catch (err) {
      toast('No se pudo recargar: ' + err.message);
    }
  });

  /* ── Adoptar al módulo Confecciones las tareas de taller viejas ──
     Auto-reparable: corre en cada arranque pero NUNCA pisa una
     f.confeccion existente (los estados que ponga el usuario mandan).
     Tarea hecha = pieza ya entregada. */
  async function migrarConfecciones() {
    const facturas = await DB.facturas.list();
    if (!facturas.length) return;
    const tareas = await DB.tareas.list();
    for (const t of tareas) {
      const m = /^Confección \((\d+) días\) — Factura (.+)$/.exec(t.titulo || '');
      if (!m) continue;
      const ref = m[2].trim();
      const f = facturas.find(x => ref.startsWith('#')
        ? String(x.orden || '') === ref.slice(1)
        : (x.numero || '') === ref);
      if (!f || f.confeccion || f.estado === 'anulada') continue;
      const dias = Number(m[1]);
      const inicio = (t.pasos && t.pasos[0] && t.pasos[0].fecha) || t.fecha || UI.fechaISO();
      const d = new Date(inicio + 'T00:00:00'); d.setDate(d.getDate() + dias);
      f.confeccion = { inicio, dias, entrega: UI.fechaISO(d), estado: t.hecha ? 'entregada' : 'taller' };
      if (t.hecha) f.confeccion.entregadaEl = f.confeccion.entrega;
      await DB.facturas.upsert(f);
    }
  }

  /* ── Producto "Confección personalizada" en el catálogo ──
     Al facturarlo, el CRM detecta la línea y pacta la confección solo.
     Auto-reparable: se repone si falta (p. ej. tras recargar el catálogo
     de Shopify, que REEMPLAZA los productos). Corre DESPUÉS de
     cargarCatalogoSiVacio para no bloquear la carga inicial de Shopify. */
  async function seedProductoConfeccion() {
    const prods = await DB.productos.list();
    if (!prods.length) return;   // catálogo aún sin cargar: no estorbar
    if (prods.some(p => /confecci/i.test(`${p.nombre || ''} ${p.categoria || ''}`))) return;
    await DB.productos.upsert({
      id: 'prod-confeccion',
      nombre: 'Confección personalizada',
      categoria: 'Confecciones',
      precio: 0, moneda: 'DOP',
      notas: 'Pieza por encargo: al facturar este producto, el CRM registra la confección automáticamente.',
    });
  }

  // Al abrir: vaciar cambios pendientes, bajar lo último y asignar órdenes si faltan
  Sync.alAbrir().then(async ok => {
    await migrarOrdenes();
    await migrarPlanesEasyPay();
    await limpiarDuplicadasQB();
    await migrarCostos2026();
    await ajustesConfirmados31Jul();
    await restaurarSamuel1940();
    await repararEnlacesCotizacion();
    await migrarConfecciones();
    await actualizarGarantiaVieja();
    await cargarCatalogoSiVacio();
    await seedProductoConfeccion();
    if (ok) pintarEstadoNube();
    renderPanel();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
