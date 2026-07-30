/* Service worker — CRM SilverShine (cache-first con actualización en segundo plano) */
const CACHE = 'sscrm-v45';
const ARCHIVOS = [
  './',
  './index.html',
  './css/app.css?v=45',
  './js/jspdf.min.js',
  './js/pdf.js?v=45',
  './js/db.js?v=45',
  './js/sync.js?v=45',
  './js/ui.js?v=45',
  './js/clientes.js?v=45',
  './js/catalogo.js?v=45',
  './js/calculadora.js?v=45',
  './js/facturas.js?v=45',
  './js/cotizaciones.js?v=45',
  './js/cobros.js?v=45',
  './js/inventario.js?v=45',
  './js/tareas.js?v=45',
  './js/app.js?v=45',
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
