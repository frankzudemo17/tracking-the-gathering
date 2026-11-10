// Service-Worker-Wechsel aus Sicht der Seite (Spec P11 Tempo, E3/E5). Keine Importe, kein DOM-Zugriff
// auf Modulebene: alles, was die Seite braucht (Container, location, sessionStorage, document, Uhr),
// wird übergeben — so prüft tests/unit/sw-update.test.mjs den Ablauf in Node mit Attrappen.
// Regel: Eine neue Version wartet. Übernommen wird nur beim Wechsel zwischen zwei ruhigen Routen
// (Kennzeichen swap: true in src/main.js) — im Spiel, im Spielaufbau und in Mail-Abläufen nie.

const SWAP_KEY = 'ttg.swap';
const GUARD_MS = 30_000; // höchstens eine Übernahme bzw. ein Neuladen je 30 s
const WAIT_MS = 4_000; // so lange wartet die Seite auf controllerchange
const UPDATE_MS = 60_000; // Mindestabstand der Update-Suche beim Sichtbarwerden

/** E5: unter https immer; auf localhost/127.0.0.1 nur mit localStorage['ttg.sw'] === 'on'. */
export function shouldRegister({ protocol, hostname, flag }) {
  if (protocol === 'https:') return true;
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return flag === 'on';
  return false;
}

/** Synchron: 'go' (Modul laden) · 'swap' (wartende Version übernehmen) · 'reload' (alter Code unter neuem Worker). */
export function decide({ waiting, stale, boot, searchAtLoad, fromSwap, toSwap, guardRecent }) {
  if (guardRecent) return 'go';
  if (stale) return 'reload';
  if (waiting && toSwap && (boot ? !searchAtLoad : fromSwap)) return 'swap';
  return 'go';
}

/**
 * Registriert den Worker (falls erlaubt), sucht beim Sichtbarwerden nach Updates und liefert die
 * Frage für render(): next(toSwap) vor jedem Routenwechsel, vor dem Laden des View-Moduls.
 * Rückgabe: 'go' (synchron, Normalfall) · 'reload' (Seite lädt gleich neu) · Promise<'go'|'reload'> (nur bei Übernahme).
 * @param {object} o
 * @param {ServiceWorkerContainer|undefined} o.container  navigator.serviceWorker
 * @param {{ search: string, protocol: string, hostname: string, reload: () => void }} o.location
 * @param {() => Storage} o.storage  liefert sessionStorage (darf werfen ⇒ es wird nie übernommen)
 * @param {() => string|null} o.flag  liest localStorage['ttg.sw']
 * @param {Document} o.document
 * @param {() => number} [o.now]
 * @param {(fn: () => void, ms: number) => unknown} [o.timer]
 */
export function setupSwUpdate({ container, location, storage, flag, document, now = () => Date.now(), timer = (fn, ms) => setTimeout(fn, ms) }) {
  const searchAtLoad = !!location.search; // Mail-Link/PKCE: vor dem Aufräumen der URL gemerkt
  const hadController = !!container?.controller;
  let reg = null;
  let first = true;
  let fromSwap = false;
  let stale = false;
  let pending = null;
  let lastUpdate = -Infinity;

  const recent = () => {
    try { return now() - Number(storage().getItem(SWAP_KEY) || 0) < GUARD_MS; } catch { return true; }
  };
  const mark = () => { try { storage().setItem(SWAP_KEY, String(now())); } catch { /* recent() hält dann ohnehin */ } };

  if (container) {
    container.addEventListener('controllerchange', () => {
      if (!hadController) return; // allererster Besuch: nichts zu tun
      if (pending) { const p = pending; pending = null; p(); return; }
      stale = true; // nicht selbst ausgelöst: beim nächsten Routenwechsel neu laden, nie mitten in einer Ansicht
    });
    let on = false;
    try { on = shouldRegister({ protocol: location.protocol, hostname: location.hostname, flag: flag() }); } catch { on = false; }
    if (on) container.register('./sw.js', { updateViaCache: 'none' }).then((r) => { reg = r; }, (e) => console.warn('SW', e));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !reg) return;
      if (now() - lastUpdate < UPDATE_MS) return;
      lastUpdate = now();
      Promise.resolve(reg.update()).catch(() => {});
    });
  }

  return function next(toSwap) {
    const boot = first;
    first = false;
    const from = fromSwap;
    fromSwap = !!toSwap;
    try {
      const d = decide({ waiting: !!reg?.waiting, stale, boot, searchAtLoad, fromSwap: from, toSwap: !!toSwap, guardRecent: recent() });
      if (d === 'go') return 'go';
      mark();
      if (d === 'reload') { location.reload(); return 'reload'; }
      const waiting = reg.waiting;
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        pending = () => { finish('reload'); location.reload(); };
        timer(() => { if (!done) { pending = null; finish('go'); } }, WAIT_MS);
        try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { pending = null; finish('go'); }
      });
    } catch {
      return 'go';
    }
  };
}
