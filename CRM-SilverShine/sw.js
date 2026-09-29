/* Service worker — CRM SilverShine.
   Estrategia: el HTML y sw.js van RED-PRIMERO (con respaldo del caché si
   no hay internet) para que las versiones nuevas entren a la primera; los
   archivos versionados (?v=) van caché-primero; y las APIs (Supabase, IA)
   NO se tocan — siempre van directo a la red, jamás se cachean. */
const CACHE = 'sscrm-v149';
const ARCHIVOS = [
  './',
  './index.html',
  './css/app.css?v=149',
  './js/jspdf.min.js',
  './js/pdf.js?v=149',
  './js/reportes.js?v=149',
  './js/db.js?v=149',
  './js/sync.js?v=149',
  './js/ui.js?v=149',
  './js/clientes.js?v=149',
  './js/catalogo.js?v=149',
  './js/calculadora.js?v=149',
  './js/facturas.js?v=149',
  './js/cotizaciones.js?v=149',
  './js/confecciones.js?v=149',
  './js/taller-rd.js?v=149',
  './js/cobros.js?v=149',
  './js/finanzas.js?v=149',
  './js/caja.js?v=149',
  './js/inventario.js?v=149',
  './js/tareas.js?v=149',
  './js/leads.js?v=149',
  './js/app.js?v=149',
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
  const url = new URL(e.request.url);

  /* APIs externas (Supabase, Anthropic…): directo a la red, sin caché —
     cachearlas servía datos VIEJOS de la nube y rompía el sync */
  if (url.origin !== self.location.origin) return;

  const guardar = resp => {
    if (resp.ok) {
      const copia = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
    }
    return resp;
  };

  /* El documento y sw.js: red primero (así las versiones nuevas entran a
     la primera recarga); el caché solo salva cuando no hay internet */
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request).then(guardar)
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  /* Todo lo demás (js/css/imágenes versionados): caché primero con
     refresco en segundo plano */
  e.respondWith(
    caches.match(e.request).then(cached => {
      const red = fetch(e.request).then(guardar).catch(() => cached);
      return cached || red;
    })
  );
});
