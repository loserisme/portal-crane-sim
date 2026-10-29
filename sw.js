/* 门机仿真缓存控制 Service Worker
 * 策略：
 *  - 页面导航 / HTML：network-first（部署后刷新即见最新页面，不再依赖 Ctrl+F5）
 *  - 带 ?v= 版本号的资源（js/css/glb）：cache-first（版本号变化自然失效）
 *  - 无版本号资源：network-first，离线时回退缓存
 */
var CACHE = 'pcrane-20261028c'; /* 版本升级时与 index.html 的 v= 同步替换 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function putInCache(req, res) {
  caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var isNav = req.mode === 'navigate' ||
    url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isNav) {
    e.respondWith(
      fetch(req).then(function (res) { return putInCache(req, res); })
        .catch(function () { return caches.match(req, { ignoreSearch: true }); })
    );
    return;
  }

  if (/[?&]v=/.test(url.search)) {
    /* 版本化资源：内容随版本号变化，可放心缓存优先 */
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { return putInCache(req, res); });
      })
    );
  } else {
    e.respondWith(
      fetch(req).then(function (res) { return putInCache(req, res); })
        .catch(function () { return caches.match(req); })
    );
  }
});
