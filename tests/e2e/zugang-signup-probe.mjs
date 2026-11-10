// Offline-Beleg für den Opt-in-Fall „Echte Registrierung über das Formular“ (Spec P9b H, Befund B1):
// fährt signupPart aus zugang.e2e.mjs gegen eine kleine Attrappe. JEDE Supabase-Anfrage der Seiten wird
// abgefangen (context.route), Realtime-Sockets werden geschlossen, die Zählungen (Mitgliedschaft, Anmeldung)
// kommen aus der Attrappe statt aus Prod. Kein echtes Konto, keine Zugangsdaten, kein Lauf gegen Prod.
// Der echte Lauf (nach dem db push, mit Francos Ja): TTG_E2E_SIGNUP=1 npm run e2e -- --nur zugang
//   node tests/e2e/zugang-signup-probe.mjs                     ⇒ grün erwartet (Exit 0)
//   node tests/e2e/zugang-signup-probe.mjs --falsch=loeschen   delete_my_account antwortet 200, löscht aber nicht ⇒ rot, Rest-Meldung mit Konto-ID (Exit 1)
//   node tests/e2e/zugang-signup-probe.mjs --falsch=beitritt   Registrierung ohne Mitgliedschaft ⇒ rot (Exit 1)
//   node tests/e2e/zugang-signup-probe.mjs --falsch=doppelt    join_playgroup legt eine zweite Mitgliedschaft an ⇒ Zählung 2 ⇒ rot (Exit 1)
// Attrappe nach supabase/migrations (feat/zugang 20261116000000_zugang.sql: handle_new_user tritt mit dem
// invite_code bei, join_playgroup gibt die bestehende Mitgliedschaft zurück; 20261112000000_konto.sql:
// delete_my_account macht die Mitgliedschaft zum Platzhalter „Ehemaliges Mitglied“ ohne profile_id).
import { randomUUID } from 'node:crypto';
import { serve } from '../../tools/serve.mjs';
import { launch, counts, TARGET, FIXTURE_NAME } from './harness.mjs';
import { signupPart } from './zugang.e2e.mjs';

const SB = TARGET.url;
const falsch = (process.argv.find((a) => a.startsWith('--falsch=')) ?? '').split('=')[1] ?? '';
if (falsch && !['loeschen', 'beitritt', 'doppelt'].includes(falsch)) { console.error(`--falsch=${falsch}: erlaubt sind loeschen, beitritt, doppelt`); process.exit(2); }

const G = '00000000-0000-4000-8000-0000000000f1';
const CODE = 'TTG-PROBE2';
const MAIL = 'wegwerf@example.invalid';
const PASS = 'probe-passwort-1';

