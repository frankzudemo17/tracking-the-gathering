// Ablauf „Spieler aus der Gruppe entfernen“ (src/views/member-remove.js) mit Client-Attrappe — Spec P10 G, Krit. 14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runMemberRemoval, rpcOrUnavailable, canRemoveMember, removedRowKind, removedRow } from '../../src/views/member-remove.js';

const M = { id: 'm-1', playgroup_id: 'g-1' };
const fail = (message, code) => ({ data: null, error: { message, code } });
const CHK = {
  del: { mode: 'delete', games: 0, live_games: 0, decks: 1, files: ['members/m-1/avatar.jpg', 'members/m-1/b.jpg'] },
  delNoFiles: { mode: 'delete', games: 0, live_games: 0, decks: 0, files: [] },
  mark: { mode: 'mark', games: 2, live_games: 1, decks: 0, files: [] },
};

/**
 * Supabase-Attrappe: protokolliert jeden Aufruf. `checks` = Folge der Probelauf-Antworten,
 * `remove` = Folge der remove_member-Antworten, `storage` = Antwort von remove(), `rows` = Ergebnis „Zeile neu laden“.
 */
function fakeSb({ checks = [CHK.del], remove = [], storage, rows = [{ id: 'm-1' }], update } = {}) {
  const calls = [];
  const params = [];
  let ci = 0, ri = 0;
  return {
    calls, params,
    async rpc(fn, args) {
      calls.push(`rpc:${fn}`);
      params.push([fn, args]);
      if (fn === 'member_removal_check') {
        const c = checks[Math.min(ci++, checks.length - 1)];
        return c?.error ? c : { data: c, error: null };
      }
      if (fn === 'remove_member') {
        const r = remove[ri++];
        if (r) return r;
        return { data: { result: args.p_expect === 'delete' ? 'deleted' : 'marked' }, error: null };
      }
      return { data: null, error: null };
    },
    from(table) {
      const q = {
        _op: 'select',
        update(v) { calls.push(`update:${table}:${JSON.stringify(v)}`); q._op = 'update'; return q; },
        select() { if (q._op !== 'update') calls.push(`select:${table}`); return q; },
        eq(col, val) { q._eq = [col, val]; return q; },
        then(res, rej) {
          const out = q._op === 'update' ? (update || { data: [{ id: 'm-1' }], error: null }) : { data: rows, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
    storage: {
      from: (bucket) => ({
        async remove(paths) {
          calls.push(`remove:${bucket}:${paths.join(',')}`);
          return storage || { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };
}
const yes = () => { const f = async () => { f.n++; return true; }; f.n = 0; return f; };

test('delete mit Dateien: Probelauf → avatar_path leeren → remove(files) → remove_member(…, delete); invalidate', async () => {
  const sb = fakeSb();
  const confirm = yes();
  let inv = 0;
  assert.equal(await runMemberRemoval(sb, M, { confirm, invalidate: () => inv++ }), 'deleted');
  assert.deepEqual(sb.calls, [
    'rpc:member_removal_check',
    'update:members:{"avatar_path":null}',
    'remove:avatars:members/m-1/avatar.jpg,members/m-1/b.jpg',
    'rpc:remove_member',
  ]);
  assert.deepEqual(sb.params.at(-1), ['remove_member', { p_member: 'm-1', p_expect: 'delete' }]);
  assert.deepEqual(sb.params[0], ['member_removal_check', { p_member: 'm-1' }]);
  assert.equal(confirm.n, 1);
  assert.equal(inv, 1);
});

test('delete ohne Dateien: kein Update, kein Storage-Aufruf', async () => {
  const sb = fakeSb({ checks: [CHK.delNoFiles] });
  assert.equal(await runMemberRemoval(sb, M, { confirm: yes() }), 'deleted');
  assert.deepEqual(sb.calls, ['rpc:member_removal_check', 'rpc:remove_member']);
});

test('mark: Probelauf → remove_member(…, mark); kein Storage-Aufruf, kein Update', async () => {
  const sb = fakeSb({ checks: [CHK.mark] });
  assert.equal(await runMemberRemoval(sb, M, { confirm: yes() }), 'marked');
  assert.deepEqual(sb.calls, ['rpc:member_removal_check', 'rpc:remove_member']);
  assert.deepEqual(sb.params.at(-1)[1], { p_member: 'm-1', p_expect: 'mark' });
});

test('Bestätigung bekommt den Probelauf; abgelehnt ⇒ kein schreibender Aufruf', async () => {
  const sb = fakeSb();
  let seen;
  assert.equal(await runMemberRemoval(sb, M, { confirm: async (c) => { seen = c; return false; } }), 'cancelled');
  assert.deepEqual(seen, CHK.del);
  assert.deepEqual(sb.calls, ['rpc:member_removal_check']);
});

test('Storage-Fehler ⇒ kein RPC, Fehler', async () => {
  const sb = fakeSb({ storage: { data: null, error: { message: 'storage kaputt' } } });
  await assert.rejects(runMemberRemoval(sb, M, { confirm: yes() }), (e) => /storage kaputt/.test(e.message));
  assert.ok(!sb.calls.includes('rpc:remove_member'));
});

test('1 von 2 Objekten gelöscht ⇒ kein RPC, Fehler', async () => {
  const sb = fakeSb({ storage: { data: [{ name: 'members/m-1/avatar.jpg' }], error: null } });
  await assert.rejects(runMemberRemoval(sb, M, { confirm: yes() }), /nicht gelöscht/);
  assert.ok(!sb.calls.includes('rpc:remove_member'));
});

test('Update avatar_path scheitert ⇒ kein Storage, kein RPC, Fehler', async () => {
  const sb = fakeSb({ update: { data: null, error: { message: 'update kaputt' } } });
  await assert.rejects(runMemberRemoval(sb, M, { confirm: yes() }), (e) => /update kaputt/.test(e.message));
  assert.deepEqual(sb.calls, ['rpc:member_removal_check', 'update:members:{"avatar_path":null}']);
});

test('member_state_changed ⇒ zweiter Probelauf, confirm zweimal, dann mit neuem Modus', async () => {
  const sb = fakeSb({ checks: [CHK.delNoFiles, CHK.mark], remove: [fail('member_state_changed', 'P0001')] });
  const confirm = yes();
  assert.equal(await runMemberRemoval(sb, M, { confirm }), 'marked');
  assert.equal(confirm.n, 2);
  assert.deepEqual(sb.calls, ['rpc:member_removal_check', 'rpc:remove_member', 'rpc:member_removal_check', 'rpc:remove_member']);
  assert.deepEqual(sb.params.at(-1)[1], { p_member: 'm-1', p_expect: 'mark' });
});

test('not_group_admin und die Zeile fehlt nach Neuladen ⇒ already (zweites Gerät war schneller)', async () => {
  const sb = fakeSb({ checks: [CHK.mark], remove: [fail('not_group_admin', 'P0001')], rows: [] });
  assert.equal(await runMemberRemoval(sb, M, { confirm: yes() }), 'already');
  const sb2 = fakeSb({ checks: [fail('not_group_admin', 'P0001')], rows: [] });
  assert.equal(await runMemberRemoval(sb2, M, { confirm: yes() }), 'already');
  assert.deepEqual(sb2.calls, ['rpc:member_removal_check', 'select:members']);
});

test('not_group_admin und die Zeile ist noch da ⇒ Fehler', async () => {
  const sb = fakeSb({ checks: [fail('not_group_admin', 'P0001')] });
  await assert.rejects(runMemberRemoval(sb, M, { confirm: yes() }), (e) => /not_group_admin/.test(e.message));
});

test('Probelauf meldet already ⇒ already ohne Bestätigung; remove_member meldet already ⇒ already', async () => {
  const sb = fakeSb({ checks: [{ ...CHK.mark, mode: 'already' }] });
  const confirm = yes();
  assert.equal(await runMemberRemoval(sb, M, { confirm }), 'already');
  assert.equal(confirm.n, 0);
  const sb2 = fakeSb({ checks: [CHK.mark], remove: [{ data: { result: 'already' }, error: null }] });
  assert.equal(await runMemberRemoval(sb2, M, { confirm: yes() }), 'already');
});

test('PGRST202 (RPC fehlt, Migration nicht gepusht) ⇒ unavailable, kein Absturz', async () => {
  const sb = fakeSb({ checks: [fail('Could not find the function public.member_removal_check(p_member)', 'PGRST202')] });
  assert.equal(await runMemberRemoval(sb, M, { confirm: yes() }), 'unavailable');
  assert.deepEqual(sb.calls, ['rpc:member_removal_check']);
  assert.deepEqual(await rpcOrUnavailable(sb, 'leave_playgroup', { p_group: 'g' }), { data: null, error: null });
  const sb3 = { rpc: async () => fail('x', 'PGRST202') };
  assert.deepEqual(await rpcOrUnavailable(sb3, 'leave_playgroup', { p_group: 'g' }), { unavailable: true });
});

// Spec P10 K7 + Nachtrag B1: kein Entfernen-Knopf auf dem Profil des Superadmins (Server: superadmin_only)
test('B1 canRemoveMember: Admin sieht Profil des Superadmins als Mitglied ⇒ kein Knopf; einfaches Mitglied mit Konto ⇒ Knopf', () => {
  const admin = { isMe: false, isAdmin: true, isSuperadmin: false };
  const superMember = { removed_at: null, role: 'member', profiles: { display_name: 'S', is_superadmin: true } };
  const plainMember = { removed_at: null, role: 'member', profiles: { display_name: 'B', is_superadmin: false } };
  assert.equal(canRemoveMember(superMember, admin), false, 'Superadmin als Mitglied');
  assert.equal(canRemoveMember(plainMember, admin), true, 'Mitglied mit Konto');
  assert.equal(canRemoveMember({ removed_at: null, role: 'member', profiles: null }, admin), true, 'Platzhalter');
  // Superadmin selbst sieht sich nicht mit Knopf; Admin-Ziel, entfernte Zeile, Nicht-Admin ⇒ kein Knopf
  assert.equal(canRemoveMember(superMember, { isMe: true, isAdmin: true, isSuperadmin: true }), false, 'sich selbst');
  assert.equal(canRemoveMember({ ...plainMember, role: 'admin' }, admin), false, 'Admin-Ziel');
  assert.equal(canRemoveMember({ ...plainMember, removed_at: '2026-11-10T10:00:00Z' }, admin), false, 'entfernt');
  assert.equal(canRemoveMember(plainMember, { isMe: false, isAdmin: false, isSuperadmin: false }), false, 'Mitglied ohne Admin-Recht');
  assert.equal(canRemoveMember(plainMember, { isMe: false, isAdmin: false, isSuperadmin: true }), true, 'Superadmin ohne Gruppen-Admin');
  // Übergang: Profil ohne die Spalte (älterer Stand) ⇒ wie bisher
  assert.equal(canRemoveMember({ removed_at: null, role: 'member', profiles: { display_name: 'B' } }, admin), true, 'Spalte fehlt');
});

// Spec-Nachtrag „Gelöschte Konten“: Zeile in „Entfernte Spieler“ (groups.js)
test('Entfernte Spieler: gelöschtes Konto ⇒ „Konto gelöscht“, kein Wiederherstellen-Knopf; frühere Konto-Zeile und Platzhalter wie bisher', () => {
  const deleted = { id: 'm-del', former_profile_id: null, had_account: true };
  const former = { id: 'm-for', former_profile_id: 'p-1', had_account: true };
  const ph = { id: 'm-ph', former_profile_id: null, had_account: false };
  const old = { id: 'm-old', former_profile_id: null }; // vor dem db push: Spalte fehlt
  assert.deepEqual([deleted, former, ph, old].map(removedRowKind), ['deleted', 'invite', 'restore', 'restore']);
  const rd = String(removedRow(deleted, 'Ehemaliges Mitglied'));
  assert.match(rd, /Konto gelöscht/);
  assert.doesNotMatch(rd, /data-act="restore"/, 'kein Knopf beim gelöschten Konto');
  assert.doesNotMatch(rd, /Einladungslink/);
  const rf = String(removedRow(former, 'Bea'));
  assert.match(rf, /kommt über den Einladungslink zurück/);
  assert.doesNotMatch(rf, /data-act="restore"|Konto gelöscht/);
  for (const m of [ph, old]) {
    const r = String(removedRow(m, 'Pit'));
    assert.match(r, new RegExp(`data-act="restore" data-id="${m.id}"`), `Knopf bei ${m.id}`);
    assert.doesNotMatch(r, /Konto gelöscht|Einladungslink/);
  }
  assert.match(String(removedRow(ph, '<b>x</b>')), /&lt;b&gt;x&lt;\/b&gt;/, 'Name escaped');
  // groups.js baut die Liste aus genau diesem Baustein (kein eigener Knopf daneben)
  const src = fs.readFileSync(new URL('../../src/views/groups.js', import.meta.url), 'utf8');
  assert.match(src, /gone\.map\(\(m\) => removedRow\(m, memberName\(m\)\)\)/);
  assert.doesNotMatch(src, /data-act="restore" data-id=/);
});
