const CACHE = 'cc-v10';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/parser.js',
  'js/logic.js',
  'icon.svg',
  'manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (e) => {
  // cache: no-cache — busca direto do servidor, ignorando as cópias que o
  // sistema guarda por alguns minutos (senão a versão nova instala arquivos velhos).
  e.waitUntil(
    caches.open(CACHE)
      .then((c) =>
        Promise.all(
          ASSETS.map((url) =>
            fetch(new Request(url, { cache: 'no-cache' })).then((res) => {
              if (res.ok || res.type === 'opaque') return c.put(url, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;

  if (sameOrigin) {
    // Arquivos do app: rede primeiro (atualizações chegam na hora);
    // cópia guardada só quando estiver sem internet.
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Bibliotecas de CDN com versão fixa: cache primeiro.
    e.respondWith(
      caches.match(e.request).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, clone));
            }
            return res;
          })
      )
    );
  }
});
