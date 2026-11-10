// Feste E2E-Fixture in Prod (Spec P9b H) — legt nie etwas doppelt an, löscht nie Konto oder Gruppe.
//   node tests/e2e/fixture.mjs --pruefen   meldet den Zustand, ändert nichts (Exit 0 = vollständig, 1 = es fehlt etwas)
//   node tests/e2e/fixture.mjs --anlegen   legt fehlende Konten A, B, C und die Gruppe TTG-E2E-Fixture an
//                                          (A = Ersteller und Admin) und schreibt tests/e2e/fixture-ids.json
// Zugangsdaten: Umgebung oder lokale Datei (fixture-core.mjs resolveCreds) — fehlen sie ⇒ Exit 2.
// Nach dem db push der Zugang-Migration kann --anlegen keine Gruppe und kein Konto ohne Code mehr anlegen
// ⇒ klare Meldung, was der Superadmin tun muss. Ausgaben nennen die Konten nur A, B, C.
// --anlegen stellt den Grundzustand wie der E2E-Lauf her (harness.mjs baseState: vor dem db push der
// P10-Migration REST, danach erst die Mitglieder-Funktionen, PGRST202 ⇒ alter Weg).
import fs from 'node:fs';
import { Abort, FIXTURE_NAME, KEYS } from './fixture-core.mjs';

const argv = process.argv.slice(2);
const mode = argv.includes('--anlegen') ? 'anlegen' : argv.includes('--pruefen') ? 'pruefen' : null;

async function main() {
  if (!mode) throw new Abort('Aufruf', 'node tests/e2e/fixture.mjs --pruefen | --anlegen');
  // Zugangsdaten zuerst (ohne Netz): fehlen sie, endet der Lauf hier mit Exit 2
  const core = await import('./fixture-core.mjs');
  core.resolveCreds();
  const f = await import('./fixture-api.mjs');
  console.log(`Fixture ${mode} · Ziel ${f.TARGET.url} · Zugang-Migration ${(await f.zugangLive()) ? 'IN Prod' : 'nicht in Prod'}`);

  // Konten
  const uid = {};
  for (const k of KEYS) {
    try {
      uid[k] = (await f.signIn(k)).uid;
      console.log(`  Konto ${f.LABEL[k]}: vorhanden (${uid[k]})`);
    } catch (e) {
      if (e instanceof Abort) throw e;
      if (e.status !== 400) throw e;
      if (mode === 'pruefen') { console.log(`  Konto ${f.LABEL[k]}: FEHLT (Anmeldung abgelehnt)`); continue; }
      // Registrierung über die API; ab B mit dem Code der Fixture (wirkt nach dem db push als Ticket)
      const fx = f.fixtureIds();
      const code = k !== 'a' && fx?.group ? await f.inviteCode(fx.group).catch(() => null) : null;
      try {
        const r = await f.api('POST', `${f.TARGET.url}/auth/v1/signup`, { body: { email: f.email(k), password: f.password(), data: { display_name: f.NAMES[k], ...(code ? { invite_code: code } : {}) } } });
        if (!r?.access_token && !r?.session) throw new Error('Registrierung ohne Sitzung (Bestätigungsmail an?)');
      } catch (ex) {
        if (/Database error saving new user/i.test(ex.message)) throw new Abort('Fixture', `Konto ${f.LABEL[k]} lässt sich nicht registrieren: das Registrierungs-Tor ist aktiv — der Superadmin muss die Fixture-Gruppe anlegen bzw. einen Code geben`);
        throw ex;
      }
      uid[k] = (await f.signIn(k)).uid;
      console.log(`  Konto ${f.LABEL[k]}: angelegt (${uid[k]})`);
    }
  }
  if (Object.keys(uid).length < 3) { console.log('\nUnvollständig: mindestens ein Konto fehlt ⇒ --anlegen (nur vor dem db push möglich).'); return 1; }

  // Gruppe: genau eine Gruppe TTG-E2E-Fixture mit Ersteller A
  const mine = await f.get('a', `playgroups?select=id,name,created_by&name=eq.${encodeURIComponent(FIXTURE_NAME)}&created_by=eq.${uid.a}`);
  let gid = mine[0]?.id ?? null;
  if (mine.length > 1) throw new Abort('Fixture', `${mine.length} Gruppen ${FIXTURE_NAME} von A — bitte von Hand klären (nichts geändert)`);
  if (!gid && mode === 'anlegen') {
    try {
      gid = (await f.rpc('a', 'create_playgroup', { p_name: FIXTURE_NAME })).id;
      console.log(`  Gruppe ${FIXTURE_NAME}: angelegt (${gid})`);
    } catch (e) {
      if (/superadmin_only/.test(e.message)) throw new Abort('Fixture', `Gruppe ${FIXTURE_NAME} fehlt und nur der Superadmin darf Gruppen anlegen: Superadmin legt „${FIXTURE_NAME}“ an, macht Konto A zum Mitglied und Admin und überträgt die Gruppe (created_by = A) per SQL — dann --pruefen`);
      throw e;
    }
  } else console.log(`  Gruppe ${FIXTURE_NAME}: ${gid ? `vorhanden (${gid})` : 'FEHLT'}`);
  if (!gid) return 1;

  const ids = { group: gid, a: uid.a, b: uid.b, c: uid.c };
  const old = f.fixtureIds();
  if (JSON.stringify(old) !== JSON.stringify(ids)) {
    if (mode === 'pruefen') { console.log(`\nfixture-ids.json ${old ? 'weicht ab' : 'fehlt'} — erwartet ${JSON.stringify(ids)}`); return 1; }
    fs.writeFileSync(f.IDS_FILE, JSON.stringify(ids, null, 2) + '\n');
    console.log(`  fixture-ids.json geschrieben`);
  }
  // Grundzustand wie im E2E-Lauf (harness.mjs): nach dem db push der P10-Migration zuerst über die
  // Mitglieder-Funktionen (direktes delete auf members ist dann zu), sonst/danach der REST-Weg (fixture-api.mjs)
  if (mode === 'anlegen') await (await import('./harness.mjs')).baseState({ log: (s) => console.log('  ' + s) });
  const snap = await f.snapshot();
  const code = await f.inviteCode(gid);
  console.log(`\nZustand: Mitglieder mit Konto [${snap.members.join(', ')}] · A Admin: ${snap.adminA ? 'ja' : 'NEIN'} · ${snap.placeholders} Platzhalter · ${snap.games} Spiele · Einladungscode für A lesbar: ${code ? 'ja' : 'NEIN'}`);
  const base = snap.members.join() === 'A' && snap.adminA && snap.placeholders === 0 && snap.games === 0;
  console.log(base ? 'Grundzustand: ja' : 'Grundzustand: nein (der nächste E2E-Lauf stellt ihn her)');
  return snap.adminA && code ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => {
  if (e instanceof Abort) { console.error(`ABBRUCH (${e.reason}): ${e.message}`); process.exit(2); }
  console.error('FEHLER', e?.message ?? e);
  process.exit(1);
});
