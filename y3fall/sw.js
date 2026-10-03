// 网络优先：有网就拿最新（含 data.enc.json），断网时退回上次缓存 —— 地铁里也能看。
const CACHE = "cd-20261003220212";
// 数据文件（data.json 或 data.enc.json）不预缓存 —— 两种模式只有其一存在，addAll 碰到 404 会让安装失败；
// 第一次成功拉取后由下面的 fetch 处理器缓存。
const SHELL = ["./", "index.html", "app.js?v=20261003220212", "style.css?v=20261003220212", "manifest.webmanifest", "icon-32.png", "icon-180.png", "icon-192.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
