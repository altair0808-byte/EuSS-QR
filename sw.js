// Service worker EuSS: нужен для установки как приложения и запуска без сети.
// Данные Supabase НЕ кэшируются — всегда только из сети.
const VER = 'euss-v11';
const SHELL = [
  './', 'index.html', 'form.html', 'blank.html', 'closing.html', 'closings-report.html',
  'report.html', 'journal.html', 'settings.html', 'admin.html', 'qr.html',
  'style.css', 'config.js', 'num.js', 'app.js', 'report-calc.js', 'leftover.js', 'residents.js',
  'wm.js', 'closing-dash.js', 'chem-stats.js', 'blanc.js', 'storage-anim.js', 'dash-visuals.js',
  'xlsx-writer.js', 'closing-xlsx.js', 'pwa.js', 'idle.js', 'compat.js', 'scanner.js', 'badge-share.js', 'lite.js', 'kiosk.js', 'feedback.js', 'badges.html', 'favicon.png', 'euss-logo.png',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // API и авторизация Supabase — всегда напрямую в сеть
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VER).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        })
      )
  );
});
