const CACHE = 'yums-v6';

// Detect base path: '/YUMS/' on GitHub Pages, '/' locally
const BASE = self.location.pathname.replace(/sw\.js$/, '');

const SHELL_FILES = [
    'index.html', 'dashboard.html', 'attendance.html',
    'calculator.html', 'trend.html', 'planner.html',
    'app.js', 'style.css', 'manifest.json'
];
const SHELL = SHELL_FILES.map(f => BASE + f);

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('onrender.com') ||
        url.origin !== self.location.origin ||
        e.request.headers.get('accept')?.includes('text/event-stream')
    ) {
        e.respondWith(fetch(e.request));
        return;
    }
    // Network-first, cache as fallback (full offline support)
    e.respondWith(
        fetch(e.request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

// Push notification handler
self.addEventListener('push', e => {
    const data = e.data?.json() || { title: '🎓 YUMS', body: 'Check your attendance!' };
    e.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎓</text></svg>',
            tag: 'yums-push'
        })
    );
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(clients.openWindow(BASE + 'dashboard.html'));
});
