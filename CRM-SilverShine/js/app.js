/* ═══════════════════════════════════════════════════════════
   app.js — Navegación, panel y ajustes.
   ═══════════════════════════════════════════════════════════ */
(() => {
  const { $, $$, toast } = UI;

  /* ── Navegación entre vistas ── */
  const vistas = {
    clientes: () => Clientes.render(),
    catalogo: () => Catalogo.render(),
    panel:    () => renderPanel(),
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
    const clientes  = await DB.clientes.list();
    const productos = await DB.productos.list();
    $('#panelStats').innerHTML = `
      <div class="stat"><div class="n">${clientes.length}</div><div class="l">Clientes</div></div>
      <div class="stat"><div class="n">${productos.length}</div><div class="l">Productos</div></div>
      <div class="stat"><div class="n">—</div><div class="l">Por cobrar</div></div>
      <div class="stat"><div class="n">—</div><div class="l">Mes facturado</div></div>
    `;
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
      irA('panel');
    } catch {
      toast('El archivo no es un respaldo válido');
    }
    e.target.value = '';
  });

  /* ── Arranque ── */
  Clientes.init();
  Catalogo.init();
  renderPanel();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
