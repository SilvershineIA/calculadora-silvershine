/* ═══════════════════════════════════════════════════════════
   ui.js — Helpers compartidos: modal, toast, formatos.
   ═══════════════════════════════════════════════════════════ */
const UI = (() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ── Modal ── */
  const bg    = $('#modalBg');
  const title = $('#modalTitle');
  const body  = $('#modalBody');

  function abrirModal(titulo, html) {
    title.textContent = titulo;
    body.innerHTML = html;
    bg.hidden = false;
    document.body.style.overflow = 'hidden';
    return body;
  }
  function cerrarModal() {
    bg.hidden = true;
    body.innerHTML = '';
    document.body.style.overflow = '';
  }
  $('#modalClose').addEventListener('click', cerrarModal);
  bg.addEventListener('click', e => { if (e.target === bg) cerrarModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !bg.hidden) cerrarModal(); });

  /* ── Toast ── */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  /* ── Formatos ── */
  const fmtMoneda = (monto, moneda = 'DOP') => {
    const simbolo = moneda === 'USD' ? 'US$' : 'RD$';
    return simbolo + Number(monto || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  /* Fecha ISO en HORA LOCAL (RD = UTC−4). Con toISOString (hora universal),
     de 8:00 pm en adelante "hoy" saltaba al día siguiente y los abonos,
     gastos y seguimientos nocturnos quedaban con la fecha de mañana. */
  const fechaISO = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fmtFecha = iso => {
    if (!iso) return '';
    // 'YYYY-MM-DD' se interpreta como hora local (con solo fecha, JS asume UTC y resta un día)
    const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
    return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  /* Dinero para tarjetas de resumen: sin centavos, que los KPI no los necesitan */
  const fmtDinero = (monto, moneda = 'DOP') =>
    (moneda === 'USD' ? 'US$' : 'RD$') + Math.round(Number(monto) || 0).toLocaleString('es-DO');

  /* Tarjeta de estadística: la letra baja de tamaño sola si el número es largo
     (así nunca se parte en dos líneas) y el símbolo de moneda va más pequeño. */
  const statTile = (valor, label, clase = '', tileClase = '') => {
    const s = String(valor);
    const tam = s.length >= 14 ? 'n-sm' : s.length >= 11 ? 'n-md' : '';
    const html = esc(s).replace(/^(RD\$|US\$)/, '<span class="cur">$1</span>');
    return `<div class="stat ${tileClase}"><div class="n ${clase} ${tam}">${html}</div><div class="l">${label}</div></div>`;
  };
  const iniciales = nombre => (nombre || '?')
    .trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ── Foto: leer archivo y comprimir a JPEG ── */
  function comprimirFoto(file, maxLado = 700, calidad = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagen no válida'));
        img.onload = () => {
          const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width  = Math.round(img.width  * escala);
          c.height = Math.round(img.height * escala);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', calidad));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── Datos de la empresa (editables en Ajustes, con valores por defecto) ── */
  const EMPRESA_DEFECTO = {
    id: 'empresa',
    nombre: 'SilverShine',
    vendedor: 'José',
    razon: 'Grupo Morillo Ciprian SRL',
    rnc: '132-44210-5',
    direccion: 'Plaza APH, 4to piso, local 25, Piantini, Santo Domingo',
    telefono: '829-956-6588',
    correo: 'Info@silvershinee.com',
    web: 'silvershine.com.do',
    garantia: 'GARANTÍA SILVERSHINE — Piezas de oro sólido: garantía de por vida. Piezas de plata: garantía de 1 año. Cubre defectos de fabricación (soldaduras, engastes, cierres y terminación). No cubre: arreglos o modificaciones realizados en otros talleres, ni el uso extremo de las piezas (golpes, maltrato o contacto con químicos). En piezas vermeil no cubre el desgaste natural del baño de oro, propio de todos los baños de oro del mercado. Cambios dentro de los primeros 90 días presentando esta factura, con la pieza en buen estado. Incluye limpieza profesional GRATIS una vez al año para todas sus piezas.',
    pie: 'Gracias por preferir SilverShine ✦ silvershine.com.do · WhatsApp 829-956-6588 · IG @silvershinerd · @confecciones_silvershinerd',
    cuentas: '🏦 Banco Popular — Cta. de Ahorros 810146357\nCandy Morillo · Céd. 001-1622375-1\n\n🏦 Banreservas — Cta. de Ahorros 9604648520\nGrupo Morillo Ciprian SRL · RNC 132-44210-5\n\n🏦 BHD León — Cta. de Ahorros 11777670031\nCindy Ciprian · Céd. 001-1873046-4',
  };
  async function getEmpresa() {
    const guardada = await DB.config.get('empresa');
    return { ...EMPRESA_DEFECTO, ...(guardada || {}) };
  }

  /* Firma personal de los mensajes: "José de SilverShine" (editable en Ajustes) */
  const quienSaluda = emp => emp.vendedor ? `${emp.vendedor} de ${emp.nombre}` : emp.nombre;

  /* ── Rango de fechas para historiales: Hoy · Semana · Mes · Todo ── */
  const RANGOS = [['dia', 'Hoy'], ['semana', '7 días'], ['mes', 'Este mes'], ['todo', 'Todo']];
  function enRango(fecha, rango) {
    if (rango === 'todo') return true;
    if (!fecha) return false;
    const hoy = fechaISO();
    if (rango === 'dia') return fecha === hoy;
    if (rango === 'semana') return fecha >= fechaISO(new Date(Date.now() - 7 * 864e5));
    return fecha.slice(0, 7) === hoy.slice(0, 7);   // mes calendario
  }
  const chipsRango = activo => `<div class="chips" style="margin:8px 0">${
    RANGOS.map(([k, t]) => `<button type="button" class="chip-tab mini chip-rango ${k === activo ? 'on' : ''}" data-rango="${k}">${t}</button>`).join('')}</div>`;

  /* ── Chips de navegación cruzada: saltar entre los detalles de los
     módulos enlazados (cliente ↔ factura ↔ cotización ↔ confección ↔
     cobro). navChips(items) da el HTML; navWire(items) conecta los
     clics una vez insertado en el modal. items = [{t, on}] ── */
  const navChips = items => !items.length ? '' :
    `<div class="chips" style="margin:0 0 12px">${items.map((x, i) =>
      `<button type="button" class="chip-tab mini" data-nav="${i}">${x.t} ›</button>`).join('')}</div>`;
  const navWire = items => $$('[data-nav]').forEach(b =>
    b.addEventListener('click', () => items[Number(b.dataset.nav)].on()));

  /* ── WhatsApp: teléfono o @usuario ──
     Los usernames de WhatsApp NO tienen enlace tipo wa.me (hay que buscar
     el @usuario exacto dentro de la app), así que sin teléfono copiamos
     el mensaje al portapapeles y avisamos a quién buscar. */
  const normUsuarioWA = v => String(v || '').trim().replace(/^@+/, '').toLowerCase();
  // Reglas oficiales: 3-35 caracteres, letras/números/punto/guion bajo,
  // al menos una letra y sin empezar por "www." (WhatsApp valida el resto al reclamarlo)
  const usuarioWAValido = u => /^[a-z0-9._]{3,35}$/.test(u) && /[a-z]/.test(u) && !u.startsWith('www.');
  const tieneWhatsApp = c => !!(c && ((c.telefono || '').trim() || c.usuarioWA));

  const copiarTexto = async txt => {
    try { await navigator.clipboard.writeText(txt); return true; } catch { return false; }
  };

  /* En ESCRITORIO no se navega a wa.me: eso pisa/cierra el WhatsApp Web
     que el usuario mantiene abierto. En su lugar, panel flotante para
     copiar número o @usuario (y el mensaje) y buscarlo directo en su
     pestaña de WhatsApp Web. En el celular, wa.me sigue siendo lo mejor. */
  function panelWhatsApp(cliente, mensaje) {
    const previo = document.getElementById('waPanel');
    if (previo) previo.remove();
    const telCrudo = (cliente.telefono || '').trim();
    const user = cliente.usuarioWA ? '@' + cliente.usuarioWA : '';
    const div = document.createElement('div');
    div.id = 'waPanel';
    div.innerHTML = `
      <div class="wa-info"><b>💬 ${esc(cliente.nombre || '')}</b>
        <span class="muted">${esc(telCrudo || user)} · mensaje ya copiado</span></div>
      ${telCrudo ? `<button type="button" class="btn-gold btn-sm" data-c="tel">📋 Copiar número</button>` : ''}
      ${user ? `<button type="button" class="btn-gold btn-sm" data-c="user">📋 Copiar ${esc(user)}</button>` : ''}
      <button type="button" class="btn-ghost btn-sm" data-c="msg">📋 Mensaje otra vez</button>
      <button type="button" class="btn-x" data-cerrar>✕</button>`;
    document.body.appendChild(div);
    copiarTexto(mensaje);
    div.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', async () => {
      const q = b.dataset.c;
      const ok = await copiarTexto(q === 'tel' ? telCrudo.replace(/\D/g, '') : q === 'user' ? user : mensaje);
      const original = b.textContent;
      b.textContent = ok ? '✓ Copiado' : '⚠ No se pudo';
      setTimeout(() => { b.textContent = original; }, 1400);
    }));
    div.querySelector('[data-cerrar]').addEventListener('click', () => div.remove());
  }

  async function abrirWhatsApp(cliente, mensaje) {
    const movil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const tel = (cliente.telefono || '').replace(/\D/g, '');
    if (movil && tel) {
      const num = tel.length === 10 ? '1' + tel : tel;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`, '_blank');
      return;
    }
    if (movil && cliente.usuarioWA) {
      await copiarTexto(mensaje);
      toast(`📋 Mensaje copiado — en WhatsApp busca a @${cliente.usuarioWA} y pégaselo`);
      return;
    }
    panelWhatsApp(cliente, mensaje);   // escritorio: copiar, nunca navegar
  }

  /* ── Buscador de clientes con creación rápida en el mismo campo ──
     Escribe → sugiere; si no existe → "➕ Crear cliente" abre un
     mini-formulario en el propio desplegable, lo crea y lo selecciona. */
  function buscadorCliente(inp, sug, alElegir) {
    const elegir = c => {
      inp.value = c.nombre;
      sug.hidden = true;
      alElegir(c);
    };

    const miniForm = nombre => {
      sug.innerHTML = `
        <div class="sug-form">
          <input data-campo="nombre" placeholder="Nombre *" value="${esc(nombre)}">
          <input data-campo="telefono" type="tel" placeholder="Teléfono (para WhatsApp)">
          <input data-campo="usuarioWA" placeholder="@usuario de WhatsApp (opcional)">
          <input data-campo="correo" type="email" placeholder="Correo (opcional)">
          <button type="button" class="btn-gold btn-sm" data-crear>➕ Crear y usar</button>
        </div>`;
      sug.querySelector('[data-campo="telefono"]').focus();
      sug.querySelector('[data-crear]').addEventListener('click', async () => {
        const v = campo => sug.querySelector(`[data-campo="${campo}"]`).value.trim();
        if (!v('nombre')) { toast('Ponle el nombre al cliente'); return; }
        const usuarioWA = normUsuarioWA(v('usuarioWA'));
        if (usuarioWA && !usuarioWAValido(usuarioWA)) {
          toast('Usuario de WhatsApp no válido (3-35 letras, números, . o _)'); return;
        }
        const nuevo = await DB.clientes.upsert({
          nombre: v('nombre'), telefono: v('telefono'), usuarioWA, correo: v('correo'),
          direccion: '', notas: '',
        });
        toast(`👤 Cliente "${nuevo.nombre}" creado`);
        elegir(nuevo);
      });
    };

    inp.addEventListener('input', async () => {
      alElegir(null);
      const q = inp.value.trim();
      if (q.length < 2) { sug.hidden = true; return; }
      const todos = await DB.clientes.list();
      const res = todos.filter(c => c.nombre.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
      sug.innerHTML =
        res.map(c => `<div class="sug" data-id="${c.id}">${esc(c.nombre)}<span class="muted"> ${esc(c.telefono || (c.usuarioWA ? '@' + c.usuarioWA : ''))}</span></div>`).join('') +
        `<div class="sug sug-nuevo" data-nuevo>➕ Crear cliente "${esc(q)}"</div>`;
      sug.hidden = false;
      sug.querySelectorAll('.sug[data-id]').forEach(el =>
        el.addEventListener('click', async () => elegir(await DB.clientes.get(el.dataset.id))));
      sug.querySelector('[data-nuevo]').addEventListener('click', () => miniForm(q));
    });
  }

  /* ── Reglas oficiales EasyPay (de silvershine.com.do/pages/easypay) ── */
  const EASYPAY_PLANES = {
    '4m':   { nombre: 'EasyPay 4 meses',      dep: 0.25, fee: 0,   min: 2, max: 4,  def: 4 },
    '6m':   { nombre: 'EasyPay 6 meses',      dep: 0.20, fee: 300, min: 4, max: 6,  def: 6 },
    '612m': { nombre: 'EasyPay 6 a 12 meses', dep: 0.15, fee: 500, min: 6, max: 12, def: 12 },
  };
  const EASYPAY_MIN = 7000;

  /* Cálculo idéntico al simulador de la página:
     reserva = max(precio × %, RD$7,000) topada al precio;
     cuota = restante/meses + tarifa administrativa. */
  function calcularEasyPay(precio, planId, meses) {
    const p = EASYPAY_PLANES[planId];
    if (!p || !(precio > 0)) return null;
    const m = Math.min(p.max, Math.max(p.min, Math.round(meses || p.def)));
    let reserva = Math.max(precio * p.dep, EASYPAY_MIN);
    if (reserva > precio) reserva = precio;
    reserva = Math.round(reserva * 100) / 100;
    const financiado = Math.round((precio - reserva) * 100) / 100;
    const cuota = m > 0 ? Math.round((financiado / m + p.fee) * 100) / 100 : 0;
    return { plan: planId, nombre: p.nombre, meses: m, reserva, financiado, fee: p.fee, cuota,
             totalConTarifas: Math.round((precio + p.fee * m) * 100) / 100 };
  }

  /* ── Buscador del catálogo con opciones en un clic ──
     Clic o escribir → productos; un producto con opciones
     (formato · material · gema) las despliega; clic → línea lista. */
  function buscadorCatalogo(inp, sug, alAgregar) {
    const cerrar = () => { sug.hidden = true; inp.value = ''; };
    const mostrarVariantes = p => {
      sug.innerHTML =
        `<div class="sug sug-volver" data-volver>← <b>${esc(p.nombre)}</b> — elige la opción:</div>` +
        p.variantes.map((v, i) =>
          `<div class="sug" data-var="${i}">${esc(v.nombre)}<span class="muted"> — ${fmtMoneda(v.precio, p.moneda)}</span></div>`).join('');
      sug.querySelector('[data-volver]').addEventListener('click', () => pintar(inp.value.trim()));
      sug.querySelectorAll('[data-var]').forEach(el => el.addEventListener('click', () => {
        const v = p.variantes[Number(el.dataset.var)];
        alAgregar({ descripcion: `${p.nombre} — ${v.nombre}`, precio: v.precio, moneda: p.moneda });
        cerrar();
      }));
    };
    const pintar = async q => {
      const productos = await DB.productos.list();
      const res = (q
        ? productos.filter(p => p.nombre.toLowerCase().includes(q.toLowerCase()))
        : productos).slice(0, 9);
      sug.innerHTML = res.map((p, i) => {
        const nVar = (p.variantes || []).length;
        return `<div class="sug" data-i="${i}">${esc(p.nombre)}<span class="muted"> — ${
          nVar ? nVar + ' opciones · desde ' : ''}${fmtMoneda(p.precio, p.moneda)}</span></div>`;
      }).join('') || '<div class="sug muted">Sin resultados en el catálogo</div>';
      sug.hidden = false;
      sug.querySelectorAll('[data-i]').forEach(el => el.addEventListener('click', () => {
        const p = res[Number(el.dataset.i)];
        if ((p.variantes || []).length) mostrarVariantes(p);
        else { alAgregar({ descripcion: p.nombre, precio: p.precio, moneda: p.moneda }); cerrar(); }
      }));
    };
    inp.addEventListener('focus', () => pintar(inp.value.trim()));
    inp.addEventListener('input', () => pintar(inp.value.trim()));
  }

  /* Imprimir el área de impresión esperando a que el logo cargue */
  async function imprimirArea() {
    const img = $('#printArea .p-logo');
    if (img && !img.complete) {
      await new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 1500); });
    }
    window.print();
  }

  return { $, $$, abrirModal, cerrarModal, toast, fmtMoneda, fmtDinero, statTile, fmtFecha, fechaISO, iniciales, esc, comprimirFoto, getEmpresa, EMPRESA_DEFECTO, quienSaluda, enRango, chipsRango, navChips, navWire, imprimirArea, buscadorCliente, buscadorCatalogo, EASYPAY_PLANES, EASYPAY_MIN, calcularEasyPay, normUsuarioWA, usuarioWAValido, tieneWhatsApp, abrirWhatsApp };
})();
