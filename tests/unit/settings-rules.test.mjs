// P12: Prüfregeln Konto (Passwort, E-Mail, Löschwort, Dateiliste) und App-Version ↔ sw.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordProblem, emailProblem, deleteConfirmed, filesByBucket, runAccountDeletion, DELETE_WORD } from '../../src/views/settings-rules.js';
import { APP_VERSION } from '../../src/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Passwort: < 8 Zeichen ⇒ weak, ungleich ⇒ mismatch, sonst null', () => {
  assert.equal(passwordProblem('', ''), 'auth.errors.weak');
  assert.equal(passwordProblem('1234567', '1234567'), 'auth.errors.weak');
  assert.equal(passwordProblem('12345678', '12345679'), 'account.pwMismatch');
  assert.equal(passwordProblem('12345678', '12345678'), null);
  assert.equal(passwordProblem(undefined, undefined), 'auth.errors.weak');
});

test('E-Mail: Format und „gleiche Adresse“', () => {
  assert.equal(emailProblem('kein-at', 'a@x.de'), 'account.emailBad');
  assert.equal(emailProblem('a@x', 'a@x.de'), 'account.emailBad');
  assert.equal(emailProblem(' A@X.de ', 'a@x.de'), 'account.emailSame');
  assert.equal(emailProblem('neu@x.de', 'a@x.de'), null);
});

test('Löschwort: LÖSCHEN (de) / DELETE (en), Groß-/Kleinschreibung und Rand egal, sonst gesperrt', () => {
  assert.deepEqual(DELETE_WORD, { de: 'LÖSCHEN', en: 'DELETE' });
  assert.equal(deleteConfirmed('LÖSCHEN', 'de'), true);
  assert.equal(deleteConfirmed('  löschen ', 'de'), true);
  assert.equal(deleteConfirmed('LÖSCHE', 'de'), false);
  assert.equal(deleteConfirmed('LOESCHEN', 'de'), false);
  assert.equal(deleteConfirmed('DELETE', 'de'), false);
  assert.equal(deleteConfirmed('delete', 'en'), true);
  assert.equal(deleteConfirmed('LÖSCHEN', 'en'), false);
  assert.equal(deleteConfirmed('', 'de'), false);
  assert.equal(deleteConfirmed(null, 'de'), false);
});

test('Dateiliste nach Bucket', () => {
  assert.deepEqual(filesByBucket([
    { bucket: 'avatars', path: 'profiles/u/avatar.jpg' }, { bucket: 'game-photos', path: 'g/1.jpg' },
    { bucket: 'avatars', path: 'members/m/avatar.jpg' }, { bucket: null, path: 'x' },
  ]), { avatars: ['profiles/u/avatar.jpg', 'members/m/avatar.jpg'], 'game-photos': ['g/1.jpg'] });
  assert.deepEqual(filesByBucket(null), {});
});

test('App-Version passt zur VERSION in sw.js', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/const VERSION = '([^']+)'/);
  assert.ok(m, 'VERSION in sw.js gefunden');
  assert.equal(m[1], `ttg-${APP_VERSION}`);
});

// ---- B2: Ablauf Konto löschen mit vorgespieltem Supabase (Reihenfolge Probelauf → Dateien → RPC)
const FILES = [{ bucket: 'avatars', path: 'profiles/u/a.jpg' }, { bucket: 'game-photos', path: 'g/x.jpg' }];
function fakeSb(rpcResults = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name) => {
      calls.push(`rpc:${name}`);
      const r = rpcResults[name];
      return r ?? (name === 'my_account_files' ? { data: FILES, error: null } : { data: null, error: null });
    },
    storage: { from: (bucket) => ({ remove: async (paths) => { calls.push(`remove:${bucket}:${paths.join(',')}`); return { error: null }; } }) },
  };
}
const fail = (message) => ({ data: null, error: { message } });

test('B2: Probelauf gelingt ⇒ Probelauf, Dateiliste, Storage-remove, dann delete_my_account', async () => {
  const sb = fakeSb();
  assert.equal(await runAccountDeletion(sb), 'deleted');
  assert.deepEqual(sb.calls, ['rpc:check_delete_my_account', 'rpc:my_account_files',
    'remove:avatars:profiles/u/a.jpg', 'remove:game-photos:g/x.jpg', 'rpc:delete_my_account']);
});
test('B2: erzwungener RPC-Fehler im Probelauf ⇒ Fehler kommt durch, KEIN Storage-remove, keine Löschung', async () => {
  const sb = fakeSb({ check_delete_my_account: fail('update or delete on table "decks" violates foreign key constraint') });
  await assert.rejects(runAccountDeletion(sb), (e) => /foreign key/.test(e.message));
  assert.deepEqual(sb.calls, ['rpc:check_delete_my_account']);
});
test('B2: Dateiliste scheitert ⇒ kein remove, keine Löschung', async () => {
  const sb = fakeSb({ my_account_files: fail('Netz weg') });
  await assert.rejects(runAccountDeletion(sb), (e) => /Netz weg/.test(e.message));
  assert.ok(!sb.calls.some((c) => c.startsWith('remove:') || c === 'rpc:delete_my_account'), sb.calls.join(' '));
});
test('B2: Doppelklick ⇒ Probelauf meldet „Konto nicht gefunden“ ⇒ already, nichts gelöscht', async () => {
  const sb = fakeSb({ check_delete_my_account: fail('Konto nicht gefunden') });
  assert.equal(await runAccountDeletion(sb), 'already');
  assert.deepEqual(sb.calls, ['rpc:check_delete_my_account']);
  const sb2 = fakeSb({ delete_my_account: fail('Konto nicht gefunden') });
  assert.equal(await runAccountDeletion(sb2), 'already');
});
