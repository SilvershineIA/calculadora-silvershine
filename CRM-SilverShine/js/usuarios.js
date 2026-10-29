/* ═══════════════════════════════════════════════════════════
   usuarios.js — 👥 Usuarios del CRM con roles.
   Cada persona entra con SU correo/clave de Supabase (misma
   nube, mismos datos). El rol decide qué VISTAS ve:
   · admin   → todo (Cindy)
   · empleado → todo MENOS Finanzas, Cuadre y Ajustes (la puerta
     abierta para cuando haya empleados — la lista de vistas
     ocultas se ajusta en OCULTAS cuando José lo pida)
   José (dueño) es admin SIEMPRE, no se puede degradar ni quitar.
   La lista vive en el doc 'usuarios-crm' de config (sincronizada).
   OJO: esto es control de INTERFAZ — un empleado con conocimientos
   técnicos podría leer la nube por API. Para blindaje real habría
   que endurecer las políticas RLS por correo (pendiente si hace falta).
   ═══════════════════════════════════════════════════════════ */
const Usuarios = (() => {
  const { $, $$, toast, esc } = UI;

  const DUENO = 'morillo1785@gmail.com';
  /* vistas que cada rol NO ve (admin ve todo) */
  const OCULTAS = {
    empleado: ['finanzas', 'cuadre', 'ajustes'],
  };
  const ROLES = { admin: '👑 Admin — ve todo', empleado: '🧑‍💼 Empleado — sin Finanzas, Cuadre ni Ajustes' };

  let lista = [];   // [{nombre, email, rol}]
  let cargada = false;

  async function cargar() {
    try {
      const d = await DB.config.get('usuarios-crm');
      lista = (d && d.lista) || [];
    } catch { lista = []; }
    cargada = true;
    return lista;
  }
  const guardarLista = () => DB.config.upsert({ id: 'usuarios-crm', tipo: 'usuarios', lista });

  function rolActual() {
    const info = (typeof Sync !== 'undefined' && Sync.info()) || null;
    const email = ((info && info.email) || '').trim().toLowerCase();
    if (!email || email === DUENO) return 'admin';   // sin nube conectada, o el dueño
    const u = lista.find(x => (x.email || '').trim().toLowerCase() === email);
    /* conectado pero sin rol asignado → lo más restringido */
    return u && u.rol === 'admin' ? 'admin' : 'empleado';
  }
  const esAdmin = () => rolActual() === 'admin';
  const puedeVer = vista => !(OCULTAS[rolActual()] || []).includes(vista);

  /* esconde del menú lo que el rol no ve — recarga la lista SIEMPRE
     (es una lectura local barata y así nunca corre con cache viejo) */
  async function aplicar() {
    await cargar();
    $$('.nav-btn').forEach(b => { b.style.display = puedeVer(b.dataset.view) ? '' : 'none'; });
  }

  /* ── sección 👥 en Ajustes (solo la ve el admin) ── */
  async function pintarAjustes() {
    const cont = document.getElementById('usuariosCRM');
    if (!cont) return;
    await cargar();
    if (!esAdmin()) { cont.innerHTML = ''; return; }
    const info = (typeof Sync !== 'undefined' && Sync.info()) || {};
    cont.innerHTML = `
      <div class="card">
        <h2>👥 Usuarios de la app</h2>
        <p class="muted" style="margin-bottom:10px">Cada persona entra con SU correo y clave (misma nube, mismos datos) desde la sección ☁️ Nube de su dispositivo.
          <b>👑 Admin</b> ve todo · <b>🧑‍💼 Empleado</b> no ve Finanzas, Cuadre ni Ajustes.</p>
        <p class="muted" style="margin-bottom:12px"><b>Para crear uno:</b> ① Supabase → Authentication → Users → <b>Add user</b> (su correo + una clave, marca "Auto Confirm") · ② agrégalo aquí abajo con su rol · ③ pásale el correo y la clave.</p>
        <div class="abono-row"><span><b>José</b> · ${esc(DUENO)}<br><span class="muted" style="font-size:.78rem">dueño — siempre admin</span></span><b>👑</b></div>
        ${lista.map((u, i) => `
          <div class="abono-row"><span><b>${esc(u.nombre || '')}</b> · ${esc(u.email || '')}<br>
            <span class="muted" style="font-size:.78rem">${ROLES[u.rol] || esc(u.rol || '')}</span></span>
            <span style="display:flex;align-items:center;gap:8px">
              <select data-urol="${i}" style="width:auto">
                <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>👑 Admin</option>
                <option value="empleado" ${u.rol === 'empleado' ? 'selected' : ''}>🧑‍💼 Empleado</option>
              </select>
              <button type="button" class="btn-x" data-ux="${i}">✕</button>
            </span></div>`).join('')}
        <div class="row" style="align-items:flex-end;margin-top:10px">
          <div><label>Nombre</label><input id="usNombre" placeholder="Cindy" autocomplete="off"></div>
          <div><label>Correo (el de su usuario de Supabase)</label><input id="usEmail" type="email" placeholder="cindy@silvershine.com.do" autocomplete="off"></div>
          <div><label>Rol</label><select id="usRol"><option value="admin">👑 Admin</option><option value="empleado">🧑‍💼 Empleado</option></select></div>
          <div style="flex:0 0 auto"><button type="button" class="btn-gold" id="usAgregar">➕ Agregar</button></div>
        </div>
        ${info.email && info.email.toLowerCase() !== DUENO ? `<p class="muted" style="margin-top:8px">Conectado como <b>${esc(info.email)}</b>.</p>` : ''}
      </div>`;

    $('#usAgregar').addEventListener('click', async () => {
      const nombre = $('#usNombre').value.trim();
      const email = $('#usEmail').value.trim().toLowerCase();
      const rol = $('#usRol').value;
      if (!nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Pon el nombre y un correo válido'); return; }
      if (email === DUENO) { toast('Ese es el correo del dueño — ya es admin siempre'); return; }
      if (lista.some(u => (u.email || '').toLowerCase() === email)) { toast('Ese correo ya está en la lista'); return; }
      lista.push({ nombre, email, rol });
      await guardarLista();
      toast(`👥 ${nombre} agregad${rol === 'admin' ? 'o como 👑 Admin' : 'o como 🧑‍💼 Empleado'} — ahora créale el usuario en Supabase (si no existe)`);
      pintarAjustes();
    });
    $$('#usuariosCRM [data-urol]').forEach(sel => sel.addEventListener('change', async () => {
      lista[Number(sel.dataset.urol)].rol = sel.value;
      await guardarLista();
      toast('👥 Rol actualizado');
      pintarAjustes();
    }));
    $$('#usuariosCRM [data-ux]').forEach(b => b.addEventListener('click', async () => {
      const u = lista[Number(b.dataset.ux)];
      if (!confirm(`¿Quitar a ${u.nombre} de la lista? (su usuario de Supabase sigue existiendo — bórralo allá si quieres cerrarle la entrada)`)) return;
      lista.splice(Number(b.dataset.ux), 1);
      await guardarLista();
      pintarAjustes();
    }));
  }

  function init() { /* el gating corre con aplicar() desde app.js */ }

  return { init, cargar, aplicar, pintarAjustes, rolActual, puedeVer, esAdmin };
})();
