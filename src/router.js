// Hash-Router: #/start, #/profil/<id>, #/code/<code> …
const routes = [];

/** pattern z. B. '/profil/:id'; opts: { public, nav, group } */
export function route(pattern, load, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ pattern, rx, keys, load, opts });
}

// Pfad durch die App (für „Zurück“ in Unterseiten, die von mehreren Orten aus erreichbar sind, z. B. Profil, Deck).
// Läuft vor dem Zeichnen: router.js wird vor dem hashchange-Handler in main.js geladen.
// P14: Stapel statt nur „zuletzt besucht“. Ein Wechsel auf die vorletzte Route ist ein Zurück und nimmt die letzte
// vom Stapel — sonst zeigte nach Profil → Deck → Zurück das Zurück des Profils wieder aufs Deck (Schleife).
const trail = [location.hash];
let replacing = false;
window.addEventListener('hashchange', () => {
  const h = location.hash;
  if (h === trail[trail.length - 1]) return;
  if (h === trail[trail.length - 2]) trail.pop(); // zurück (auch per Ersetzen, z. B. Deck archiviert → Profil)
  else if (replacing) trail[trail.length - 1] = h;
  else { trail.push(h); if (trail.length > 50) trail.shift(); }
});
/** Ziel für „Zurück“: die Route vor der aktuellen, wenn sie in der App lag und `ok(hash)` sie zulässt, sonst `fallback`. */
export function backTarget(fallback, ok = () => true) {
  const prev = trail[trail.length - 2];
  return prev && prev.startsWith('#/') && ok(prev) ? prev : fallback;
}

export function current() {
  const path = (location.hash.replace(/^#/, '') || '/start').split('?')[0];
  for (const r of routes) {
    const m = path.match(r.rx);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { ...r, path, params };
    }
  }
  return null;
}

export function go(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : '#' + hash;
  if (location.hash === target) { window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
  if (replace) {
    history.replaceState(null, '', target);
    replacing = true; // ersetzt die letzte Route im Pfad, statt sie zu stapeln
    try { window.dispatchEvent(new HashChangeEvent('hashchange')); } finally { replacing = false; }
  }
  else location.hash = target;
}
