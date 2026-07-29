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
    cobros:       () => Cobros.render(),
    tareas:       () => Tareas.render(),
    panel:        () => renderPanel(),
    ajustes:      () => { pintarEstadoNube(); cargarFormEmpresa(); },
  };

  function irA(nombre) {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === nombre));
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === nombre));
    if (vistas[nombre]) vistas[nombre]();
    window.scrollTo({ top: 0 });
  }

  $$('.nav-btn').forEach(b => b.addEventListener('click', () => irA(b.dataset.view)));

  /* ── Panel ── */
  async function renderPanel() {
    const clientes = await DB.clientes.list();
    const facturas = await DB.facturas.list();

    const pendientes = facturas.filter(f => f.estado === 'pendiente' && f.saldo > 0);
    const porCobrar = pendientes.reduce((s, f) => s + f.saldo, 0);
    const mes = new Date().toISOString().slice(0, 7);
    const facturadoMes = facturas
      .filter(f => f.estado !== 'anulada' && (f.fecha || '').startsWith(mes))
      .reduce((s, f) => s + f.total, 0);

    $('#panelStats').innerHTML = `
      <div class="stat"><div class="n">${UI.fmtMoneda(porCobrar)}</div><div class="l">Por cobrar</div></div>
      <div class="stat"><div class="n">${pendientes.length}</div><div class="l">Fact. pendientes</div></div>
      <div class="stat"><div class="n">${UI.fmtMoneda(facturadoMes)}</div><div class="l">Facturado este mes</div></div>
      <div class="stat"><div class="n">${clientes.length}</div><div class="l">Clientes</div></div>
    `;

    // Cobros vencidos primero (van directo al detalle de cobro)
    const vencidos = pendientes.filter(f => Cobros.clasificar(f) === 'vencido')
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).slice(0, 6);
    $('#panelPendientes').innerHTML = vencidos.length ? vencidos.map(f => `
      <div class="item" data-id="${f.id}">
        <div class="item-info">
          <div class="item-name">${UI.esc(f.clienteNombre)}</div>
          <div class="item-sub">${UI.esc(f.numero || 's/n')} · ${UI.fmtFecha(f.fecha)}</div>
        </div>
        <b class="rojo">${UI.fmtMoneda(f.saldo, f.moneda)}</b>
      </div>`).join('')
      : '<p class="muted">🎉 No hay cobros vencidos.</p>';
    $('#panelPendientes').querySelectorAll('.item').forEach(el =>
      el.addEventListener('click', () => Cobros.detalle(el.dataset.id)));

    // Tareas de hoy y vencidas
    const tareas = (await DB.tareas.list()).filter(t => !t.hecha);
    const hoy = new Date().toISOString().slice(0, 10);
    const deHoy = tareas.filter(t => t.fecha && t.fecha <= hoy)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).slice(0, 5);
    $('#panelTareas').innerHTML = deHoy.length ? deHoy.map(t => `
      <div class="abono-row"><span>${t.fecha < hoy ? '🔴' : '📌'} ${UI.esc(t.titulo)}${t.clienteNombre ? ' · ' + UI.esc(t.clienteNombre) : ''}</span><span class="muted">${UI.fmtFecha(t.fecha)}</span></div>`).join('')
      : '<p class="muted">Sin tareas para hoy.</p>';
  }

  /* ── Ajustes: respaldo ── */
  $('#btnExportar').addEventListener('click', async () => {
    const data = await DB.exportar();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-crm-silvershine-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Respaldo descargado');
  });

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
    for (const campo of ['nombre', 'razon', 'rnc', 'direccion', 'telefono', 'correo', 'web', 'garantia', 'pie', 'cuentas']) {
      f[campo].value = emp[campo] || '';
    }
  }
  $('#formEmpresa').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const emp = { id: 'empresa' };
    for (const campo of ['nombre', 'razon', 'rnc', 'direccion', 'telefono', 'correo', 'web', 'garantia', 'pie', 'cuentas']) {
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

  /* ── Arranque ── */
  Clientes.init();
  Catalogo.init();
  Calculadora.init();
  Facturas.init();
  Cotizaciones.init();
  Tareas.init();
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
        cuotas.push({ fecha: aniversario(k + i).toISOString().slice(0, 10), monto });
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
      toast(`🛍 Catálogo recargado: ${n} diseños`);
      if (Sync.conectado()) { pintarEstadoNube('Subiendo catálogo…'); await Sync.subirTodo(); pintarEstadoNube(); }
      irA('catalogo');
    } catch (err) {
      toast('No se pudo recargar: ' + err.message);
    }
  });

  // Al abrir: vaciar cambios pendientes, bajar lo último y asignar órdenes si faltan
  Sync.alAbrir().then(async ok => {
    await migrarOrdenes();
    await migrarPlanesEasyPay();
    await actualizarGarantiaVieja();
    await cargarCatalogoSiVacio();
    if (ok) pintarEstadoNube();
    renderPanel();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
