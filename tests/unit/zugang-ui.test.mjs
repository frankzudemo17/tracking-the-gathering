// Spec P9b Krit. 10 (Übergang) und 14 (Texte) + Negativraum (Code-Normalisierung, Deckel, keine Profil-ID im Client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inviteCode, checkInvite, codeFromInput } from '../../src/zugang/invite.js';
import { parseMax } from '../../src/zugang/limits.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- Client-Attrappe
function fakeSb({ table, rpc }) {
  const calls = [];
  return {
    calls,
    from(name) {
      const q = { name, eqs: [] };
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        eq: (k, v) => { q.eqs.push([k, v]); return chain; },
        maybeSingle: async () => { calls.push(['from', q]); return table(q); },
      };
      return chain;
    },
    async rpc(fn, args) { calls.push(['rpc', fn, args]); return rpc(fn, args); },
  };
}
const G = { id: 'g1', invite_code: 'TTG-ALTALT' };

test('Krit 10 inviteCode: Tabelle da ⇒ Tabellenwert (Abfrage playgroup_invites.eq(playgroup_id))', async () => {
  const sb = fakeSb({ table: () => ({ data: { code: 'TTG-NEUNEU' }, error: null }) });
  assert.equal(await inviteCode(sb, G), 'TTG-NEUNEU');
  const [, q] = sb.calls[0];
  assert.equal(q.name, 'playgroup_invites');
  assert.deepEqual(q.eqs, [['playgroup_id', 'g1']]);
});
test('Krit 10 inviteCode: PGRST205 und 42P01 ⇒ group.invite_code', async () => {
  for (const code of ['PGRST205', '42P01']) {
    const sb = fakeSb({ table: () => ({ data: null, error: { code, message: 'x' } }) });
    assert.equal(await inviteCode(sb, G), 'TTG-ALTALT');
  }
  const sb = fakeSb({ table: () => ({ data: null, error: { code: 'PGRST205' } }) });
  assert.equal(await inviteCode(sb, { id: 'g1' }), null);
});
test('Krit 10 inviteCode: 42501 ⇒ Fehler; 0 Zeilen ⇒ null', async () => {
  const sb = fakeSb({ table: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
  await assert.rejects(inviteCode(sb, G), { code: '42501' });
  const sb0 = fakeSb({ table: () => ({ data: null, error: null }) });
  assert.equal(await inviteCode(sb0, G), null);
});
test('Krit 10 checkInvite: PGRST202 ⇒ unknown; Netzfehler ⇒ Fehler; ok/invalid/full durchgereicht', async () => {
  const mk = (r) => fakeSb({ rpc: async () => r });
  assert.deepEqual(await checkInvite(mk({ data: null, error: { code: 'PGRST202' } }), 'TTG-A'), { status: 'unknown' });
  await assert.rejects(checkInvite(mk({ data: null, error: { message: 'TypeError: Failed to fetch' } }), 'TTG-A'), { message: /Failed to fetch/ });
  await assert.rejects(checkInvite(mk({ data: null, error: { code: '500', message: 'boom' } }), 'TTG-A'), { message: 'boom' });
  await assert.rejects(checkInvite(fakeSb({ rpc: async () => { throw new TypeError('Failed to fetch'); } }), 'TTG-A'), /Failed to fetch/);
  for (const d of [{ status: 'ok', group_name: 'Tisch' }, { status: 'invalid' }, { status: 'full' }]) {
    const sb = mk({ data: d, error: null });
    assert.deepEqual(await checkInvite(sb, 'TTG-A'), d);
    assert.deepEqual(sb.calls[0], ['rpc', 'check_invite', { p_code: 'TTG-A' }]);
  }
  await assert.rejects(checkInvite(mk({ data: { status: 'weiter' }, error: null }), 'TTG-A'), /unerwartet/);
});
test('Krit 10 genau zwei Übergangsstellen in src/ (grep „ÜBERGANG P9b“ = 2)', () => {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) n += fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('ÜBERGANG P9b')).length; } };
  walk(path.join(ROOT, 'src'));
  assert.equal(n, 2);
});

