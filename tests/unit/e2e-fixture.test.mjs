// Spec P9b Kriterium 11: E2E-Harness mit festen Testkonten — Wächter, Zugangsdaten, Sperre, keine Geheimnisse im Repo.
// Gegenprobe (c): mit entferntem Wächter (checkGuard gibt immer true) werden W1–W4 rot.
// Dieser Test gibt nie einen Wert aus der lokalen Zugangsdatei aus: Vergleiche liefern nur Zählungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCreds, checkGuard, acquireLock, Abort, FIXTURE_NAME } from '../e2e/fixture-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FX = { group: 'g-1', a: 'p-a', b: 'p-b', c: 'p-c' };
const GROUP = { id: 'g-1', name: FIXTURE_NAME, created_by: 'p-a' };
const MEMBERS = [{ profile_id: 'p-a' }, { profile_id: 'p-b' }, { profile_id: null }];
const isAbort = (reason) => (e) => e instanceof Abort && e.exitCode === 2 && (!reason || e.reason === reason);

test('W0 Wächter: Fixture-Gruppe mit A, B und Platzhalter ⇒ erlaubt', () => {
  assert.equal(checkGuard({ fixture: FX, group: GROUP, members: MEMBERS }), true);
});
test('W1 Wächter: falscher Gruppenname ⇒ Abort', () => {
  assert.throws(() => checkGuard({ fixture: FX, group: { ...GROUP, name: '727' }, members: MEMBERS }), isAbort('Wächter'));
});
test('W2 Wächter: fremder Ersteller ⇒ Abort', () => {
  assert.throws(() => checkGuard({ fixture: FX, group: { ...GROUP, created_by: 'p-x' }, members: MEMBERS }), isAbort('Wächter'));
});
test('W3 Wächter: fremdes Mitglied mit Konto ⇒ Abort', () => {
  assert.throws(() => checkGuard({ fixture: FX, group: GROUP, members: [...MEMBERS, { profile_id: 'p-fremd' }] }), isAbort('Wächter'));
});
test('W4 Wächter: falsche Gruppen-ID, Gruppe unsichtbar, IDs fehlen ⇒ Abort', () => {
  assert.throws(() => checkGuard({ fixture: FX, group: { ...GROUP, id: 'g-2' }, members: MEMBERS }), isAbort('Wächter'));
  assert.throws(() => checkGuard({ fixture: FX, group: null, members: [] }), isAbort('Wächter'));
  assert.throws(() => checkGuard({ fixture: { ...FX, group: '' }, group: GROUP, members: MEMBERS }), isAbort('Wächter'));
});

test('Z1 Zugangsdaten: nichts da ⇒ Abort Exit 2, keine Konstante als Rückfall', () => {
  assert.throws(() => resolveCreds({ env: {}, files: ['/gibt/es/nicht.json'] }), isAbort('Zugangsdaten'));
});
test('Z2 Zugangsdaten: unvollständig (Konto c fehlt / kein Passwort / doppelte Adresse) ⇒ Abort', () => {
  const mk = (o) => () => resolveCreds({ env: {}, files: ['x'], read: () => JSON.stringify(o) });
  assert.throws(mk({ password: 'p', accounts: { a: 'a@x.de', b: 'b@x.de' } }), isAbort('Zugangsdaten'));
  assert.throws(mk({ accounts: { a: 'a@x.de', b: 'b@x.de', c: 'c@x.de' } }), isAbort('Zugangsdaten'));
  assert.throws(mk({ password: 'p', accounts: { a: 'a@x.de', b: 'a@x.de', c: 'c@x.de' } }), isAbort('Zugangsdaten'));
});
test('Z3 Zugangsdaten: Umgebung vor Datei; Datei vollständig ⇒ geliefert', () => {
  const env = { TTG_E2E_PW: 'e', TTG_E2E_A: 'a@e.de', TTG_E2E_B: 'b@e.de', TTG_E2E_C: 'c@e.de' };
  assert.equal(resolveCreds({ env, files: [] }).source, 'Umgebung');
  const r = resolveCreds({ env: {}, files: ['/x/fehlt.json', '/y/da.json'], read: (f) => { if (f.includes('fehlt')) throw new Error('ENOENT'); return '{"password":"p","accounts":{"a":"a@x.de","b":"b@x.de","c":"c@x.de"}}'; } });
  assert.equal(r.source, 'da.json');
  assert.equal(r.accounts.c, 'c@x.de');
});
test('Z4 fixture.mjs ohne Zugangsdaten (leeres Home, keine Umgebung) ⇒ Exit 2', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-e2e-home-'));
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  for (const k of ['TTG_E2E_PW', 'TTG_E2E_A', 'TTG_E2E_B', 'TTG_E2E_C']) delete env[k];
  const local = path.join(ROOT, 'tests', 'e2e', 'target.local.json');
  if (fs.existsSync(local)) return; // lokale Datei im Worktree hätte Vorrang — dann ist Z1 der Beleg
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'e2e', 'fixture.mjs'), '--pruefen'], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2, `Exit ${r.status}`);
  assert.match(r.stdout + r.stderr, /Zugangsdaten/);
});

