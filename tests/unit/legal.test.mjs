// P10 Impressum nur für Angemeldete (spec-p10-impressum.md Entscheid 4): reine Auswahl pickImprint, Leseanfrage
// loadImprint (Form der Anfrage, Fehler werden nie geworfen) und Formwächter für src/views/legal.js (kein Speichern,
// keine zweite Leseschicht, keine Literale statt i18n). Testwert nur die Muster-Anschrift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickImprint, loadImprint } from '../../src/views/legal.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WERT = 'Erika Muster\nTeststraße 1\n00000 Prüfstadt';
const SESSION = { user: { id: 'u1' }, access_token: 'x' };

test('pickImprint: ohne Sitzung neutral + Hinweis — auch wenn eine Zeile übergeben wird', () => {
  assert.deepEqual(pickImprint(null, null, null), { value: null, hint: true });
  assert.deepEqual(pickImprint(undefined, { value: WERT }, null), { value: null, hint: true });
});

test('pickImprint: mit Sitzung und Zeile ⇒ Wert unverändert (Zeilenumbrüche erhalten), kein Hinweis', () => {
  assert.deepEqual(pickImprint(SESSION, { value: WERT }, null), { value: WERT, hint: false });
});

test('pickImprint: mit Sitzung, ohne Zeile / leer / Fehler (404, 401, Netz) ⇒ neutral ohne Hinweis', () => {
  const neutral = { value: null, hint: false };
  assert.deepEqual(pickImprint(SESSION, null, null), neutral, 'keine Zeile');
  assert.deepEqual(pickImprint(SESSION, { value: '' }, null), neutral, 'leerer Text');
  assert.deepEqual(pickImprint(SESSION, { value: '  \n ' }, null), neutral, 'nur Leerraum');
  assert.deepEqual(pickImprint(SESSION, { value: 42 }, null), neutral, 'kein Text');
  assert.deepEqual(pickImprint(SESSION, { value: WERT }, { code: 'PGRST205', message: 'not found' }), neutral, '404 Tabelle fehlt');
  assert.deepEqual(pickImprint(SESSION, null, { code: 'PGRST301', message: 'JWT expired' }), neutral, '401');
  assert.deepEqual(pickImprint(SESSION, null, new TypeError('Failed to fetch')), neutral, 'Netzfehler');
});

/** sb-Attrappe: zeichnet die Kette auf, liefert `result` (oder wirft `throws`). */
function fakeSb({ result = { data: null, error: null }, throws = null } = {}) {
  const calls = [];
  const chain = {
    select: (c) => { calls.push(['select', c]); return chain; },
    eq: (k, v) => { calls.push(['eq', k, v]); return chain; },
    maybeSingle: async () => { calls.push(['maybeSingle']); if (throws) throw throws; return result; },
  };
  return { calls, sb: { from: (tbl) => { calls.push(['from', tbl]); return chain; } } };
}

test('loadImprint: genau eine Anfrage app_info.select(value).eq(key, impressum).maybeSingle()', async () => {
  const f = fakeSb({ result: { data: { value: WERT }, error: null } });
  assert.deepEqual(await loadImprint(f.sb), { row: { value: WERT }, error: null });
  assert.deepEqual(f.calls, [['from', 'app_info'], ['select', 'value'], ['eq', 'key', 'impressum'], ['maybeSingle']]);
});

test('loadImprint: Fehlerantwort und geworfener Fehler kommen als error zurück, nie als Ausnahme', async () => {
  const e404 = { code: 'PGRST205', message: 'Could not find the table' };
  assert.deepEqual(await loadImprint(fakeSb({ result: { data: null, error: e404 } }).sb), { row: null, error: e404 });
  const net = new TypeError('Failed to fetch');
  assert.deepEqual(await loadImprint(fakeSb({ throws: net }).sb), { row: null, error: net });
  assert.deepEqual(await loadImprint(fakeSb({ result: { data: null, error: null } }).sb), { row: null, error: null });
});

test('Formwächter legal.js: kein Speichern, keine zweite Leseschicht, kein innerHTML, keine Konsole', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'views', 'legal.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'pageCache', 'deviceStore', 'device-store', 'cache.js', 'innerHTML', 'console.']) {
    assert.ok(!code.includes(bad), `legal.js enthält ${bad}`);
  }
  // keine Modul-Variable, die den Wert hält: einzige Modul-Konstanten sind FAN_URL und back
  const top = code.split('\n').filter((l) => /^(let|var|const) /.test(l)).map((l) => l.split(/[ =]/)[1]);
  assert.deepEqual(top, ['FAN_URL', 'back']);
  assert.equal((code.match(/from\('app_info'\)/g) || []).length, 1, 'genau eine Stelle fragt app_info ab');
});

test('i18n: legal.membersOnly de/en vorhanden, legal.operator unverändert vorhanden', () => {
  for (const d of [de, en]) {
    assert.equal(typeof d.legal.membersOnly, 'string');
    assert.ok(d.legal.membersOnly.length > 10);
    assert.equal(typeof d.legal.operator, 'string');
  }
  assert.notEqual(de.legal.membersOnly, en.legal.membersOnly);
});
