/* Service worker — CRM SilverShine (cache-first con actualización en segundo plano) */
const CACHE = 'sscrm-v71';
const ARCHIVOS = [
  './',
  './index.html',
  './css/app.css?v=71',
  './js/jspdf.min.js',
  './js/pdf.js?v=71',
  './js/db.js?v=71',
  './js/sync.js?v=71',
  './js/ui.js?v=71',
  './js/clientes.js?v=71',
  './js/catalogo.js?v=71',
  './js/calculadora.js?v=71',
  './js/facturas.js?v=71',
  './js/cotizaciones.js?v=71',
  './js/cobros.js?v=71',
  './js/finanzas.js?v=71',
  './js/inventario.js?v=71',
  './js/tareas.js?v=71',
  './js/app.js?v=71',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const red = fetch(e.request).then(resp => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
        }
        return resp;
      }).catch(() => cached);
      return cached || red;
    })
  );
});
