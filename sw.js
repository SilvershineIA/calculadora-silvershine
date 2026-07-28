/* Service worker de la Calculadora SilverShine.
   Al actualizar la app hay que subir el número de CACHE para que
   los teléfonos descarguen la versión nueva. */
const CACHE = "silvershine-v3";
const ARCHIVOS = ["./", "./index.html", "./calculadora-clasica.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Solo se cachea la app en sí; las APIs de precios siempre van a la red.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
