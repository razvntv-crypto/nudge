/* Remindery service worker: offline cache + daily summary notifications.
   GitHub Actions sends an empty-ish push ({slot}) at 8:00, 15:00 and 20:00.
   The counts are computed here, on the phone, from the tasks the app mirrors into IndexedDB,
   so no task data ever leaves the device. */
const CACHE = "remindery-v8";
const CORE = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request, { cache: "no-store" })
      .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("index.html", cp)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => {
    if (r.ok || r.type === "opaque") { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  })));
});

/* ---------- state mirror ---------- */
function readState() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open("remindery", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onerror = () => res(null);
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction("kv", "readonly").objectStore("kv").get("state");
          tx.onsuccess = () => res(tx.result || null);
          tx.onerror = () => res(null);
        } catch (e) { res(null); }
      };
    } catch (e) { res(null); }
  });
}

/* ---------- same scheduling rules as the app ---------- */
const pad = n => ("0" + n).slice(-2);
const dateStr = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseDate = s => { const a = s.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2]); };
const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const monthDiff = (a, b) => { const x = parseDate(a), y = parseDate(b); return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()); };
function dueOn(i, d) {
  if (i.kind === "task") return i.date === d;
  const start = i.start || i.date || d; if (d < start) return false;
  const r = i.repeat || { type: "daily", every: 1 }, every = Math.max(1, +r.every || 1), delta = diffDays(start, d);
  if (delta < 0) return false;
  if (r.type === "daily" || r.type === "intervalDays") return delta % every === 0;
  if (r.type === "weekdays") { const wd = parseDate(d).getDay(), days = (r.days && r.days.length ? r.days : [parseDate(start).getDay()]); if (days.indexOf(wd) < 0) return false; return every === 1 || Math.floor(delta / 7) % every === 0; }
  if (r.type === "weekly") return parseDate(d).getDay() === parseDate(start).getDay() && Math.floor(delta / 7) % every === 0;
  if (r.type === "monthly") return parseDate(start).getDate() === parseDate(d).getDate() && monthDiff(start, d) % every === 0;
  return false;
}
const isDone = (i, d) => i.kind === "routine" ? (i.doneDates || []).indexOf(d) > -1 : !!i.done;
function todayItems(S) {
  const d = dateStr(new Date()), items = (S && S.items) || [];
  const due = items.filter(i => i.kind === "routine" ? dueOn(i, d) : i.date === d);
  const overdue = items.filter(i => i.kind === "task" && !i.done && i.date && i.date < d);
  const all = due.concat(overdue);
  const tv = i => (i.time || "23:59");
  return { d, all, left: all.filter(i => !isDone(i, d)).sort((a, b) => tv(a) < tv(b) ? -1 : tv(a) > tv(b) ? 1 : (b.priority || 0) - (a.priority || 0)) };
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
function listBody(arr) {
  const names = arr.slice(0, 4).map(i => (i.time ? i.time + " " : "") + i.title);
  return names.join(" · ") + (arr.length > 4 ? " · +" + (arr.length - 4) + " more" : "");
}
function summary(S, slot) {
  const t = todayItems(S), total = t.all.length, left = t.left.length;
  let body;
  if (!total) body = "Nothing scheduled for today";
  else if (slot === "morning") body = plural(total, "task", "tasks") + " for today";
  else if (!left) body = "All done for today";
  else body = plural(left, "task", "tasks") + " left for today";
  return { title: body, body: "", left };  // iOS adds "from Remindery" next to the title
}
async function showSummary(slot) {
  const S = await readState();
  const s = S ? summary(S, slot) : { title: "Remindery", body: "Open the app once so it can count your tasks.", left: 0 };
  try { if (self.navigator.setAppBadge) s.left ? self.navigator.setAppBadge(s.left) : self.navigator.clearAppBadge(); } catch (e) {}
  return self.registration.showNotification(s.title, {
    body: s.body, tag: "daily-summary", renotify: true,
    icon: "icon-192.png", badge: "icon-192.png", data: { url: "./" }
  });
}

self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (err) {}
  if (p.title) { e.waitUntil(self.registration.showNotification(p.title, { body: p.body || "", tag: p.tag || "remindery", icon: "icon-192.png", data: { url: "./" } })); return; }
  e.waitUntil(showSummary(p.slot || "morning"));
});
self.addEventListener("message", e => {
  if (e.data && e.data.type === "test") e.waitUntil(showSummary(e.data.slot || "morning"));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
