// Service worker Adultopia app.
// Prima qui non c'era nulla: la registrazione usava una data: URL, che la spec
// vieta come script di un SW, quindi falliva in silenzio a ogni caricamento.
// Risultato: zero offline e 300 KB di HTML riscaricati a ogni avvio.
const VERSION = 'adultopia-v4';
const SHELL = 'shell-' + VERSION;
const MEDIA = 'media-' + VERSION;

// Il guscio: quello che serve per aprire l'app anche senza rete.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/mascot/conte-poses.png',
  '/assets/mascot/conte-poses2.png',
  '/assets/mascot/conte-poses3.png',
  '/assets/mascot/conte-talk.png',
  '/assets/js/soundtouch.js',
  '/assets/fonts/fjalla-one.woff2',
  '/assets/fonts/montserrat-var.woff2'
];

self.addEventListener('install', (e) => {
  // addAll fallisce tutto se un solo file manca: prendo i file uno per uno.
  e.waitUntil(
    caches.open(SHELL).then((c) =>
      Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Le Netlify Functions (TTS, verifica ordini, codici) non si cachano mai:
  // sono stato vivo, servirle stantie darebbe sblocchi e voci sbagliate.
  if (url.pathname.startsWith('/.netlify/')) return;

  // Documento HTML: rete prima (per ricevere gli aggiornamenti), cache come
  // rete di salvataggio quando si e' offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Audio: file grossi e immutabili, si servono dalla cache quando ci sono.
  // Le richieste con Range (seek dell'audio) le lascio passare intatte.
  const isMedia = /\.(mp3|m4a|wav|ogg)$/i.test(url.pathname);
  if (isMedia) {
    if (req.headers.has('range')) return;
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(MEDIA).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }))
    );
    return;
  }

  // Tutto il resto (immagini, font, icone): cache prima, poi rete.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});

// ---------- NOTIFICHE ----------
// La push arriva senza testo (niente cifratura da gestire lato server): il
// messaggio lo sceglie qui il service worker. Sono inviti, non promemoria
// burocratici: uno vale l'altro, cambiano per non annoiare.
const INVITI = [
  { t: 'La serata vi aspetta', b: 'Tre lanci gratis sono pronti. Bastano dieci minuti.' },
  { t: 'Chi tira per primo?', b: 'Il Conte ha già mescolato le carte.' },
  { t: 'Stasera niente divano', b: "Un dado, una sfida, e la serata prende un'altra piega." },
  { t: 'I vostri lanci si sono ricaricati', b: 'Aprite, tirate, vedete cosa succede.' }
];

self.addEventListener('push', (e) => {
  const i = INVITI[Math.floor(Math.random() * INVITI.length)];
  e.waitUntil(self.registration.showNotification(i.t, {
    body: i.b,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'adultopia-serata',      // una sola alla volta, non si accumulano
    renotify: true,
    data: { url: '/?utm_source=push&utm_medium=notifica' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
      // Se l'app e' gia' aperta si porta in primo piano invece di duplicarla.
      for (const c of cl) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
