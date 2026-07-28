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
  const fmtFecha = iso => {
    if (!iso) return '';
    // 'YYYY-MM-DD' se interpreta como hora local (con solo fecha, JS asume UTC y resta un día)
    const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
    return d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
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
    rnc: '',
    direccion: 'Plaza APH, 4to piso, local 25, Piantini, Santo Domingo',
    telefono: '829-956-6588',
    correo: 'Info@silvershinee.com',
    web: 'silvershine.com.do',
    garantia: 'GARANTÍA SILVERSHINE — Piezas de oro sólido: garantía de por vida. Piezas de plata: garantía de 1 año. La garantía cubre defectos de fabricación (soldaduras, engastes, cierres y terminación). No cubre desgaste natural, golpes, maltrato ni contacto con químicos o perfumes. Cambios dentro de los primeros 90 días presentando esta factura, con la pieza en buen estado. Incluye limpieza profesional GRATIS una vez al año para todas sus piezas.',
    pie: 'Gracias por preferir SilverShine ✦ silvershine.com.do · Instagram @silvershine.rd',
    cuentas: '🏦 Banco Popular — Cta. de Ahorros 810146357\nCandy Morillo · Céd. 001-1622375-1\n\n🏦 Banreservas — Cta. de Ahorros 9604648520\nGrupo Morillo Ciprian SRL · RNC 132-44210-5\n\n🏦 BHD León — Cta. de Ahorros 11777670031\nCindy Ciprian · Céd. 001-1873046-4',
  };
  async function getEmpresa() {
    const guardada = await DB.config.get('empresa');
    return { ...EMPRESA_DEFECTO, ...(guardada || {}) };
  }

  /* Imprimir el área de impresión esperando a que el logo cargue */
  async function imprimirArea() {
    const img = $('#printArea .p-logo');
    if (img && !img.complete) {
      await new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 1500); });
    }
    window.print();
  }

  return { $, $$, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, iniciales, esc, comprimirFoto, getEmpresa, EMPRESA_DEFECTO, imprimirArea };
})();
