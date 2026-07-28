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
    return new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
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

  return { $, $$, abrirModal, cerrarModal, toast, fmtMoneda, fmtFecha, iniciales, esc, comprimirFoto };
})();
