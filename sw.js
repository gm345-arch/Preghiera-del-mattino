// Service worker: fa funzionare l'app anche senza connessione.
// Pagina, preghiere e testi: prima prova la rete (così vedi sempre la versione aggiornata),
// se la rete non risponde entro 4 secondi usa la copia salvata sul telefono.
// Caratteri (Google Fonts): usa la copia salvata, non cambiano mai.
const VERSIONE = "v1";
const CACHE = "preghiera-" + VERSIONE;
const BASE = ["./", "index.html", "preghiere.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n.startsWith("preghiera-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function conTempoLimite(promessa, ms) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("timeout")), ms);
    promessa.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); no(e); });
  });
}

async function primaLaRete(req) {
  const cache = await caches.open(CACHE);
  const chiave = req.url.split("?")[0].endsWith("/") ? new URL("./", self.registration.scope).href : req.url.split("?")[0];
  try {
    const r = await conTempoLimite(fetch(req, { cache: "no-cache" }), 4000);
    if (r.ok) cache.put(chiave, r.clone());
    return r;
  } catch {
    const salvata = await cache.match(chiave);
    if (salvata) return salvata;
    if (req.mode === "navigate") { const p = await cache.match(new URL("./", self.registration.scope).href); if (p) return p; }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function primaLaCopia(req) {
  const cache = await caches.open(CACHE);
  const salvata = await cache.match(req);
  if (salvata) return salvata;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") cache.put(req, r.clone());
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(primaLaCopia(req));
  } else if (url.origin === self.location.origin) {
    e.respondWith(primaLaRete(req));
  }
});
