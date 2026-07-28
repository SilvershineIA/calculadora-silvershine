/* Service worker — CRM SilverShine (cache-first con actualización en segundo plano) */
const CACHE = 'sscrm-v31';
const ARCHIVOS = [
  './',
  './index.html',
  './css/app.css?v=31',
  './js/jspdf.min.js',
  './js/pdf.js?v=31',
  './js/db.js?v=31',
  './js/sync.js?v=31',
  './js/ui.js?v=31',
  './js/clientes.js?v=31',
  './js/catalogo.js?v=31',
  './js/calculadora.js?v=31',
  './js/facturas.js?v=31',
  './js/cotizaciones.js?v=31',
  './js/cobros.js?v=31',
  './js/tareas.js?v=31',
  './js/app.js?v=31',
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
