/* Easy Keto Carnivore Cookbook — service worker: works fully offline after the first visit.
   Bump VERSION whenever you change any site file so phones pick up the update. */
const VERSION = "ekc-20261126-notes";
const CORE = ["./", "index.html", "styles.css", "app.js", "recipes.js", "config.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon-32.png", "vendor/jspdf.umd.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Big PDF: network only (not cached unless you download it).
  if (req.url.endsWith(".pdf")) return;
  // Pages: network first so updates show up, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put("index.html", c)); return res; })
      .catch(() => caches.match("index.html")));
    return;
  }
  // Everything else: cached copy right away, refreshed in the background.
  e.respondWith(caches.open(VERSION).then(cache => cache.match(req, { ignoreSearch: true }).then(hit => {
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
