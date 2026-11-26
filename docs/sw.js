/* Easy Keto Carnivore Cookbook — service worker: offline copy + updates.
   VERSION is year.month.DDNN: day of the month + that day's build number (example: 2026.12.501 = Dec 5, build 1).
   publish.ps1 sets it for you. Any change to this file tells phones an update is available. */
const VERSION = "2026.11.2604";
const CACHE = "ekc-" + VERSION;
const CORE = ["./", "index.html", "styles.css", "app.js", "recipes.js", "nutrition.js", "config.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon-32.png", "vendor/jspdf.umd.min.js", "vendor/qrcode.js"];

// Download the new version's files fresh (skip the browser's own cache), then wait.
// The app shows "Update now"; the switch happens when you tap it or next time the app starts.
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "version" && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
  if (d.type === "skipWaiting") self.skipWaiting();
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Big PDF: network only (not cached unless you download it).
  if (req.url.endsWith(".pdf")) return;
  // Pages: network first so updates show up, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put("index.html", c)); return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // Everything else: cached copy right away, refreshed in the background.
  e.respondWith(caches.open(CACHE).then(cache => cache.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});

// Tapping a timer notification brings the app back to the front.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});

// Timer alerts from the push server (arrive even when the app is closed).
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  const title = d.title || "⏰ Timer done";
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || "Your timer is done", tag: d.tag || "timer", renotify: true, requireInteraction: true,
      icon: "icons/icon-192.png", badge: "icons/icon-192.png", vibrate: [400, 200, 400, 200, 400], data: d,
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage({ type: "timer-pushed", id: d.id }))),
  ]));
});
