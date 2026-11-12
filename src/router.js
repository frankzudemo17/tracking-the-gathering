// Hash-Router: #/start, #/profil/<id>, #/code/<code> …
const routes = [];

/** pattern z. B. '/profil/:id'; opts: { public, nav, group } */
export function route(pattern, load, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ pattern, rx, keys, load, opts });
}

// Vorherige Route (für „Zurück“ in Unterseiten, die von mehreren Orten aus erreichbar sind, z. B. Profil).
// Läuft vor dem Zeichnen: router.js wird vor dem hashchange-Handler in main.js geladen.
let nowHash = location.hash;
let prevHash = null;
window.addEventListener('hashchange', () => { if (location.hash !== nowHash) { prevHash = nowHash; nowHash = location.hash; } });
/** Ziel für „Zurück“: die vorige Route, wenn sie in der App lag und `ok(hash)` sie zulässt, sonst `fallback`. */
export function backTarget(fallback, ok = () => true) {
  return prevHash && prevHash.startsWith('#/') && ok(prevHash) ? prevHash : fallback;
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
  if (replace) { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = target;
}
