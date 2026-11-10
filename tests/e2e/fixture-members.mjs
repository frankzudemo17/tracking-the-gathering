// E2E-Grundzustand der Mitglieder nach dem db push der P10-Migration (Block K6: direktes delete auf members
// ist geschlossen). Reiner Ablauf ohne Netz und ohne Import: die Aufrufe kommen über `io` herein — in Prod
// die REST-API (harness.mjs), im Beweis PGlite mit RLS als Konto A/B/C (tests/db/mitglieder.test.mjs,
// gleiche Aufruffolge). Löscht nie Konto oder Gruppe.

/** Gibt es member_removal_check (P10-Migration in der Ziel-Datenbank)? PGRST202 ⇒ false (alter Weg). */
export async function probeMembers(rpc) {
  try {
    await rpc('member_removal_check', { p_member: '00000000-0000-4000-8000-000000000000' });
    return true; // unbekannte ID gibt es nicht; ein Erfolg hieße trotzdem: Funktion da
  } catch (e) {
    if (e?.code === 'PGRST202') return false;
    if (/not_group_admin/.test(e?.message || '')) return true;
    throw e;
  }
}

/**
 * Alle Zeilen der Fixture außer A wirklich löschen — über die P10-Funktionen, als A (Admin):
 *   0. Spiele der Gruppe löschen (Kaskade) ⇒ danach verweist nichts mehr auf die Zeilen ⇒ Modus delete.
 *   je Runde, bis nur A übrig ist:
 *   1. aktive Zeilen außer A (Platzhalter, B, C): Admin ggf. herabstufen, Probelauf, Bilddateien, remove_member(delete).
 *   2. markierte Platzhalter (removed_at, ohne Konto): restore_member ⇒ in der nächsten Runde gelöscht.
 *   3. frühere Zeilen von B/C (former_profile_id): Beitritt per Code holt je Konto genau die zuletzt entfernte
 *      zurück ⇒ nächste Runde löscht sie; hat ein Konto mehrere frühere Zeilen, je Runde eine.
 * Bleibt eine Zeile im Modus mark (Verweis außerhalb der Spiele) oder gehört eine frühere Zeile keinem der
 * drei Testkonten bzw. A selbst ⇒ Fehler (kein endloser Kreis, nichts geraten).
 * @param {{ members: () => Promise<any[]>, deleteGames: () => Promise<number>, rejoin: (k: 'b'|'c') => Promise<any>,
 *           rpc: (fn: string, args: object) => Promise<any>, removeFiles: (names: string[]) => Promise<number> }} io
 * @param {{ a: string, b: string, c: string }} fx
 */
export async function membersCleanup(io, fx, { maxRounds = 12 } = {}) {
  const n = { games: 0, rejoined: 0, restored: 0, deleted: 0, files: 0, rounds: 0 };
  n.games = await io.deleteGames();
  for (;;) {
    const ms = await io.members();
    const active = ms.filter((m) => !m.removed_at && m.profile_id !== fx.a);
    const marked = ms.filter((m) => m.removed_at && !m.former_profile_id);
    const former = ms.filter((m) => m.removed_at && m.former_profile_id);
    if (!active.length && !marked.length && !former.length) return n;
    if (++n.rounds > maxRounds) throw new Error(`Grundzustand P10: nach ${maxRounds} Runden noch ${active.length} aktive, ${marked.length} markierte, ${former.length} frühere Zeile(n)`);
    for (const m of active) {
      if (m.role === 'admin') await io.rpc('set_member_role', { p_member: m.id, p_role: 'member' });
      const c = await io.rpc('member_removal_check', { p_member: m.id });
      if (c?.mode === 'already') continue;
      if (c?.mode !== 'delete') throw new Error(`Grundzustand P10: Zeile ${m.id} im Modus ${c?.mode} statt delete (Verweis außerhalb der Spiele)`);
      if (c.files?.length) n.files += await io.removeFiles(c.files);
      const r = await io.rpc('remove_member', { p_member: m.id, p_expect: 'delete' });
      if (r?.result === 'deleted') n.deleted++;
    }
    for (const m of marked) { await io.rpc('restore_member', { p_member: m.id }); n.restored++; }
    const keys = new Set();
    for (const m of former) {
      const k = m.former_profile_id === fx.b ? 'b' : m.former_profile_id === fx.c ? 'c' : null;
      if (!k) throw new Error(`Grundzustand P10: frühere Zeile ${m.id} gehört keinem der Testkonten B/C — von Hand klären`);
      keys.add(k);
    }
    for (const k of keys) { await io.rejoin(/** @type {'b'|'c'} */ (k)); n.rejoined++; }
  }
}
