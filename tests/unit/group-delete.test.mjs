// Ablauf „Gruppe löschen“ (src/views/group-delete.js) mit Attrappe — Spec P3 Block A, Nacharbeit B1/B2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupNameMatches, runGroupDeletion } from '../../src/views/group-delete.js';

const G = { id: 'g-1', name: 'Küchentisch' };
const fail = (message) => ({ data: null, error: { message } });

/** Supabase-Attrappe: protokolliert jeden Aufruf; rpc-Antworten je Funktionsname überschreibbar. */
function fakeSb(over = {}) {
  const calls = [];
  const params = {};
  const files = [{ bucket: 'avatars', path: 'members/m1/a.jpg' }, { bucket: 'game-photos', path: 'g-1/x.jpg' }];
  return {
    calls, params,
    async rpc(fn, args) {
      calls.push(`rpc:${fn}`);
      params[fn] = args;
      if (over[fn]) return over[fn];
      return fn === 'playgroup_files' ? { data: files, error: null } : { data: null, error: null };
    },
    storage: { from: (bucket) => ({ async remove(paths) { calls.push(...paths.map((p) => `remove:${bucket}:${p}`)); return { data: paths.map((name) => ({ name })), error: null }; } }) },
  };
}

test('Reihenfolge: playgroup_files, Storage-remove, dann delete_playgroup', async () => {
  const sb = fakeSb();
  assert.equal(await runGroupDeletion(sb, G, 'Küchentisch'), 'deleted');
  assert.deepEqual(sb.calls, ['rpc:playgroup_files', 'remove:avatars:members/m1/a.jpg', 'remove:game-photos:g-1/x.jpg', 'rpc:delete_playgroup']);
  assert.deepEqual(sb.params.playgroup_files, { p_group: 'g-1' });
});

// B2: die lokale Prüfung (trim() = jeder Unicode-Leerraum) ist großzügiger als der Server (btrim = nur U+0020).
// Deshalb geht der kanonische Name g.name an delete_playgroup, nie die Eingabe.
for (const [label, input] of [['NBSP am Ende', 'Küchentisch '], ['Tab am Ende', 'Küchentisch\t'], ['Kleinschreibung + Leerzeichen', '  küchentisch ']]) {
  test(`B2: Eingabe mit ${label} ⇒ p_name ist g.name`, async () => {
    assert.equal(groupNameMatches(input, G.name), true, 'lokal freigegeben');
    const sb = fakeSb();
    assert.equal(await runGroupDeletion(sb, G, input), 'deleted');
    assert.deepEqual(sb.params.delete_playgroup, { p_group: 'g-1', p_name: 'Küchentisch' });
  });
}

test('B2: Name passt lokal nicht ⇒ Fehler „Name stimmt nicht“, kein einziger Aufruf', async () => {
  for (const input of ['Küchentis', '', '   ', null]) {
    const sb = fakeSb();
    await assert.rejects(runGroupDeletion(sb, G, input), /Name stimmt nicht/);
    assert.deepEqual(sb.calls, [], String(input));
  }
});

test('B1: playgroup_files wirft member_used_elsewhere (Probelauf) ⇒ 0 Storage-remove, kein delete_playgroup', async () => {
  const sb = fakeSb({ playgroup_files: fail('member_used_elsewhere') });
  await assert.rejects(runGroupDeletion(sb, G, 'Küchentisch'), (e) => /member_used_elsewhere/.test(e.message));
  assert.deepEqual(sb.calls, ['rpc:playgroup_files']);
});

test('Leihdeck: playgroup_files wirft deck_used_elsewhere ⇒ 0 Storage-remove, kein delete_playgroup', async () => {
  const sb = fakeSb({ playgroup_files: fail('deck_used_elsewhere') });
  await assert.rejects(runGroupDeletion(sb, G, 'Küchentisch'), (e) => /deck_used_elsewhere/.test(e.message));
  assert.deepEqual(sb.calls, ['rpc:playgroup_files']);
});

test('Doppelklick: „Gruppe nicht gefunden“ ⇒ already, nichts gelöscht', async () => {
  const sb = fakeSb({ playgroup_files: fail('Gruppe nicht gefunden') });
  assert.equal(await runGroupDeletion(sb, G, 'Küchentisch'), 'already');
  assert.deepEqual(sb.calls, ['rpc:playgroup_files']);
});
