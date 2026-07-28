/* ═══════════════════════════════════════════════════════════
   db.js — Capa de datos del CRM SilverShine.
   Hoy guarda en localStorage; en la fase de nube este mismo
   API se conecta a Supabase sin tocar el resto de la app.
   Todas las funciones son async por esa razón.
   ═══════════════════════════════════════════════════════════ */
const DB = (() => {
  const K = {
    clientes:     'sscrm_clientes',
    productos:    'sscrm_productos',
    facturas:     'sscrm_facturas',
    pagos:        'sscrm_pagos',
    cotizaciones: 'sscrm_cotizaciones',
    tareas:       'sscrm_tareas',
  };

  const load = k => {
    try { return JSON.parse(localStorage.getItem(k)) || []; }
    catch { return []; }
  };
  const save = (k, arr) => localStorage.setItem(k, JSON.stringify(arr));
  const uid  = () => (crypto.randomUUID ? crypto.randomUUID()
                    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // CRUD genérico sobre una colección
  const coll = key => ({
    async list() {
      return load(key);
    },
    async get(id) {
      return load(key).find(x => x.id === id) || null;
    },
    async upsert(obj) {
      const arr = load(key);
      if (!obj.id) {
        obj.id = uid();
        obj.creado = new Date().toISOString();
        arr.unshift(obj);
      } else {
        const i = arr.findIndex(x => x.id === obj.id);
        if (i >= 0) arr[i] = { ...arr[i], ...obj };
        else arr.unshift(obj);
      }
      save(key, arr);
      return obj;
    },
    async remove(id) {
      save(key, load(key).filter(x => x.id !== id));
    },
  });

  return {
    clientes:     coll(K.clientes),
    productos:    coll(K.productos),
    facturas:     coll(K.facturas),
    pagos:        coll(K.pagos),
    cotizaciones: coll(K.cotizaciones),
    tareas:       coll(K.tareas),

    /* Carga inicial de los datos históricos de QuickBooks */
    async cargarQuickBooks() {
      const resp = await fetch('datos-quickbooks.json');
      if (!resp.ok) throw new Error('No se encontró datos-quickbooks.json');
      const d = await resp.json();
      save(K.clientes, d.clientes || []);
      save(K.facturas, d.facturas || []);
      save(K.pagos, d.pagos || []);
      save(K.cotizaciones, d.cotizaciones || []);
      return {
        clientes: (d.clientes || []).length,
        facturas: (d.facturas || []).length,
        pagos: (d.pagos || []).length,
        cotizaciones: (d.cotizaciones || []).length,
      };
    },

    /* Respaldo completo */
    async exportar() {
      const data = { version: 1, fecha: new Date().toISOString() };
      for (const [nombre, key] of Object.entries(K)) data[nombre] = load(key);
      return data;
    },
    async importar(data) {
      if (!data || typeof data !== 'object') throw new Error('Archivo no válido');
      let n = 0;
      for (const [nombre, key] of Object.entries(K)) {
        if (Array.isArray(data[nombre])) { save(key, data[nombre]); n += data[nombre].length; }
      }
      return n;
    },
  };
})();