test('S1 Sperre: zweiter Lauf wartet und bricht nach der Wartezeit ab; verwaiste Sperre wird übernommen', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttg-lock-')), 'l');
  let clock = 1000;
  const first = await acquireLock({ file, pid: 111, now: () => clock, pidAlive: () => true });
  let waited = 0;
  await assert.rejects(acquireLock({ file, pid: 222, now: () => clock, pidAlive: () => true, waitMs: 3000, stepMs: 1000,
    sleep: async (ms) => { waited += ms; clock += ms; } }), isAbort('Sperre'));
  assert.equal(waited, 3000);
  // PID tot ⇒ übernommen
  const second = await acquireLock({ file, pid: 333, now: () => clock, pidAlive: (p) => p !== 111 });
  assert.match(second.took, /PID 111/);
  second.release();
  assert.equal(fs.existsSync(file), false);
  // älter als 20 min ⇒ übernommen, obwohl PID lebt
  await acquireLock({ file, pid: 444, now: () => 0, pidAlive: () => true });
  const third = await acquireLock({ file, pid: 555, now: () => 21 * 60 * 1000, pidAlive: () => true });
  assert.match(third.took, /PID 444/);
  third.release();
  first.release(); // fremde Sperre wird nicht gelöscht (schon weg)
});

// ---------------------------------------------------------------- keine Geheimnisse im Repo
const tracked = () => spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
const readTracked = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };

test('G1 tests/ und tools/: kein altes Passwort der Lauf-Konten, keine Gmail-Adresse', () => {
  const words = ['Testpass' + 'wort', '@' + 'gmail'];
  const hits = tracked().filter((f) => /^(tests|tools)\//.test(f)).filter((f) => words.some((w) => readTracked(f).includes(w)));
  assert.deepEqual(hits, []);
});
test('G2 ganzes Repo: kein Wert aus der lokalen Zugangsdatei (nur Zählung)', (t) => {
  let creds;
  try { creds = resolveCreds(); } catch { t.skip('keine lokalen Zugangsdaten auf dieser Maschine'); return; }
  const values = [creds.password, creds.accounts.a, creds.accounts.b, creds.accounts.c, ...Object.values(creds.accounts).map((m) => m.split('@')[0])]
    .filter((v) => v.length >= 6);
  const files = tracked();
  let hits = 0;
  for (const f of files) { const s = readTracked(f); for (const v of values) if (s.includes(v)) hits++; }
  assert.ok(files.length > 100, 'git ls-files leer?');
  assert.ok(hits === 0, `${hits} Treffer (Werte werden nicht ausgegeben)`);
});
