// E2E-Fixture, reiner Kern (Spec P9b H): Zugangsdaten auflösen, Wächter, Sperrdatei.
// Kein Playwright, kein Netz, keine Nebenwirkung beim Import ⇒ per Unit-Test prüfbar
// (tests/unit/e2e-fixture.test.mjs). Zugangsdaten stehen NIE im Repo; dieses Modul gibt sie nie aus.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_NAME = 'TTG-E2E-Fixture';
export const KEYS = ['a', 'b', 'c'];

/** Abbruch aus Umgebungsgründen (Browser fehlt, Rate-Limit, Wächter, Zugangsdaten …) ⇒ Exit 2, nie „grün“. */
export class Abort extends Error {
  constructor(reason, msg) { super(msg); this.reason = reason; this.exitCode = 2; }
}

const HOME_FILE = () => path.join(os.homedir(), '.ttg-e2e.json');

/**
 * Zugangsdaten der festen Testkonten A, B, C. Reihenfolge: Umgebung (TTG_E2E_PW, TTG_E2E_A|B|C) ·
 * tests/e2e/target.local.json (in .gitignore) · ~/.ttg-e2e.json. Form der Dateien:
 * {"password":"…","accounts":{"a":"…","b":"…","c":"…"}}. Fehlt etwas ⇒ Abort (Exit 2), kein Rückfall.
 * @param {{ env?: Record<string,string|undefined>, files?: string[], read?: (f: string) => string }} [o]
 * @returns {{ password: string, accounts: { a: string, b: string, c: string }, source: string }}
 */
export function resolveCreds({ env = process.env, files, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const list = files ?? [path.join(path.dirname(fileURLToPath(import.meta.url)), 'target.local.json'), HOME_FILE()];
  const complete = (c) => c && typeof c.password === 'string' && c.password.length > 0
    && KEYS.every((k) => typeof c.accounts?.[k] === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.accounts[k]))
    && new Set(KEYS.map((k) => c.accounts[k].toLowerCase())).size === 3;
  const fromEnv = { password: env.TTG_E2E_PW, accounts: { a: env.TTG_E2E_A, b: env.TTG_E2E_B, c: env.TTG_E2E_C } };
  if (complete(fromEnv)) return { ...fromEnv, source: 'Umgebung' };
  const tried = ['Umgebung TTG_E2E_PW/TTG_E2E_A|B|C'];
  for (const f of list) {
    let text;
    try { text = read(f); } catch { tried.push(`${path.basename(f)} (fehlt)`); continue; }
    let j = null;
    try { j = JSON.parse(text); } catch { tried.push(`${path.basename(f)} (kein JSON)`); continue; }
    if (complete(j)) return { password: j.password, accounts: { a: j.accounts.a, b: j.accounts.b, c: j.accounts.c }, source: path.basename(f) };
    tried.push(`${path.basename(f)} (unvollständig)`);
  }
  throw new Abort('Zugangsdaten', `Zugangsdaten der Testkonten A, B, C fehlen oder sind unvollständig — geprüft: ${tried.join(' · ')}. `
    + 'Form: {"password":"…","accounts":{"a":"…","b":"…","c":"…"}} in tests/e2e/target.local.json oder ~/.ttg-e2e.json (nie ins Repo).');
}

/**
 * Wächter vor jedem Schreiben in Prod: die Gruppe muss genau die Fixture sein (ID, Name, Ersteller A)
 * und jedes Mitglied mit Konto ist A, B oder C. Sonst Abort — es wird nichts gelöscht.
 * @param {{ fixture: { group: string, a: string, b: string, c: string }, group: any, members: Array<{ profile_id: string|null }> }} o
 */
export function checkGuard({ fixture, group, members }) {
  const fail = (why) => { throw new Abort('Wächter', `Fixture-Wächter: ${why} — nichts gelöscht`); };
  if (!fixture?.group || !fixture.a || !fixture.b || !fixture.c) fail('Fixture-IDs fehlen (tests/e2e/fixture-ids.json — node tests/e2e/fixture.mjs --pruefen)');
  if (!group) fail(`Gruppe ${fixture.group} nicht sichtbar`);
  if (group.id !== fixture.group) fail(`falsche Gruppen-ID ${group.id}`);
  if (group.name !== FIXTURE_NAME) fail(`Gruppenname ist nicht ${FIXTURE_NAME}`);
  if (group.created_by !== fixture.a) fail('Ersteller der Gruppe ist nicht Konto A');
  if (!Array.isArray(members)) fail('Mitgliederliste fehlt');
  const allowed = new Set([fixture.a, fixture.b, fixture.c]);
  const foreign = members.filter((m) => m.profile_id && !allowed.has(m.profile_id));
  if (foreign.length) fail(`${foreign.length} fremde(s) Mitglied(er) mit Konto in der Gruppe`);
  if (!members.some((m) => m.profile_id === fixture.a)) fail('Konto A ist kein Mitglied der Gruppe');
  return true;
}

// ---------------------------------------------------------------- Sperrdatei
export const LOCK_FILE = () => path.join(os.tmpdir(), 'ttg-e2e.lock');
const pidAliveDefault = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Ein Lauf zur Zeit (zwei Worktrees teilen die Fixture). Wartet bis waitMs (Standard 10 min), dann Abort.
 * Verwaiste Sperre (PID tot oder älter als staleMs = 20 min) wird übernommen.
 * @returns {Promise<{ release: () => void, took: string|null }>}
 */
export async function acquireLock({
  file = LOCK_FILE(), worktree = process.cwd(), pid = process.pid, now = () => Date.now(),
  pidAlive = pidAliveDefault, waitMs = 10 * 60 * 1000, staleMs = 20 * 60 * 1000, stepMs = 5000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {},
} = {}) {
  const t0 = now();
  const mine = JSON.stringify({ pid, start: t0, worktree });
  let took = null;
  for (;;) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      return { took, release: () => { try { if (fs.readFileSync(file, 'utf8') === mine) fs.unlinkSync(file); } catch { /* schon weg */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let other = null;
    try { other = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { other = null; }
    const stale = !other || !pidAlive(other.pid) || now() - Number(other.start || 0) > staleMs;
    if (stale) {
      took = other ? `PID ${other.pid} (${other.worktree ?? '?'})` : 'unlesbare Sperre';
      try { fs.unlinkSync(file); } catch { /* jemand anderes war schneller */ }
      log(`Sperre übernommen: ${took}`);
      continue;
    }
    if (now() - t0 >= waitMs) throw new Abort('Sperre', `anderer E2E-Lauf aktiv (PID ${other.pid}, ${other.worktree ?? '?'}) — nach ${Math.round(waitMs / 60000)} min Wartezeit abgebrochen`);
    log(`warte auf anderen E2E-Lauf (PID ${other.pid}) …`);
    await sleep(stepMs);
  }
}

/** Gleiche Normalisierung wie src/lib/group-actions.js normCode. */
export const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