// ---------------------------------------------------------------- Negativraum
test('Code aus Eingabe: ganzer Link, Alias, Kleinbuchstaben, angehängtes / oder ?…', () => {
  assert.equal(codeFromInput('https://x.example/app/#/beitreten/ttg-abc234'), 'ttg-abc234');
  assert.equal(codeFromInput('  https://x.example/#/code/TIM-ABC234/ '), 'TIM-ABC234');
  assert.equal(codeFromInput('https://x.example/#/beitreten/TTG-ABC234?x=1'), 'TTG-ABC234');
  assert.equal(codeFromInput('https://x.example/#/beitreten/%E0'), '%E0'); // kaputte Kodierung ⇒ kein Absturz
  assert.equal(codeFromInput(' TTG-ABC234 '), 'TTG-ABC234');
  assert.equal(codeFromInput(null), '');
});
test('Deckel: 1–1000 ganzzahlig, sonst null (kein Aufruf)', () => {
  assert.equal(parseMax('25'), 25);
  assert.equal(parseMax(' 1000 '), 1000);
  assert.equal(parseMax('1'), 1);
  for (const bad of ['0', '1001', '-3', '2.5', '', 'zwanzig', null, undefined]) assert.equal(parseMax(bad), null, String(bad));
});
test('Superadmin hängt nur an profile.is_superadmin: keine Profil-ID der Fixture/des Superadmins in src/', () => {
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'fixture-ids.json'), 'utf8'));
  const uuids = Object.values(ids);
  let hits = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.readFileSync(p, 'utf8'); for (const u of uuids) if (s.includes(u)) hits++; } } };
  walk(path.join(ROOT, 'src'));
  assert.equal(hits, 0);
  const st = fs.readFileSync(path.join(ROOT, 'src', 'state.js'), 'utf8');
  assert.match(st, /export const isSuperadmin = \(\) => state\.profile\?\.is_superadmin === true;/);
});

// ---------------------------------------------------------------- Krit 14 Texte
const lookup = (d, k) => k.split('.').reduce((o, x) => (o == null ? o : o[x]), d);
const KEYWORDS = ['superadmin_only', 'superadmin_cannot_delete', 'not_group_admin', 'max_accounts_range',
  'signup_code_required', 'signup_code_invalid', 'signup_full', 'signup_anonymous_disabled'];

test('Krit 14 die 8 Kennwörter aus dem P9-Vertrag haben auth.errors.* in de und en', () => {
  for (const k of KEYWORDS) {
    for (const [n, d] of [['de', de], ['en', en]]) {
      const v = lookup(d, `auth.errors.${k}`);
      assert.ok(typeof v === 'string' && v.length > 5 && v !== k, `${n} auth.errors.${k}`);
    }
  }
});
test('Krit 14 jeder t()-Schlüssel der P9b-Dateien existiert in de und en', () => {
  const files = ['src/views/join.js', 'src/views/register.js', 'src/views/welcome.js', 'src/views/admin.js', 'src/views/groups.js',
    'src/views/settings.js', 'src/views/profile.js', 'src/zugang/invite-ui.js', 'src/zugang/qr.js'];
  const keys = new Set();
  for (const f of files) for (const [, k] of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) keys.add(k);
  for (const k of KEYWORDS) keys.add(`auth.errors.${k}`);
  const missing = [...keys].filter((k) => typeof lookup(de, k) !== 'string' || typeof lookup(en, k) !== 'string');
  assert.deepEqual(missing, []);
  assert.ok(keys.has('access.invited') && keys.has('groups.renewText') && keys.has('auth.inviteCode'));
});
test('Krit 14 errText({ message: superadmin_only }) ⇒ deutscher Satz, nicht das Kennwort', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  globalThis.document ??= { documentElement: {} };
  const { errText } = await import('../../src/lib/ui.js');
  const s = errText({ message: 'superadmin_only' });
  assert.equal(s, de.auth.errors.superadmin_only);
  assert.notEqual(s, 'superadmin_only');
  assert.equal(errText({ message: 'max_accounts_range' }), de.auth.errors.max_accounts_range);
});
