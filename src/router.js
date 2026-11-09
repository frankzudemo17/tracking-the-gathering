// Hash-Router: #/start, #/profil/<id>, #/code/<code> …
const routes = [];

/** pattern z. B. '/profil/:id'; opts: { public, nav, group } */
export function route(pattern, load, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ pattern, rx, keys, load, opts });
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
