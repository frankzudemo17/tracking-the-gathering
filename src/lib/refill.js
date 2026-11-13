// Nachfüllen (P6 Kaltstart, spec-p6-kaltstart.md Entscheid 10): nach einem eigenen Schreibvorgang hält der
// Gerätespeicher keinen Gruppen-/Seiten-Stand mehr (Schreibmarke, Entscheid 9). REFILL_QUIET_MS nach dem letzten
// eigenen Schreibvorgang lädt die App die registrierten Einträge der aktuellen Gruppe im Hintergrund neu, damit der
// nächste Kaltstart einen Stand NACH dem Schreiben zeigt. Nicht im Lifecounter (/spiel/:id ohne /ende) — dann
// beim Verlassen der Route nach derselben Ruhezeit —, nicht ohne Konto/Gruppe, höchstens eine Runde gleichzeitig.
// Gespiegelt wird nur über die Riegel des Zwischenspeichers (Marke vom Beginn = Marke am Ende). Scheitern ⇒ still.
import { onWrite } from '../supabase.js';
import { state } from '../state.js';
import { deviceStore, REFILL_QUIET_MS } from './device-store.js';
import { groupData } from './data.js';

/** @type {Map<string, (groupId: string) => Promise<any>>} */
const loaders = new Map();
/** @param {string} name @param {(groupId: string) => Promise<any>} loader */
export function registerRefill(name, loader) { loaders.set(name, loader); }
registerRefill('group', (gid) => groupData.loadGroup(gid, { force: true }));

/** Lifecounter offen? (/spiel/:id, nicht /spiel/:id/ende, nicht /spiel-neu) */
const inLife = () => /^#\/spiel\/[^/?]+\/?$/.test(location.hash);

let started = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let timer = null;
let running = false;
let again = false;
let waitingLife = false;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, REFILL_QUIET_MS);
}

async function run() {
  timer = null;
  if (inLife()) { waitingLife = true; return; }
  if (running) { again = true; return; }
  const uid = state.session?.user?.id;
  const gid = state.groupId;
  if (!uid || !gid || deviceStore.account() !== uid) return;
  running = true;
  try {
    await Promise.allSettled([...loaders.values()].map((load) => load(gid)));
  } finally {
    running = false;
  }
  if (again) { again = false; schedule(); }
}

/** Einmal aus main.js (boot). */
export function startRefill() {
  if (started) return;
  started = true;
  onWrite(() => {
    if (inLife()) { waitingLife = true; if (timer) { clearTimeout(timer); timer = null; } return; }
    if (running) again = true;
    schedule();
  });
  window.addEventListener('hashchange', () => {
    if (inLife()) { if (timer) { clearTimeout(timer); timer = null; waitingLife = true; } return; }
    if (waitingLife) { waitingLife = false; schedule(); }
  });
}
