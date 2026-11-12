/* Ordénate — service worker: funciona sin internet y avisa en segundo plano (Android) */
var CACHE = 'ordenate-v1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
      return res;
    }).catch(function () { return caches.match('./index.html'); }));
    return;
  }
  if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    }));
  }
});

/* ---- Avisos en segundo plano ---- */
function idbOpen() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('ordenate', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function idbGet(db, k) { return new Promise(function (res) { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); }; }); }
function idbSet(db, k, v) { return new Promise(function (res) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; }); }
function noon(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
function daysLeft(iso) { var p = iso.split('-').map(Number); return Math.round((new Date(p[0], p[1] - 1, p[2], 12) - noon(new Date())) / 86400000); }
var STAGES = ['week', 'three', 'today'];

function checkAndNotify() {
  return idbOpen().then(function (db) {
    return Promise.all([idbGet(db, 'state'), idbGet(db, 'swNotified')]).then(function (r) {
      var st = r[0], swn = r[1] || {};
      if (!st || !st.tasks) return;
      var shows = [];
      st.tasks.forEach(function (t) {
        if (t.done) return;
        var d = daysLeft(t.date);
        if (d < 0 || d > 7) return;
        var s = d === 0 ? 'today' : d <= 3 ? 'three' : 'week';
        var got = (st.notified && st.notified[t.id] || []).concat(swn[t.id] || []);
        if (got.indexOf(s) !== -1) return;
        swn[t.id] = STAGES.slice(0, STAGES.indexOf(s) + 1);
        var title = s === 'today' ? '¡Hoy! ' + t.title : (d === 1 ? 'Mañana: ' : d === 7 ? 'Falta 1 semana: ' : 'Faltan ' + d + ' días: ') + t.title;
        shows.push(self.registration.showNotification(title, { body: t.time ? 'A las ' + t.time : 'Ábrela en Ordénate', tag: t.id + ':' + s, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
      });
      return Promise.all(shows).then(function () { return idbSet(db, 'swNotified', swn); });
    });
  }).catch(function () { });
}

self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'ordenate-check') e.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
    return self.clients.openWindow('./');
  }));
});