/** Attrappe: Konten und Mitgliedschaften der Fixture. */
const db = { users: [], members: [] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email: u.email }), 'probe'].join('.'),
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${u.id}`, user: userOut(u),
  };
};
const userOut = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { display_name: u.name }, app_metadata: { provider: 'email' }, identities: [], created_at: '2026-11-10T00:00:00Z' });
const memberRow = (m) => ({ ...m, playgroups: { id: G, name: FIXTURE_NAME, created_by: null, created_at: '2026-11-10T00:00:00Z' } });
const join = (uid, name, again = false) => {
  if (!again && db.members.some((m) => m.profile_id === uid)) return db.members.find((m) => m.profile_id === uid);
  const m = { id: randomUUID(), playgroup_id: G, profile_id: uid, role: 'member', display_name: name, claim_code: null, avatar_path: null, created_at: new Date().toISOString() };
  db.members.push(m);
  return m;
};
const unknown = new Set();

const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers, body: body === undefined ? '' : JSON.stringify(body) });

async function backend(route) {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const m = req.method();
  const body = () => { try { return req.postDataJSON() ?? {}; } catch { return {}; } };
  const uid = (() => { try { return JSON.parse(Buffer.from(req.headers().authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub; } catch { return null; } })();
  const me = db.users.find((x) => x.id === uid);
  const single = /vnd\.pgrst\.object/.test(req.headers().accept ?? '');
  const out = (rows) => route.fulfill(single ? (rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: '0 rows' })) : json(200, rows));

  if (m === 'POST' && p === '/auth/v1/signup') {
    const b = body();
    if (db.users.some((x) => x.email === b.email)) return route.fulfill(json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }));
    if (b.data?.invite_code !== CODE) return route.fulfill(json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }));
    const nu = { id: randomUUID(), email: b.email, pass: b.password, name: b.data.display_name };
    db.users.push(nu);
    if (falsch !== 'beitritt') join(nu.id, nu.name); // Tor-Trigger der neuen DB: Beitritt mit der Registrierung
    return route.fulfill(json(200, session(nu)));
  }
  if (m === 'POST' && p === '/auth/v1/token') {
    const b = body();
    const x = db.users.find((y) => y.email === b.email && y.pass === b.password);
    return route.fulfill(x ? json(200, session(x)) : json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }));
  }
  if (p === '/auth/v1/user') return route.fulfill(me ? json(200, userOut(me)) : json(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }));
  if (p === '/auth/v1/logout') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }) }); // Status wie Prod nach dem Löschen (gemessen 10.11.2026), Rumpf nachgebildet
  if (m === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' });

  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    const b = body();
    if (fn === 'check_invite') return route.fulfill(json(200, b.p_code === CODE ? { status: 'ok', group_name: FIXTURE_NAME } : { status: 'invalid' }));
    if (fn === 'join_playgroup') {
      // neue DB: schon Mitglied ⇒ diese Mitgliedschaft; falsch=beitritt ⇒ nichts (wie ein Tor, das nicht beitritt)
      const mine = db.members.find((x) => x.profile_id === uid);
      if (falsch === 'doppelt' && mine && me) return route.fulfill(json(200, join(uid, me.name, true)));
      return route.fulfill(json(200, mine ?? null));
    }
    if (fn === 'claim_member') return route.fulfill(json(200, null));
    if (fn === 'check_delete_my_account') return route.fulfill(json(200, null));
    if (fn === 'my_account_files') return route.fulfill(json(200, []));
    if (fn === 'delete_my_account') {
      if (falsch !== 'loeschen') {
        db.users = db.users.filter((x) => x.id !== uid);
        for (const x of db.members) if (x.profile_id === uid) Object.assign(x, { profile_id: null, display_name: 'Ehemaliges Mitglied', role: 'member' });
      }
      return route.fulfill(json(200, null));
    }
    unknown.add(`${m} rpc/${fn}`);
    return route.fulfill(json(200, null));
  }
  if (m === 'GET' && p === '/rest/v1/profiles') {
    return out(me ? [{ id: me.id, display_name: me.name, avatar_path: null, locale: null, theme: null, is_superadmin: false, created_at: '2026-11-10T00:00:00Z' }] : []);
  }
  if (m === 'GET' && p === '/rest/v1/members') {
    const q = u.searchParams;
    const pid = q.get('profile_id')?.replace(/^eq\./, '');
    const gid = q.get('playgroup_id')?.replace(/^eq\./, '');
    return out(db.members.filter((x) => (!pid || x.profile_id === pid) && (!gid || x.playgroup_id === gid)).map(memberRow));
  }
  if (m === 'GET') { unknown.add(`GET ${p}`); return out([]); }
  unknown.add(`${m} ${p}`);
  return route.fulfill({ status: 204, body: '' });
}

/** Seite vorbereiten: alle Supabase-Anfragen an die Attrappe, Realtime-Sockets zu. */
async function prep(p) {
  await p.context().route(`${SB}/**`, backend);
  await p.context().routeWebSocket((url) => url.href.startsWith(SB.replace(/^http/, 'ws')), (ws) => ws.close());
}

const probe = {
  members: async (id) => db.members.filter((x) => x.profile_id === id && x.playgroup_id === G).length,
  signIn: async (mail, pass) => {
    const x = db.users.find((y) => y.email === mail && y.pass === pass);
    return x ? { status: 200, code: null, msg: '', uid: x.id } : { status: 400, code: 'invalid_credentials', msg: 'Invalid login credentials', uid: null };
  },
};

const server = await serve();
const browser = await launch();
console.log(`Offline-Beleg signupPart${falsch ? ` (Gegenprobe --falsch=${falsch})` : ''} · Server ${server.url} · Supabase vollständig abgefangen`);
try {
  await signupPart({ browser, base: server.url, code: CODE, mail: MAIL, pass: PASS, probe, prep });
} finally {
  await browser.close().catch(() => {});
  await server.close();
}
console.log(`\n${counts.pass} bestanden, ${counts.fail} fehlgeschlagen · Attrappe am Ende: ${db.users.length} Konto/Konten, ${db.members.filter((x) => x.profile_id).length} Mitgliedschaft(en) mit Konto, ${db.members.filter((x) => !x.profile_id).length} Platzhalter`);
if (unknown.size) console.log(`Attrappe ohne eigene Antwort (Standard [] / null / 204): ${[...unknown].join(' · ')}`);
process.exit(counts.fail ? 1 : 0);
