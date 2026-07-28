/* ═══════════════════════════════════════════════════════════
   db.js — Capa de datos del CRM SilverShine.
   Guarda en IndexedDB (gran capacidad, apto para fotos).
   Migra automáticamente datos viejos que estén en localStorage.
   El mismo API async se conecta a Supabase vía sync.js.
   ═══════════════════════════════════════════════════════════ */
const DB = (() => {
  const NOMBRES = ['clientes', 'productos', 'facturas', 'pagos', 'cotizaciones', 'tareas', 'config'];

  /* ── IndexedDB: base 'sscrm' con un almacén 'col' (nombre → arreglo) ── */
  let _db = null;
  function abrirIDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('sscrm', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('col');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idb() { if (!_db) _db = await abrirIDB(); return _db; }
  async function idbGet(k) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction('col').objectStore('col').get(k);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  }
  async function idbSet(k, v) {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction('col', 'readwrite').objectStore('col').put(v, k);
      t.onsuccess = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  /* ── Migración desde localStorage (versiones anteriores de la app) ── */
  const listo = (async () => {
    try {
      for (const n of NOMBRES) {
        const viejo = localStorage.getItem('sscrm_' + n);
        if (viejo) {
          const actual = await idbGet(n);
          if (!actual || !actual.length) await idbSet(n, JSON.parse(viejo));
          localStorage.removeItem('sscrm_' + n);
        }
      }
    } catch (e) { console.warn('Migración localStorage → IndexedDB:', e); }
  })();

  /* ── Caché en memoria para lecturas rápidas ── */
  const cache = new Map();
  async function load(n) {
    await listo;
    if (!cache.has(n)) cache.set(n, (await idbGet(n)) || []);
    return cache.get(n);
  }
  async function save(n, arr) {
    await listo;
    cache.set(n, arr);
    await idbSet(n, arr);
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
                    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // Avisar a la nube (si está configurada) después de cada cambio local
  const avisar = (n, op, obj) => {
    if (typeof Sync !== 'undefined') Sync.notificar(n, op, obj);
  };

  // CRUD genérico sobre una colección
  const coll = n => ({
    async list() {
      return load(n);
    },
    async get(id) {
      return (await load(n)).find(x => x.id === id) || null;
    },
    async upsert(obj) {
      const arr = (await load(n)).slice();
      if (!obj.id) {
        obj.id = uid();
        obj.creado = new Date().toISOString();
        arr.unshift(obj);
      } else {
        const i = arr.findIndex(x => x.id === obj.id);
        if (i >= 0) arr[i] = { ...arr[i], ...obj };
        else arr.unshift(obj);
      }
      await save(n, arr);
      avisar(n, 'upsert', obj);
      return obj;
    },
    async remove(id) {
      await save(n, (await load(n)).filter(x => x.id !== id));
      avisar(n, 'remove', id);
    },
  });

  const api = {
    /* Reemplazo total de una colección (lo usan sync y las importaciones) */
    async reemplazar(nombre, arr) {
      if (!NOMBRES.includes(nombre)) throw new Error('Colección desconocida: ' + nombre);
      await save(nombre, arr);
    },

    /* Carga inicial de los datos históricos de QuickBooks */
    async cargarQuickBooks() {
      const resp = await fetch('datos-quickbooks.json');
      if (!resp.ok) throw new Error('No se encontró datos-quickbooks.json');
      const d = await resp.json();
      const n = {};
      for (const nombre of ['clientes', 'facturas', 'pagos', 'cotizaciones']) {
        await save(nombre, d[nombre] || []);
        n[nombre] = (d[nombre] || []).length;
      }
      return n;
    },

    /* Respaldo completo */
    async exportar() {
      const data = { version: 1, fecha: new Date().toISOString() };
      for (const nombre of NOMBRES) data[nombre] = await load(nombre);
      return data;
    },
    async importar(data) {
      if (!data || typeof data !== 'object') throw new Error('Archivo no válido');
      let n = 0;
      for (const nombre of NOMBRES) {
        if (Array.isArray(data[nombre])) { await save(nombre, data[nombre]); n += data[nombre].length; }
      }
      return n;
    },
  };
  for (const n of NOMBRES) api[n] = coll(n);
  return api;
})();
