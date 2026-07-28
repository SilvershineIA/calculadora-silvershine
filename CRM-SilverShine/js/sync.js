/* ═══════════════════════════════════════════════════════════
   sync.js — Sincronización con Supabase vía API REST.
   Sin librerías: fetch directo a /auth/v1 y /rest/v1.
   Estrategia: los datos viven en localStorage (la app siempre
   funciona offline) y cada cambio se encola y se empuja a la
   nube; al abrir, se baja lo último.
   ═══════════════════════════════════════════════════════════ */
const Sync = (() => {
  const K_CFG = 'sscrm_sync_cfg';
  const K_COLA = 'sscrm_sync_cola';
  const TABLAS = ['clientes', 'productos', 'facturas', 'pagos', 'cotizaciones', 'tareas'];

  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(K_CFG)); } catch { cfg = null; }

  const guardarCfg = () => localStorage.setItem(K_CFG, JSON.stringify(cfg));
  const conectado = () => !!(cfg && cfg.url && cfg.anonKey && cfg.session);

  let estadoUI = () => {};   // callback para pintar estado en Ajustes

  /* ── Cola de cambios pendientes ── */
  const cola = {
    leer() { try { return JSON.parse(localStorage.getItem(K_COLA)) || []; } catch { return []; } },
    guardar(arr) { localStorage.setItem(K_COLA, JSON.stringify(arr)); },
    agregar(item) { const arr = cola.leer(); arr.push(item); cola.guardar(arr); },
  };

  /* ── Auth ── */
  async function login(url, anonKey, email, password) {
    const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error_description || d.msg || 'No se pudo iniciar sesión');
    cfg = {
      url, anonKey, email,
      session: {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expira: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      },
    };
    guardarCfg();
    return true;
  }

  async function renovarToken() {
    const resp = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify({ refresh_token: cfg.session.refresh_token }),
    });
    const d = await resp.json();
    if (!resp.ok) { cfg.session = null; guardarCfg(); throw new Error('Sesión expirada: vuelve a conectar en Ajustes'); }
    cfg.session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    };
    guardarCfg();
  }

  async function token() {
    if (!conectado()) throw new Error('Sin conexión configurada');
    if (cfg.session.expira - 60 < Math.floor(Date.now() / 1000)) await renovarToken();
    return cfg.session.access_token;
  }

  async function rest(metodo, ruta, body, prefer) {
    const t = await token();
    const headers = {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    const resp = await fetch(`${cfg.url}/rest/v1/${ruta}`, {
      method: metodo, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 180)}`);
    const txt = await resp.text();
    return txt ? JSON.parse(txt) : null;
  }

  /* ── Subir / bajar todo ── */
  async function subirTodo() {
    for (const tabla of TABLAS) {
      const lista = await DB[tabla].list();
      for (let i = 0; i < lista.length; i += 400) {
        const lote = lista.slice(i, i + 400).map(o => ({ id: o.id, data: o }));
        if (lote.length) await rest('POST', tabla, lote, 'resolution=merge-duplicates');
      }
      estadoUI(`Subiendo… ${tabla} (${lista.length})`);
    }
  }

  async function bajarTodo() {
    for (const tabla of TABLAS) {
      const filas = [];
      for (let desde = 0; ; desde += 1000) {
        const t = await token();
        const resp = await fetch(`${cfg.url}/rest/v1/${tabla}?select=id,data&order=id`, {
          headers: {
            apikey: cfg.anonKey, Authorization: `Bearer ${t}`,
            Range: `${desde}-${desde + 999}`,
          },
        });
        if (!resp.ok) throw new Error(`Supabase ${resp.status} al bajar ${tabla}`);
        const pagina = await resp.json();
        filas.push(...pagina);
        if (pagina.length < 1000) break;
      }
      await DB.reemplazar(tabla, filas.map(f => f.data));
      estadoUI(`Descargando… ${tabla} (${filas.length})`);
    }
  }

  async function nubeTieneDatos() {
    const filas = await rest('GET', 'clientes?select=id&limit=1');
    return Array.isArray(filas) && filas.length > 0;
  }

  /* Reparación: borra TODO en la nube y sube lo de este dispositivo */
  async function repararNube() {
    for (const tabla of TABLAS) {
      estadoUI(`Limpiando nube… ${tabla}`);
      await rest('DELETE', `${tabla}?id=neq.__nunca__`);
    }
    cola.guardar([]);          // lo pendiente ya no aplica
    await subirTodo();
  }

  /* ── Cambios individuales (write-through) ── */
  function notificar(tabla, op, obj) {
    if (!cfg || !cfg.url) return;                 // nube no configurada
    cola.agregar({ tabla, op, id: obj.id || obj, data: op === 'upsert' ? obj : null, ts: Date.now() });
    vaciarCola();                                  // intento inmediato (si falla queda en cola)
  }

  let vaciando = false;
  async function vaciarCola() {
    if (vaciando || !conectado() || !navigator.onLine) return;
    vaciando = true;
    try {
      let arr = cola.leer();
      while (arr.length) {
        const it = arr[0];
        if (it.op === 'upsert') {
          await rest('POST', it.tabla, [{ id: it.id, data: it.data }], 'resolution=merge-duplicates');
        } else if (it.op === 'remove') {
          await rest('DELETE', `${it.tabla}?id=eq.${encodeURIComponent(it.id)}`);
        }
        arr.shift();
        cola.guardar(arr);
      }
    } catch (e) {
      console.warn('Sync pendiente:', e.message);
    } finally {
      vaciando = false;
      estadoUI();
    }
  }

  /* ── Arranque: bajar lo último y vaciar pendientes ── */
  async function alAbrir() {
    if (!conectado()) return;
    try {
      await vaciarCola();
      if (!cola.leer().length) await bajarTodo();   // solo si no quedó nada pendiente
      estadoUI();
      return true;
    } catch (e) {
      console.warn('Sync al abrir:', e.message);
      return false;
    }
  }

  window.addEventListener('online', () => vaciarCola());

  function desconectar() {
    localStorage.removeItem(K_CFG);
    localStorage.removeItem(K_COLA);
    cfg = null;
  }

  return {
    login, conectado, subirTodo, bajarTodo, nubeTieneDatos, repararNube,
    notificar, vaciarCola, alAbrir, desconectar,
    pendientes: () => cola.leer().length,
    info: () => cfg ? { url: cfg.url, email: cfg.email } : null,
    cfgPublica: () => cfg ? { url: cfg.url, anonKey: cfg.anonKey, email: cfg.email } : null,
    setEstadoUI: fn => { estadoUI = fn || (() => {}); },
  };
})();
